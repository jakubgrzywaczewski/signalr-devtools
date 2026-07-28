import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    dispatch(...args) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function loadBackground() {
  const actionClick = event();
  const runtimeMessage = event();
  const runtimeConnect = event();
  const tabRemoved = event();
  const chrome = {
    action: {
      onClicked: actionClick,
      setBadgeBackgroundColor: vi.fn(),
      setBadgeText: vi.fn(),
      setTitle: vi.fn(),
    },
    runtime: {
      id: 'extension-id',
      getURL: (file) => `chrome-extension://extension-id/${file}`,
      onMessage: runtimeMessage,
      onConnect: runtimeConnect,
    },
    tabs: { onRemoved: tabRemoved },
  };
  const context = {
    chrome,
    console,
    importScripts: vi.fn(),
    Map,
    Number,
    Promise,
    Set,
    WeakMap,
    SignalRInspectorActivation: {
      activateTab: vi.fn(),
      deactivateTab: vi.fn(() => Promise.resolve()),
    },
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(path.resolve('background.js'), 'utf8'), context);
  return { chrome, runtimeConnect, runtimeMessage };
}

function longPollingMessage(overrides = {}) {
  return {
    source: 'signalr-inspector',
    type: 'devtools-signalr-message',
    tabId: 42,
    payload: {
      transport: 'long polling',
      direction: 'incoming',
      endpoint: 'https://localhost/chatHub',
      timestamp: 1234,
      size: 13,
      encoding: 'text',
      preview: '{"type":6}',
      textPayload: '{"type":6}\u001e',
      ...overrides,
    },
  };
}

function connectPanel(runtimeConnect) {
  const port = {
    name: 'signalr-panel:42',
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: event(),
    onMessage: event(),
  };
  runtimeConnect.dispatch(port);
  return port;
}

describe('background message boundary', () => {
  it('accepts validated Long Polling messages from the trusted DevTools page', () => {
    const { runtimeConnect, runtimeMessage } = loadBackground();
    runtimeMessage.dispatch(longPollingMessage({ unexpected: 'drop me' }), {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/devtools.html',
    });

    const port = connectPanel(runtimeConnect);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'init',
      payload: [
        expect.objectContaining({
          id: 1,
          tabId: 42,
          transport: 'long polling',
          textPayload: '{"type":6}\u001e',
        }),
      ],
    });
    expect(port.postMessage.mock.calls[0][0].payload[0].unexpected).toBeUndefined();
  });

  it.each([
    [{ id: 'another-extension', url: 'chrome-extension://extension-id/devtools.html' }, {}],
    [{ id: 'extension-id', url: 'chrome-extension://extension-id/panel.html' }, {}],
    [
      { id: 'extension-id', url: 'chrome-extension://extension-id/devtools.html' },
      { transport: 'fetch' },
    ],
    [
      { id: 'extension-id', url: 'chrome-extension://extension-id/devtools.html' },
      { textPayload: 'x'.repeat(350_001) },
    ],
  ])('rejects spoofed senders and malformed DevTools payloads', (sender, payloadOverrides) => {
    const { runtimeConnect, runtimeMessage } = loadBackground();
    runtimeMessage.dispatch(longPollingMessage(payloadOverrides), sender);

    const port = connectPanel(runtimeConnect);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'init', payload: [] });
  });
});
