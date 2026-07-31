import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.resolve(process.cwd(), 'injected.js'), 'utf8');
const RECORD_SEPARATOR = '\u001e';

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
  }

  send(data) {
    this.sent.push(data);
  }
}

class FakeEventSource extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.closeCalls = 0;
  }

  close() {
    this.closeCalls += 1;
  }
}

describe('page instrumentation', () => {
  let postedMessages;

  beforeEach(() => {
    const dom = new JSDOM('<!doctype html>', {
      url: 'https://localhost/',
      runScripts: 'outside-only',
    });
    postedMessages = [];
    dom.window.WebSocket = FakeWebSocket;
    dom.window.EventSource = FakeEventSource;
    dom.window.postMessage = vi.fn((message) => postedMessages.push(message));
    dom.window.eval(source);
    globalThis.window = dom.window;
  });

  it('ignores ordinary WebSocket traffic', async () => {
    const socket = new window.WebSocket('/socket');
    socket.send('hello');
    socket.dispatchEvent(new window.MessageEvent('message', { data: 'world' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages).toHaveLength(0);
  });

  it('detects SignalR by its handshake instead of the endpoint name', async () => {
    const socket = new window.WebSocket('/anything');
    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    socket.dispatchEvent(
      new window.MessageEvent('message', {
        data: `{"type":1,"target":"ReceiveMessage","arguments":["Ada","Hello"]}${RECORD_SEPARATOR}`,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages).toHaveLength(2);
    expect(postedMessages[0].payload.endpoint).toBe('https://localhost/anything');
    expect(postedMessages[0].payload.direction).toBe('outgoing');
    expect(postedMessages[1].payload.direction).toBe('incoming');
  });

  it('publishes lifecycle events only after the WebSocket is identified as SignalR', async () => {
    const socket = new window.WebSocket('/anything');
    socket.dispatchEvent(new window.Event('open'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postedMessages).toHaveLength(0);

    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages.map((message) => message.payload.lifecycleEvent)).toEqual([
      'transport-open',
      undefined,
    ]);
    expect(postedMessages[0].payload).toMatchObject({
      encoding: 'lifecycle',
      lifecycleDetail: 'WebSocket connected',
      transport: 'websocket',
      connectionSeq: 1,
    });

    socket.dispatchEvent(new window.CloseEvent('close', { code: 1000, reason: 'done' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages.at(-1).payload).toMatchObject({
      lifecycleEvent: 'transport-close',
      lifecycleDetail: 'Code 1000 · done',
      connectionSeq: 1,
    });
  });

  it('retains lifecycle events when the pre-detection data buffer overflows', async () => {
    const socket = new window.WebSocket('/anything');
    socket.dispatchEvent(new window.Event('open'));
    for (let index = 0; index < 12; index += 1) {
      socket.send(`ordinary-${index}`);
    }
    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages).toHaveLength(11);
    expect(postedMessages[0].payload.lifecycleEvent).toBe('transport-open');
    expect(postedMessages.slice(1).every((message) => message.payload.connectionSeq === 1)).toBe(
      true,
    );
  });

  it('captures explicit SSE close and deduplicates errors until reconnect', async () => {
    const eventSource = new window.EventSource('/hub');
    eventSource.dispatchEvent(new window.Event('open'));
    eventSource.dispatchEvent(
      new window.MessageEvent('message', { data: `{"type":6}${RECORD_SEPARATOR}` }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventSource.dispatchEvent(new window.Event('error'));
    eventSource.dispatchEvent(new window.Event('error'));
    eventSource.dispatchEvent(new window.Event('open'));
    eventSource.dispatchEvent(new window.Event('error'));
    eventSource.close();
    eventSource.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages.map((message) => message.payload.lifecycleEvent)).toEqual([
      'transport-open',
      undefined,
      'transport-error',
      'transport-open',
      'transport-error',
      'transport-close',
    ]);
    expect(postedMessages.at(-1).payload.lifecycleDetail).toBe('Server-Sent Events closed');
    expect(eventSource.closeCalls).toBe(2);
  });

  it('assigns separate connection sequences to concurrent sockets', async () => {
    const first = new window.WebSocket('/hub');
    const second = new window.WebSocket('/hub');
    first.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    second.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages.map((message) => message.payload.connectionSeq)).toEqual([1, 2]);
  });

  it('removes connection and access tokens from WebSocket endpoints', async () => {
    const socket = new window.WebSocket(
      '/hub?id=connection-secret&access_token=jwt-secret&accessToken=legacy-secret&keep=1',
    );
    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages[0].payload.endpoint).toBe(
      new URL('/hub?keep=1', window.location.href).toString(),
    );
    expect(JSON.stringify(postedMessages)).not.toContain('secret');
  });

  it('removes connection and access tokens from SSE endpoints', async () => {
    const eventSource = new window.EventSource(
      '/hub?id=connection-secret&access_token=jwt-secret&keep=1',
    );
    eventSource.dispatchEvent(
      new window.MessageEvent('message', {
        data: `{"type":6}${RECORD_SEPARATOR}`,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedMessages[0].payload.endpoint).toBe(
      new URL('/hub?keep=1', window.location.href).toString(),
    );
    expect(JSON.stringify(postedMessages)).not.toContain('secret');
  });
});
