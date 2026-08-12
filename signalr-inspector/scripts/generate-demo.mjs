import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { applyPalette, GIFEncoder, quantize } from 'gifenc/dist/gifenc.esm.js';
import pngjs from 'pngjs/lib/png.js';

const { PNG } = pngjs;

import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const outputPath = path.join(repositoryRoot, 'docs/images/signalr-inspector-demo.gif');
const insightsScreenshot = path.join(repositoryRoot, 'docs/images/signalr-inspector-insights.png');
const width = 1280;
const height = 800;
const DEBUGGING_URL_PATTERN = /DevTools listening on (ws:\/\/[^\s]+)/;
const storeScreenshots = {
  filtering: path.join(repositoryRoot, 'docs/images/signalr-inspector-filtering.png'),
  live: path.join(repositoryRoot, 'docs/images/signalr-inspector-live.png'),
  timeline: path.join(repositoryRoot, 'docs/images/signalr-inspector-timeline.png'),
};
const debug = (message) => {
  if (process.env.SIGNALR_DEMO_DEBUG) {
    process.stderr.write(`[demo] ${message}\n`);
  }
};

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error('Set CHROME_PATH to a Chrome or Edge executable.');
  }
  return executable;
}

function mimeType(filename) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };
  return types[path.extname(filename)] ?? 'application/octet-stream';
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const filename = path.resolve(repositoryRoot, `.${url.pathname}`);
      if (!filename.startsWith(`${repositoryRoot}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mimeType(filename) });
      response.end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function launchBrowser(executable, profileDirectory) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox');
  }
  return spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function debuggingUrl(browser) {
  return await new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const fail = (message) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`${message}${output ? `\n${output.trim()}` : ''}`));
      }
    };
    const timeout = setTimeout(() => fail('Chrome did not expose a debug endpoint.'), 15_000);
    browser.stderr.setEncoding('utf8');
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(DEBUGGING_URL_PATTERN);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    browser.stderr.once('close', () => fail('Chrome closed its error stream before startup.'));
    browser.once('exit', (code) => fail(`Chrome exited before startup with code ${code}.`));
    if (browser.exitCode !== null) {
      fail(`Chrome exited before startup with code ${browser.exitCode}.`);
    }
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    socket.addEventListener('message', (event) => this.handle(JSON.parse(event.data)));
    socket.addEventListener('close', () =>
      this.fail(new Error('Chrome DevTools connection closed.')),
    );
    socket.addEventListener('error', () =>
      this.fail(new Error('Chrome DevTools connection failed.')),
    );
  }

  fail(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    for (const waiter of this.waiters) {
      waiter.reject(error);
    }
    this.pending.clear();
    this.waiters = [];
  }

  handle(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending?.reject(new Error(message.error.message));
      } else {
        pending?.resolve(message.result);
      }
      return;
    }
    const index = this.waiters.findIndex(
      (waiter) => waiter.method === message.method && waiter.sessionId === message.sessionId,
    );
    if (index >= 0) {
      this.waiters.splice(index, 1)[0].resolve(message.params);
    }
  }

  send(method, params, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise((resolve, reject) => this.pending.set(id, { reject, resolve }));
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return result;
  }

  waitFor(method, sessionId) {
    return new Promise((resolve, reject) =>
      this.waiters.push({ method, reject, resolve, sessionId }),
    );
  }
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new CdpClient(socket);
}

function fixtures() {
  const endpoint = 'https://localhost/chatHub';
  const base = {
    tabId: 42,
    endpoint,
    documentId: 'demo-document',
    timestamp: Date.UTC(2026, 6, 31, 12, 0, 0),
  };
  const lifecycle = (id, lifecycleEvent, lifecycleDetail, connectionSeq) => ({
    ...base,
    id,
    connectionSeq,
    direction: 'incoming',
    encoding: 'lifecycle',
    lifecycleDetail,
    lifecycleEvent,
    preview: lifecycleDetail,
    size: 0,
    transport: lifecycleEvent === 'negotiate' ? 'negotiation' : 'websocket',
    timestamp: base.timestamp + id * 350,
  });
  const message = (id, direction, value, connectionSeq = 1) => {
    const textPayload = `${JSON.stringify(value)}\u001e`;
    return {
      ...base,
      id,
      connectionSeq,
      direction,
      encoding: 'text',
      preview: JSON.stringify(value),
      size: textPayload.length,
      textPayload,
      transport: 'websocket',
      timestamp: base.timestamp + id * 350,
    };
  };
  return [
    lifecycle(1, 'negotiate', 'Available transports: WebSockets', 1),
    lifecycle(2, 'transport-open', 'WebSocket connected', 1),
    message(3, 'outgoing', { protocol: 'json', version: 1 }),
    message(4, 'incoming', {}),
    message(5, 'incoming', { type: 6 }),
    message(6, 'outgoing', {
      type: 4,
      invocationId: '2',
      target: 'StreamCounter',
      arguments: [3, 150],
    }),
    message(7, 'incoming', { type: 2, invocationId: '2', item: 1 }),
    message(8, 'incoming', { type: 2, invocationId: '2', item: 2 }),
    message(9, 'incoming', { type: 2, invocationId: '2', item: 3 }),
    message(10, 'incoming', { type: 3, invocationId: '2' }),
    lifecycle(11, 'transport-close', 'WebSocket closed: demo reconnect', 1),
    lifecycle(12, 'transport-open', 'WebSocket connected', 2),
  ];
}

function insightFixtures() {
  const endpoint = 'https://localhost/chatHub';
  const timestamp = Date.UTC(2026, 6, 31, 12, 0, 0);
  const invocation = {
    type: 1,
    invocationId: 'diagnostic-1',
    target: 'UploadDiagnosticSnapshot',
    arguments: ['<26 KiB fictional snapshot>'],
  };
  const invocationPayload = `${JSON.stringify(invocation)}\u001e`;
  const pingPayload = `${JSON.stringify({ type: 6 })}\u001e`;
  return [
    {
      id: 13,
      tabId: 42,
      endpoint,
      documentId: 'demo-document',
      connectionSeq: 2,
      direction: 'outgoing',
      encoding: 'text',
      preview: JSON.stringify(invocation),
      size: 27_000,
      textPayload: invocationPayload,
      transport: 'websocket',
      timestamp: timestamp + 5000,
    },
    {
      id: 14,
      tabId: 42,
      endpoint,
      documentId: 'demo-document',
      connectionSeq: 2,
      direction: 'incoming',
      encoding: 'text',
      preview: JSON.stringify({ type: 6 }),
      size: pingPayload.length,
      textPayload: pingPayload,
      transport: 'websocket',
      timestamp: timestamp + 36_001,
    },
    {
      id: 15,
      tabId: 42,
      endpoint: 'https://localhost/azureHub',
      direction: 'incoming',
      encoding: 'lifecycle',
      lifecycleEvent: 'azure-signalr-redirect',
      lifecycleDetail: 'https://demo.service.signalr.net/client/?hub=azureHub',
      preview: 'Azure SignalR redirect',
      size: 0,
      transport: 'negotiation',
      timestamp: timestamp + 37_000,
    },
    {
      id: 16,
      tabId: 42,
      endpoint: 'wss://demo.service.signalr.net/client/?hub=azureHub',
      documentId: 'demo-document',
      connectionSeq: 3,
      direction: 'incoming',
      encoding: 'lifecycle',
      lifecycleEvent: 'transport-open',
      lifecycleDetail: 'WebSocket connected through Azure SignalR',
      preview: 'WebSocket connected through Azure SignalR',
      size: 0,
      transport: 'websocket',
      timestamp: timestamp + 37_350,
    },
  ];
}

const bootstrap = `
  (() => {
    const listeners = [];
    globalThis.chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: {
        connect() {
          return {
            postMessage() {},
            onDisconnect: { addListener() {} },
            onMessage: { addListener(listener) { listeners.push(listener); } },
          };
        },
      },
    };
    globalThis.__dispatchDemoMessage = (message) => {
      for (const listener of listeners) listener(message);
    };
  })();
`;

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    { awaitPromise: true, expression, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function settle(client, sessionId) {
  await evaluate(
    client,
    sessionId,
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

async function capture(client, sessionId, filename) {
  await settle(client, sessionId);
  const result = await client.send(
    'Page.captureScreenshot',
    { captureBeyondViewport: false, format: 'png', fromSurface: true },
    sessionId,
  );
  await writeFile(filename, Buffer.from(result.data, 'base64'));
}

async function encodeGif(framePaths) {
  const encoder = GIFEncoder();
  for (const [index, framePath] of framePaths.entries()) {
    const frame = PNG.sync.read(await readFile(framePath));
    const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: 1200,
      repeat: index === 0 ? 0 : undefined,
    });
  }
  encoder.finish();
  await writeFile(outputPath, encoder.bytes());
}

async function main() {
  debug('creating temporary workspace');
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'signalr-inspector-demo-'));
  const profileDirectory = path.join(temporaryDirectory, 'chrome-profile');
  const server = await startServer();
  debug('local server started');
  const browser = launchBrowser(browserPath(), profileDirectory);
  try {
    const websocketUrl = await debuggingUrl(browser);
    debug('browser started');
    const client = await connectCdp(websocketUrl);
    debug('DevTools protocol connected');
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    debug('target created');
    const { sessionId } = await client.send('Target.attachToTarget', {
      flatten: true,
      targetId,
    });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      {
        deviceScaleFactor: 1,
        height,
        mobile: false,
        width,
      },
      sessionId,
    );
    await client.send('Emulation.setLocaleOverride', { locale: 'en-US' }, sessionId);
    await client.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' }, sessionId);
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap }, sessionId);
    const loaded = client.waitFor('Page.loadEventFired', sessionId);
    const address = server.address();
    await client.send(
      'Page.navigate',
      { url: `http://127.0.0.1:${address.port}/signalr-inspector/panel.html?tabId=42` },
      sessionId,
    );
    await loaded;
    debug('panel loaded');
    await evaluate(
      client,
      sessionId,
      `globalThis.__dispatchDemoMessage(${JSON.stringify({ type: 'init', payload: fixtures() })})`,
    );
    // Show the capture-state indicator in the shots; without devtools APIs the panel falls
    // back to the reported state, so this renders as an active "Capturing" indicator.
    await evaluate(
      client,
      sessionId,
      `globalThis.__dispatchDemoMessage(${JSON.stringify({
        type: 'capture-status',
        active: true,
        matches: ['https://localhost/*'],
      })})`,
    );
    const rowCount = await evaluate(
      client,
      sessionId,
      "document.querySelectorAll('#messages tr').length",
    );
    if (rowCount !== fixtures().length - 1) {
      throw new Error(
        `Expected pings to be hidden from ${fixtures().length} records; saw ${rowCount}.`,
      );
    }

    const framePaths = [];
    const addFrame = async (index) => {
      const filename = path.join(temporaryDirectory, `frame-${index}.png`);
      await capture(client, sessionId, filename);
      framePaths.push(filename);
    };
    await evaluate(
      client,
      sessionId,
      'document.querySelector(\'#messages tr[data-message-id="6"]\').click()',
    );
    await addFrame(1);
    debug('captured frame 1');
    await evaluate(
      client,
      sessionId,
      `
      typeFilter.value = 'Stream invocation';
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    );
    await addFrame(2);
    await evaluate(
      client,
      sessionId,
      `
      typeFilter.value = 'Ping';
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    );
    await addFrame(3);
    await evaluate(
      client,
      sessionId,
      `
      typeFilter.value = '';
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
      directionFilter.value = 'incoming';
      directionFilter.dispatchEvent(new Event('change', { bubbles: true }));
      transportFilter.value = 'websocket';
      transportFilter.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    );
    await addFrame(4);
    await evaluate(client, sessionId, "document.getElementById('timelineTab').click()");
    const reconnectVisible = await evaluate(
      client,
      sessionId,
      "document.getElementById('timelineEvents').textContent.includes('Reconnect observed')",
    );
    if (!reconnectVisible) {
      throw new Error('The deterministic scenario did not render a reconnect event.');
    }
    await addFrame(5);
    debug('captured frame 5');
    for (const payload of insightFixtures()) {
      await evaluate(
        client,
        sessionId,
        `globalThis.__dispatchDemoMessage(${JSON.stringify({ type: 'signalr-message', payload })})`,
      );
    }
    await evaluate(client, sessionId, "document.getElementById('insightsTab').click()");
    const warningCount = await evaluate(
      client,
      sessionId,
      "document.querySelectorAll('#protocolWarnings tr').length",
    );
    if (warningCount !== 2) {
      throw new Error(`Expected two deterministic Insights warnings; saw ${warningCount}.`);
    }
    const azureVisible = await evaluate(
      client,
      sessionId,
      "document.getElementById('insightSummary').textContent.includes('1 connection')",
    );
    if (!azureVisible) {
      throw new Error('The deterministic scenario did not render Azure SignalR detection.');
    }
    await addFrame(6);
    await copyFile(framePaths[5], insightsScreenshot);
    debug('captured Insights frame');
    await Promise.all([
      copyFile(framePaths[0], storeScreenshots.live),
      copyFile(framePaths[1], storeScreenshots.filtering),
      copyFile(framePaths[4], storeScreenshots.timeline),
    ]);
    await encodeGif(framePaths);
    debug('GIF encoded');

    const gif = await readFile(outputPath);
    if (!['GIF87a', 'GIF89a'].includes(gif.subarray(0, 6).toString('ascii'))) {
      throw new Error('The generated artifact is not a GIF image.');
    }
    const gifWidth = gif.readUInt16LE(6);
    const gifHeight = gif.readUInt16LE(8);
    if (gifWidth !== width || gifHeight !== height) {
      throw new Error(`Expected ${width}x${height}; generated ${gifWidth}x${gifHeight}.`);
    }
    for (const screenshot of [...Object.values(storeScreenshots), insightsScreenshot]) {
      const png = await readFile(screenshot);
      if (
        png.subarray(1, 4).toString('ascii') !== 'PNG' ||
        png.readUInt32BE(16) !== width ||
        png.readUInt32BE(20) !== height
      ) {
        throw new Error(`${path.basename(screenshot)} is not a ${width}x${height} PNG.`);
      }
    }
    console.log(
      `Generated README demo, three store screenshots, and an Insights screenshot at ${width}x${height}.`,
    );
  } finally {
    debug('cleaning up');
    browser.kill('SIGTERM');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    debug('server closed');
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

await main();
