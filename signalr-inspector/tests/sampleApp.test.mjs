import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const sampleDirectory = path.resolve(process.cwd(), '../samples/SignalR.Sample/wwwroot');
const markup = fs.readFileSync(path.join(sampleDirectory, 'index.html'), 'utf8');
const messagePackSource = fs.readFileSync(path.join(sampleDirectory, 'messagePack.js'), 'utf8');
const appSource = fs.readFileSync(path.join(sampleDirectory, 'app.js'), 'utf8');
const RECORD_SEPARATOR = '\u001e';

function createSample(url) {
  const dom = new JSDOM(markup, { url, runScripts: 'outside-only' });
  const sockets = [];

  class FakeWebSocket extends dom.window.EventTarget {
    constructor(endpoint) {
      super();
      this.url = endpoint;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }

    send(data) {
      this.sent.push(data);
    }

    close(code, reason) {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason;
      this.dispatchEvent(new dom.window.Event('close'));
    }
  }

  const fetch = vi.fn((endpoint, options = {}) => {
    if (endpoint === '/chatHub/negotiate?negotiateVersion=1') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ connectionToken: '1' }),
      });
    }
    if (endpoint === '/chatHub?id=1' && options.method !== 'POST') {
      return new Promise(() => undefined);
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
  });

  dom.window.WebSocket = FakeWebSocket;
  dom.window.TextEncoder = TextEncoder;
  dom.window.TextDecoder = TextDecoder;
  dom.window.fetch = fetch;
  dom.window.eval(messagePackSource);
  dom.window.eval(appSource);

  return { dom, fetch, sockets };
}

