import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(testDirectory, '../..');
const sampleUrl = 'http://127.0.0.1:5187';
const statefulAppPort = 5188;
const statefulProxyPort = 5189;
const whitespace = /\s+/;

// TCP passthrough proxy so the stateful reconnect scenario can kill the transport
// mid-flight — a faithful network drop without cooperation from client or server.
function createProxy(listenPort, targetPort) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    sockets.add(client);
    sockets.add(upstream);
    const forget = () => {
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', forget);
    upstream.on('error', forget);
    client.on('close', forget);
    upstream.on('close', forget);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return {
    listen: () => new Promise((resolve) => server.listen(listenPort, '127.0.0.1', resolve)),
    dropAll: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
    },
    // server.close() alone would wait for the live resumed WebSocket forever.
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        sockets.clear();
        server.close(resolve);
      }),
  };
}

async function packagedExtensionEntries() {
  // Single source of truth: copy exactly the files the store zip ships (the `package` script's
  // allowlist), so a file missing from that list also breaks E2E instead of only the store zip.
  const packageJson = JSON.parse(
    await readFile(path.join(extensionDirectory, 'package.json'), 'utf8'),
  );
  const [, fileList] = packageJson.scripts.package.split('../dist/signalr-inspector.zip');
  if (!fileList) {
    throw new Error('The package script no longer matches the expected zip allowlist shape.');
  }
  return fileList.trim().split(whitespace);
}

async function createTestExtension(rootDirectory) {
  const destination = path.join(rootDirectory, 'extension');
  for (const entry of await packagedExtensionEntries()) {
    await cp(path.join(extensionDirectory, entry), path.join(destination, entry), {
      recursive: true,
    });
  }

  // The shipped manifest deliberately has no host_permissions — activation relies on a user
  // gesture granting activeTab, which headless Chromium cannot reproduce. The temporary copy
  // gets a 127.0.0.1-only grant so the worker can activate the tab programmatically;
  // tests/manifest.test.mjs asserts the mutation never leaks into the repository manifest.
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}

const test = base.extend({
  context: async ({ playwright }, use) => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-inspector-e2e-'));
    let context;
    try {
      const extensionPath = await createTestExtension(temporaryDirectory);
      context = await playwright.chromium.launchPersistentContext(
        path.join(temporaryDirectory, 'profile'),
        {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
          channel: 'chromium',
          headless: true,
        },
      );
      await use(context);
    } finally {
      await context?.close();
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  },
  extension: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use({ id: new URL(worker.url()).host, worker });
  },
});

async function activateInspector({
  page,
  worker,
  appUrl = sampleUrl,
  readyText = 'Connected to /chatHub',
}) {
  await page.bringToFront();
  // activateTab reloads the tab out of band; arm the navigation listener before triggering it
  // so the status assertion below runs against the post-reload document, not the stale one.
  const reloaded = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  });
  const tabId = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    if (!tab?.id) {
      throw new Error('The SignalR sample tab could not be identified.');
    }
    await globalThis.SignalRInspectorActivation.activateTab(chrome, tab);
    return tab.id;
  }, appUrl);
  await reloaded;
  await page.waitForLoadState('load');
  await expect(page.locator('#status')).toContainText(readyText);

  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const registrations = await chrome.scripting.getRegisteredContentScripts();
        return registrations.map(({ id }) => id);
      }),
    )
    .toEqual(expect.arrayContaining([`signalr-bridge-${tabId}`, `signalr-main-${tabId}`]));
  return tabId;
}

async function openPanel({ context, extensionId, tabId }) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  await expect.poll(() => panel.locator('#messages tr').count()).toBeGreaterThan(0);
  return panel;
}

test('captures a real JSON invocation and restores its exported session', async ({
  context,
  extension,
  page,
}) => {
  await page.goto(sampleUrl);
  await expect(page.locator('#status')).toContainText('Connected to /chatHub');
  const tabId = await activateInspector({ page, worker: extension.worker });
  const panel = await openPanel({ context, extensionId: extension.id, tabId });

  await page.bringToFront();
  await page.locator('#message').fill('Playwright captured this');
  await page.locator('#send').click();
  await expect(
    page.locator('#messages li', { hasText: 'Ada: Playwright captured this' }),
  ).toBeVisible();

  await panel.bringToFront();
  await expect(panel.locator('#messages')).toContainText('SendMessage');
  await expect(panel.locator('#messages')).toContainText('Completion');
  await panel.locator('#insightsTab').click();
  await expect(panel.locator('#methodStats')).toContainText('SendMessage');

  const downloadStarted = panel.waitForEvent('download');
  await panel.locator('#exportSession').click();
  const download = await downloadStarted;
  const sessionPath = await download.path();
  expect(sessionPath).not.toBeNull();

  await panel.locator('#clearLog').click();
  await panel.locator('#messagesTab').click();
  await expect(panel.locator('#messages tr')).toHaveCount(0);
  await panel.locator('#sessionFile').setInputFiles(sessionPath);
  await expect(panel.locator('#sessionStatus')).toContainText('Imported');
  await expect.poll(() => panel.locator('#messages tr').count()).toBeGreaterThan(0);
});

