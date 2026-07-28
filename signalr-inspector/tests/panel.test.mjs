import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const panelSource = readFileSync(path.resolve('panel.js'), 'utf8');
const panelHtml = readFileSync(path.resolve('panel.html'), 'utf8');

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

function createPort() {
  return {
    postMessage: vi.fn(),
    onDisconnect: event(),
    onMessage: event(),
  };
}

function message(id, overrides = {}) {
  return {
    id,
    tabId: 42,
    transport: 'websocket',
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    timestamp: id,
    size: 13,
    encoding: 'text',
    preview: '{"type":6}',
    textPayload: '{"type":6}\u001e',
    ...overrides,
  };
}

function loadPanel(ports = [createPort()]) {
  const dom = new JSDOM(panelHtml, {
    url: 'chrome-extension://extension-id/panel.html',
    runScripts: 'outside-only',
  });
  const parsePayload = vi.fn((payload) => ({
    kind: 'Ping',
    summary: payload.preview,
    target: '',
    records: [],
  }));
  const connect = vi.fn(() => {
    const nextPort = ports[connect.mock.calls.length - 1];
    if (!nextPort) {
      throw new Error('No test port prepared for reconnect.');
    }
    return nextPort;
  });
  dom.window.chrome = {
    devtools: { inspectedWindow: { tabId: 42 } },
    runtime: { connect },
  };
  dom.window.SignalRProtocol = {
    parsePayload,
    formatPayload: vi.fn((payload) => payload.textPayload),
  };
  dom.window.eval(panelSource);
  return { connect, dom, parsePayload, ports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DevTools panel lifecycle', () => {
  it('reconnects after the service-worker port disconnects', () => {
    vi.useFakeTimers();
    const firstPort = createPort();
    const secondPort = createPort();
    const { connect, dom } = loadPanel([firstPort, secondPort]);

    firstPort.onDisconnect.dispatch();
    vi.advanceTimersByTime(100);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenLastCalledWith({ name: 'signalr-panel:42' });
    secondPort.onMessage.dispatch({ type: 'init', payload: [message(1)] });
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);
    dom.window.close();
  });

  it('keeps its local log bounded when new messages arrive', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    port.onMessage.dispatch({
      type: 'init',
      payload: Array.from({ length: 500 }, (_, index) => message(index + 1)),
    });

    port.onMessage.dispatch({ type: 'signalr-message', payload: message(501) });

    const rows = dom.window.document.querySelectorAll('#messages tr');
    expect(rows).toHaveLength(500);
    expect(rows[0].dataset.messageId).toBe('2');
    expect(rows[499].dataset.messageId).toBe('501');
    expect(dom.window.document.getElementById('stats').textContent).toBe('500 / 500 messages');
    dom.window.close();
  });

  it('caches parsed payloads across filter renders', () => {
    const port = createPort();
    const { dom, parsePayload } = loadPanel([port]);
    port.onMessage.dispatch({ type: 'init', payload: [message(1), message(2)] });
    expect(parsePayload).toHaveBeenCalledTimes(2);

    const filter = dom.window.document.getElementById('endpointFilter');
    filter.value = 'localhost';
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(parsePayload).toHaveBeenCalledTimes(2);
    dom.window.close();
  });

  it('lets keyboard users select a message row', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    port.onMessage.dispatch({ type: 'init', payload: [message(1)] });
    const row = dom.window.document.querySelector('#messages tr');

    expect(row.tabIndex).toBe(0);
    row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(dom.window.document.querySelector('#messages tr').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(dom.window.document.getElementById('detailsMeta').textContent).toContain('Ping');
    dom.window.close();
  });
});
