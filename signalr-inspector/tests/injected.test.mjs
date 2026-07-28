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
