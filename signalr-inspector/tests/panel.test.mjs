import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import analysis from '../signalrAnalysis.js';

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
    preview: '{"type":1}',
    textPayload: '{"type":1}\u001e',
    ...overrides,
  };
}

function parsedMessage(id, direction, parsed, overrides = {}) {
  return message(id, { direction, parsed, ...overrides });
}

function loadPanel(ports = [createPort()], options = {}) {
  const dom = new JSDOM(panelHtml, {
    url: 'chrome-extension://extension-id/panel.html',
    runScripts: 'outside-only',
  });
  const parsePayload = vi.fn((payload) => ({
    kind: payload.parsed?.kind ?? 'Invocation',
    summary: payload.parsed?.summary ?? payload.preview,
    target: payload.parsed?.target ?? '',
    records: payload.parsed?.records ?? [],
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
  dom.window.SignalRAnalysis = analysis;
  if (options.requestAnimationFrame) {
    dom.window.requestAnimationFrame = options.requestAnimationFrame;
  }
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

  it('coalesces bursts of live messages into one animation-frame render', () => {
    const port = createPort();
    const frames = [];
    const requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { dom } = loadPanel([port], { requestAnimationFrame });

    port.onMessage.dispatch({ type: 'signalr-message', payload: message(1) });
    port.onMessage.dispatch({ type: 'signalr-message', payload: message(2) });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(0);
    frames[0](0);
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(2);
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
    expect(dom.window.document.getElementById('detailsMeta').textContent).toContain('Invocation');
    dom.window.close();
  });

  it('does not resurrect messages from an init response while clearing the log', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    port.onMessage.dispatch({ type: 'init', payload: [message(1)] });

    dom.window.document.getElementById('clearLog').click();
    port.onMessage.dispatch({ type: 'init', payload: [message(1)] });

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'clear-log' });
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(0);

    port.onMessage.dispatch({ type: 'reset' });
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(0);
    dom.window.close();
  });

  it('hides protocol pings by default and lets the user reveal or select them', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const ping = parsedMessage(1, 'incoming', {
      kind: 'Ping',
      records: [{ kind: 'Ping', value: { type: 6 } }],
    });
    const invocation = parsedMessage(2, 'outgoing', {
      kind: 'Invocation',
      target: 'Notify',
      records: [{ kind: 'Invocation', value: { type: 1, target: 'Notify' } }],
    });

    port.onMessage.dispatch({ type: 'init', payload: [ping, invocation] });

    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);
    expect(dom.window.document.querySelector('#messages tr').dataset.messageId).toBe('2');
    expect(dom.window.document.getElementById('stats').textContent).toBe('1 / 2 messages');

    const typeFilter = dom.window.document.getElementById('typeFilter');
    typeFilter.value = 'Ping';
    typeFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);
    expect(dom.window.document.querySelector('#messages tr').dataset.messageId).toBe('1');

    typeFilter.value = '';
    typeFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    dom.window.document.getElementById('showPings').click();
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(2);
    dom.window.close();
  });

  it('combines direction, message type, and transport filters', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const incomingWebSocket = parsedMessage(1, 'incoming', {
      kind: 'Invocation',
      records: [{ kind: 'Invocation', value: { type: 1 } }],
    });
    const outgoingLongPolling = parsedMessage(
      2,
      'outgoing',
      {
        kind: 'Completion',
        records: [{ kind: 'Completion', value: { type: 3 } }],
      },
      { transport: 'long polling' },
    );
    const incomingLongPolling = parsedMessage(
      3,
      'incoming',
      {
        kind: 'Invocation',
        records: [{ kind: 'Invocation', value: { type: 1 } }],
      },
      { transport: 'long polling' },
    );
    port.onMessage.dispatch({
      type: 'init',
      payload: [incomingWebSocket, outgoingLongPolling, incomingLongPolling],
    });

    for (const [id, value] of [
      ['directionFilter', 'incoming'],
      ['typeFilter', 'Invocation'],
      ['transportFilter', 'long polling'],
    ]) {
      const select = dom.window.document.getElementById(id);
      select.value = value;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }

    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);
    expect(dom.window.document.querySelector('#messages tr').dataset.messageId).toBe('3');
    expect(dom.window.document.getElementById('stats').textContent).toBe('1 / 3 messages');
    dom.window.close();
  });

  it('keeps the current scroll position when the user is reading older messages', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const wrapper = dom.window.document.querySelector('.table-wrapper');
    Object.defineProperties(wrapper, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1_000 },
    });
    wrapper.scrollTop = 100;

    port.onMessage.dispatch({ type: 'signalr-message', payload: message(1) });

    expect(wrapper.scrollTop).toBe(100);
    dom.window.close();
  });

  it('shows invocation duration and navigates to its completion', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const invocation = parsedMessage(
      1,
      'outgoing',
      {
        kind: 'Invocation',
        target: 'SendMessage',
        records: [
          {
            value: { type: 1, invocationId: '7', target: 'SendMessage', arguments: [] },
          },
        ],
      },
      { timestamp: 100 },
    );
    const completion = parsedMessage(
      2,
      'incoming',
      {
        kind: 'Completion',
        records: [{ value: { type: 3, invocationId: '7' } }],
      },
      { timestamp: 145 },
    );

    port.onMessage.dispatch({ type: 'init', payload: [invocation, completion] });

    const rows = dom.window.document.querySelectorAll('#messages tr');
    expect(rows[0].children[4].textContent).toContain('Completed · 45 ms');
    rows[0].click();
    const relation = dom.window.document.querySelector('#detailsRelations button');
    expect(relation.textContent).toBe('Go to Completion #2');
    const filter = dom.window.document.getElementById('payloadFilter');
    filter.value = 'Invocation';
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);

    dom.window.document.querySelector('#detailsRelations button').click();
    expect(dom.window.document.querySelector('#messages tr.selected').dataset.messageId).toBe('2');
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(2);
    expect(dom.window.document.querySelector('.relation-note').textContent).toBe(
      'Shown despite active filters.',
    );
    dom.window.close();
  });

  it('collapses stream items under their Stream invocation', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const stream = parsedMessage(1, 'outgoing', {
      kind: 'Stream invocation',
      target: 'Counter',
      records: [{ value: { type: 4, invocationId: '8', target: 'Counter', arguments: [] } }],
    });
    const firstItem = parsedMessage(2, 'incoming', {
      kind: 'Stream item',
      records: [{ value: { type: 2, invocationId: '8', item: 1 } }],
    });
    const secondItem = parsedMessage(3, 'incoming', {
      kind: 'Stream item',
      records: [{ value: { type: 2, invocationId: '8', item: 2 } }],
    });

    port.onMessage.dispatch({ type: 'init', payload: [stream, firstItem, secondItem] });

    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(3);
    const toggle = dom.window.document.querySelector('.stream-toggle');
    expect(toggle.textContent).toBe('▾ 2');
    toggle.click();
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(1);
    expect(dom.window.document.querySelector('.stream-toggle').textContent).toBe('▸ 2');

    port.onMessage.dispatch({ type: 'init', payload: [stream, firstItem, secondItem] });
    expect(dom.window.document.querySelectorAll('#messages tr')).toHaveLength(3);
    expect(dom.window.document.querySelector('.stream-toggle').textContent).toBe('▾ 2');
    dom.window.close();
  });

  it('renders lifecycle and stateful reconnect information in the Timeline view', () => {
    const port = createPort();
    const { dom } = loadPanel([port]);
    const negotiation = message(1, {
      transport: 'negotiation',
      encoding: 'lifecycle',
      lifecycleEvent: 'negotiate',
      lifecycleDetail: 'Available transports: WebSockets',
      parsed: { kind: 'Negotiate', records: [] },
    });
    const opened = message(2, {
      encoding: 'lifecycle',
      lifecycleEvent: 'transport-open',
      lifecycleDetail: 'WebSocket connected',
      parsed: { kind: 'Transport connected', records: [] },
    });
    const ack = parsedMessage(3, 'incoming', {
      kind: 'Acknowledgement',
      records: [{ value: { type: 8, sequenceId: 12 } }],
    });
    const sequence = parsedMessage(4, 'outgoing', {
      kind: 'Sequence',
      records: [{ value: { type: 9, sequenceId: 13 } }],
    });

    port.onMessage.dispatch({ type: 'init', payload: [negotiation, opened, ack, sequence] });
    expect(dom.window.document.querySelectorAll('#timelineEvents tr')).toHaveLength(0);
    const filter = dom.window.document.getElementById('payloadFilter');
    filter.value = 'Acknowledgement';
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.document.getElementById('timelineTab').click();

    expect(dom.window.document.getElementById('messagesView').hidden).toBe(true);
    expect(dom.window.document.getElementById('timelineView').hidden).toBe(false);
    expect(dom.window.document.querySelectorAll('#timelineEvents tr')).toHaveLength(4);
    expect(dom.window.document.getElementById('connectionSummary').textContent).toContain(
      'Outbound: delivered through #12 · resumes at #13',
    );
    expect(dom.window.document.getElementById('stats').textContent).toBe('4 lifecycle events');

    dom.window.document.querySelector('#timelineEvents tr').click();
    expect(dom.window.document.querySelector('#messages tr.selected').dataset.messageId).toBe('1');
    expect(dom.window.document.querySelector('.relation-note').textContent).toBe(
      'Shown despite active filters.',
    );
    dom.window.close();
  });
});