describe('SignalR sample app', () => {
  it('shows separate buttons for JSON, Long Polling, and MessagePack scenarios', () => {
    const dom = new JSDOM(markup);
    const buttons = [...dom.window.document.querySelectorAll('.scenario-button')];

    expect(buttons.map((button) => button.textContent.trim())).toEqual([
      'WebSockets (JSON)',
      'Long Polling (JSON)',
      'MessagePack (WebSockets)',
    ]);
    expect(buttons.map((button) => button.getAttribute('href'))).toEqual([
      '/',
      '/?transport=long-polling',
      '/?protocol=messagepack',
    ]);
  });

  it('round-trips longer Unicode strings through the sample MessagePack codec', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.TextEncoder = TextEncoder;
    dom.window.TextDecoder = TextDecoder;
    dom.window.eval(messagePackSource);
    const message = `Zażółć gęślą jaźń ${'x'.repeat(80)}`;

    const encoded = dom.window.SignalRSampleMessagePack.encodeFrame([
      1,
      {},
      '1',
      'SendMessage',
      ['Ada', message],
      [],
    ]);

    expect(dom.window.SignalRSampleMessagePack.decodeFrames(encoded)).toEqual([
      [1, {}, '1', 'SendMessage', ['Ada', message], []],
    ]);
  });

  it('connects and exchanges MessagePack hub messages over WebSockets', async () => {
    const { dom, sockets } = createSample('https://localhost/?protocol=messagepack');

    expect(dom.window.document.querySelector('[aria-current="page"]')?.dataset.scenario).toBe(
      'websockets-messagepack',
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    expect(socket.url).toBe('wss://localhost/chatHub?id=1');
    expect(socket.binaryType).toBe('arraybuffer');

    socket.dispatchEvent(new dom.window.Event('open'));
    expect(socket.sent).toEqual([`{"protocol":"messagepack","version":1}${RECORD_SEPARATOR}`]);

    const handshake = new TextEncoder().encode(`{}${RECORD_SEPARATOR}`);
    socket.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: handshake.buffer,
      }),
    );
    expect(dom.window.document.getElementById('status').textContent).toBe(
      'Connected to /chatHub using WebSockets + MessagePack',
    );
    expect(dom.window.document.getElementById('send').disabled).toBe(false);
    expect(dom.window.document.getElementById('stream').disabled).toBe(false);
    expect(dom.window.document.getElementById('reconnect').disabled).toBe(false);

    dom.window.document
      .getElementById('messageForm')
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(dom.window.SignalRSampleMessagePack.decodeFrames(socket.sent[1])).toEqual([
      [1, {}, '1', 'SendMessage', ['Ada', 'Hello from SignalR'], []],
    ]);

    dom.window.document.getElementById('stream').click();
    expect(dom.window.SignalRSampleMessagePack.decodeFrames(socket.sent[2])).toEqual([
      [4, {}, '2', 'StreamCounter', [3, 150], []],
    ]);

    const broadcast = dom.window.SignalRSampleMessagePack.encodeFrame([
      1,
      {},
      null,
      'ReceiveMessage',
      ['Ada', 'Hello from MessagePack'],
      [],
    ]);
    socket.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: broadcast.buffer,
      }),
    );
    expect(dom.window.document.querySelector('#messages li')?.textContent).toBe(
      'Ada: Hello from MessagePack',
    );

    socket.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: dom.window.SignalRSampleMessagePack.encodeFrame([2, {}, '2', 1]).buffer,
      }),
    );
    socket.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: dom.window.SignalRSampleMessagePack.encodeFrame([3, {}, '2', 2]).buffer,
      }),
    );
    expect(
      [...dom.window.document.querySelectorAll('#messages li')].map((item) => item.textContent),
    ).toEqual(['Stream 2 completed', 'Stream item 1', 'Ada: Hello from MessagePack']);
  });

  it('sends a JSON StreamInvocation and renders its items and completion', async () => {
    const { dom, sockets } = createSample('https://localhost/');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    socket.dispatchEvent(new dom.window.Event('open'));
    socket.dispatchEvent(new dom.window.MessageEvent('message', { data: `{}${RECORD_SEPARATOR}` }));

    dom.window.document.getElementById('stream').click();
    expect(JSON.parse(socket.sent[1].slice(0, -1))).toEqual({
      type: 4,
      invocationId: '1',
      target: 'StreamCounter',
      arguments: [3, 150],
    });

    socket.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: `${JSON.stringify({ type: 2, invocationId: '1', item: 1 })}${RECORD_SEPARATOR}${JSON.stringify({ type: 3, invocationId: '1' })}${RECORD_SEPARATOR}`,
      }),
    );
    expect(
      [...dom.window.document.querySelectorAll('#messages li')].map((item) => item.textContent),
    ).toEqual(['Stream 1 completed', 'Stream item 1']);
  });

  it('drops the active transport and negotiates a replacement connection', async () => {
    const { dom, fetch, sockets } = createSample('https://localhost/');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const firstSocket = sockets[0];
    firstSocket.dispatchEvent(new dom.window.Event('open'));
    firstSocket.dispatchEvent(
      new dom.window.MessageEvent('message', { data: `{}${RECORD_SEPARATOR}` }),
    );

    dom.window.document.getElementById('reconnect').click();

    expect(firstSocket.closed).toBe(true);
    expect(firstSocket.closeCode).toBe(4000);
    expect(dom.window.document.getElementById('status').textContent).toBe(
      'Transport dropped. Reconnecting…',
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 1_000 });
    expect(fetch).toHaveBeenCalledWith('/chatHub/negotiate?negotiateVersion=1', { method: 'POST' });
  });

  it('starts Long Polling and sends its JSON handshake', async () => {
    const { dom, fetch } = createSample('https://localhost/?transport=long-polling');

    expect(dom.window.document.querySelector('[aria-current="page"]')?.dataset.scenario).toBe(
      'long-polling-json',
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch).toHaveBeenNthCalledWith(2, '/chatHub?id=1', {
      headers: { Accept: 'text/plain' },
      signal: expect.any(dom.window.AbortSignal),
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/chatHub?id=1', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `{"protocol":"json","version":1}${RECORD_SEPARATOR}`,
    });
  });
});
