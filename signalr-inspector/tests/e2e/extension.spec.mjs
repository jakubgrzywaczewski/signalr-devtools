import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(testDirectory, '../..');
const sampleUrl = 'http://127.0.0.1:5187';
const whitespace = /\s+/;

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

async function activateInspector({ page, worker }) {
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
  }, sampleUrl);
  await reloaded;
  await page.waitForLoadState('load');
  await expect(page.locator('#status')).toContainText('Connected to /chatHub');

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
