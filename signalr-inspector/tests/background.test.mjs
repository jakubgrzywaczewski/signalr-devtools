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
  const tabUpdated = event();
  const activation = {
    activateTab: vi.fn(),
    deactivateTab: vi.fn(() => Promise.resolve()),
    matchPatternForUrl: vi.fn((url) => {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}/*`;
    }),
    scriptIdsForTab: vi.fn((tabId) => [`signalr-bridge-${tabId}`, `signalr-main-${tabId}`]),
    toggleTab: vi.fn(() => Promise.resolve('active')),
  };
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
    scripting: {
      getRegisteredContentScripts: vi.fn(() => Promise.resolve([])),
    },
    tabs: { onRemoved: tabRemoved, onUpdated: tabUpdated },
  };
  const context = {
    chrome,
    console,
    importScripts: vi.fn(),
    Map,
    Number,
    Promise,
    Set,
    URL,
    WeakMap,
    SignalRInspectorActivation: activation,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(path.resolve('background.js'), 'utf8'), context);
  return { actionClick, activation, chrome, runtimeConnect, runtimeMessage, tabUpdated };
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

  it('removes sensitive endpoint query parameters at the service-worker boundary', () => {
    const { runtimeConnect, runtimeMessage } = loadBackground();
    runtimeMessage.dispatch(
      longPollingMessage({
        endpoint:
          'https://localhost/hub?id=connection-secret&access_token=jwt-secret&accessToken=legacy-secret&keep=1',
      }),
      {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/devtools.html',
      },
    );

    const port = connectPanel(runtimeConnect);
    expect(port.postMessage.mock.calls[0][0].payload[0].endpoint).toBe(
      new URL('/hub?keep=1', 'https://localhost').toString(),
    );
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

  it.each(['signalr-panel:', 'signalr-panel:0', 'signalr-panel:-1', 'signalr-panel:1.5'])(
    'disconnects malformed panel port %s',
    (name) => {
      const { runtimeConnect } = loadBackground();
      const port = {
        name,
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: event(),
        onMessage: event(),
      };

      runtimeConnect.dispatch(port);

      expect(port.disconnect).toHaveBeenCalledOnce();
      expect(port.postMessage).not.toHaveBeenCalled();
    },
  );

  it('keeps the service-worker log bounded by message count', () => {
    const { runtimeConnect, runtimeMessage } = loadBackground();
    const sender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/devtools.html',
    };

    for (let index = 0; index < 501; index += 1) {
      runtimeMessage.dispatch(longPollingMessage({ timestamp: index }), sender);
    }

    const port = connectPanel(runtimeConnect);
    const messages = port.postMessage.mock.calls[0][0].payload;
    expect(messages).toHaveLength(500);
    expect(messages[0].id).toBe(2);
    expect(messages.at(-1).id).toBe(501);
  });
});

describe('activation badge lifecycle', () => {
  it('shows the active state after enabling a tab from the toolbar', async () => {
    const { actionClick, chrome } = loadBackground();

    await Promise.all(actionClick.dispatch({ id: 42, url: 'https://example.com/chat' }));

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON', tabId: 42 });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      title: 'Disable SignalR Inspector for this tab',
      tabId: 42,
    });
  });

  it('clears the active state after disabling a tab from the toolbar', async () => {
    const { actionClick, activation, chrome } = loadBackground();
    activation.toggleTab.mockResolvedValue('inactive');

    await Promise.all(actionClick.dispatch({ id: 42, url: 'https://example.com/chat' }));

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 42 });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      title: 'Enable SignalR Inspector for this tab',
      tabId: 42,
    });
  });

  it('restores the active badge after a same-origin reload', async () => {
    const { chrome, tabUpdated } = loadBackground();
    chrome.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'signalr-bridge-42', matches: ['https://example.com/*'] },
      { id: 'signalr-main-42', matches: ['https://example.com/*'] },
    ]);

    tabUpdated.dispatch(42, { status: 'loading' }, { url: 'https://example.com/chat' });

    await vi.waitFor(() =>
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON', tabId: 42 }),
    );
  });

  it('removes stale registrations after a cross-origin navigation', async () => {
    const { activation, chrome, tabUpdated } = loadBackground();
    chrome.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'signalr-bridge-42', matches: ['https://example.com/*'] },
      { id: 'signalr-main-42', matches: ['https://example.com/*'] },
    ]);

    tabUpdated.dispatch(42, { status: 'complete' }, { url: 'https://another.example/chat' });

    await vi.waitFor(() => expect(activation.deactivateTab).toHaveBeenCalledWith(chrome, 42));
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });
});
