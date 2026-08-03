import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(testDirectory, '../..');
const sampleUrl = 'http://127.0.0.1:5187';
const excludedExtensionEntries = new Set([
  'biome-plugins',
  'coverage',
  'node_modules',
  'scripts',
  'tests',
]);

async function createTestExtension(rootDirectory) {
  const destination = path.join(rootDirectory, 'extension');
  await cp(extensionDirectory, destination, {
    recursive: true,
    filter(source) {
      const relative = path.relative(extensionDirectory, source);
      if (!relative) {
        return true;
      }
      return !excludedExtensionEntries.has(relative.split(path.sep)[0]);
    },
  });

  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}

const test = base.extend({
  context: async ({ playwright }, use) => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-inspector-e2e-'));
    const extensionPath = await createTestExtension(temporaryDirectory);
    const context = await playwright.chromium.launchPersistentContext(
      path.join(temporaryDirectory, 'profile'),
      {
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
        channel: 'chromium',
        headless: true,
      },
    );
    try {
      await use(context);
    } finally {
      await context.close();
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
  const tabId = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    if (!tab?.id) {
      throw new Error('The SignalR sample tab could not be identified.');
    }
    await globalThis.SignalRInspectorActivation.activateTab(chrome, tab);
    return tab.id;
  }, sampleUrl);
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