test('captures a real Server-Sent Events conversation through the page world', async ({
  context,
  extension,
  page,
}) => {
  // The DevTools network observer (outgoing SSE POSTs) cannot run under Playwright — it needs a
  // real DevTools session. This scenario covers the page-world half of the SSE pipeline; the
  // observer half is covered by unit tests in tests/longPolling.test.mjs.
  await page.goto(`${sampleUrl}/?transport=server-sent-events`);
  await expect(page.locator('#status')).toContainText('Server-Sent Events + JSON');
  const tabId = await activateInspector({ page, worker: extension.worker });

  // Page-world detection is conservative: the SSE handshake response ({}) alone does not
  // prove SignalR, so the connection surfaces once the first real hub message arrives.
  await page.locator('#message').fill('SSE captured this');
  await page.locator('#send').click();
  await expect(page.locator('#messages li', { hasText: 'Ada: SSE captured this' })).toBeVisible();

  const panel = await openPanel({ context, extensionId: extension.id, tabId });
  await panel.locator('#transportFilter').selectOption('server-sent events');
  await expect(panel.locator('#messages')).toContainText('ReceiveMessage');
  const firstRow = panel.locator('#messages tr').first();
  await firstRow.locator('td').first().click();
  await expect(panel.locator('#detailsMeta')).toContainText('server-sent events');
  await panel.locator('#insightsTab').click();
  await expect(panel.locator('#methodStats')).toContainText('ReceiveMessage');
});

test('continues one conversation across a stateful reconnect resume', async ({
  context,
  extension,
  page,
}) => {
  const proxy = createProxy(statefulProxyPort, statefulAppPort);
  await proxy.listen();
  try {
    const appUrl = `http://127.0.0.1:${statefulProxyPort}`;
    // Stateful resume is transparent in the official client: no reconnecting callbacks
    // fire — the observable proof is a second physical WebSocket reusing the connection.
    const webSockets = [];
    page.on('websocket', (ws) => webSockets.push(ws.url()));
    await page.goto(appUrl);
    await expect(page.locator('#status')).toHaveText('connected');
    const tabId = await activateInspector({
      page,
      worker: extension.worker,
      appUrl,
      readyText: 'connected',
    });
    const socketsBeforeDrop = webSockets.length;
    const panel = await openPanel({ context, extensionId: extension.id, tabId });

    await page.bringToFront();
    await page.locator('#send').click();
    await expect(page.locator('#messages li')).toHaveCount(1);
    await page.locator('#stream').click();
    await expect
      .poll(() => page.locator('#streamItems li').count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);

    proxy.dropAll();
    await expect
      .poll(() => webSockets.length, { timeout: 30_000 })
      .toBeGreaterThan(socketsBeforeDrop);

    // The page receives every item exactly once across the gap and the buffered
    // redelivery does not duplicate the earlier invocation reply.
    await expect(page.locator('#streamState')).toHaveText('stream: completed', {
      timeout: 30_000,
    });
    await expect(page.locator('#streamItems li')).toHaveCount(10);
    await page.locator('#send').click();
    await expect(page.locator('#messages li')).toHaveCount(2);

    // The panel folds the resumed socket back into the interrupted conversation: one
    // connection card, the stream group completes, and the Timeline shows the resume.
    await panel.bringToFront();
    const streamRow = panel.locator('#messages tr').filter({ hasText: 'Stream invocation' });
    await expect(streamRow).toContainText('StreamCounter');
    await expect(streamRow).toContainText('Completed ·', { timeout: 20_000 });
    await panel.locator('#timelineTab').click();
    await expect(panel.locator('#connectionSummary .connection-card')).toHaveCount(1);
    await expect(panel.locator('#connectionSummary')).toContainText('resumes at #');
    await expect(panel.locator('#timelineEvents')).toContainText('Stateful reconnect sequence');
  } finally {
    await proxy.close();
  }
});

test('decodes a real MessagePack stream into Flow and Insights', async ({
  context,
  extension,
  page,
}) => {
  await page.goto(`${sampleUrl}/?protocol=messagepack`);
  await expect(page.locator('#status')).toContainText('WebSockets + MessagePack');
  const tabId = await activateInspector({ page, worker: extension.worker });
  const panel = await openPanel({ context, extensionId: extension.id, tabId });

  await page.bringToFront();
  await page.locator('#stream').click();
  await expect(page.locator('#messages')).toContainText('Stream 1 completed');

  await panel.bringToFront();
  const streamRow = panel.locator('#messages tr').filter({ hasText: 'Stream invocation' });
  await expect(streamRow).toContainText('StreamCounter');
  await expect(streamRow).toContainText('Completed · 3 items');
  await streamRow.locator('td').first().click();
  await expect(panel.locator('#detailsPayload')).toContainText('StreamCounter');
  await panel.locator('#insightsTab').click();
  await expect(panel.locator('#methodStats')).toContainText('StreamCounter');
});
