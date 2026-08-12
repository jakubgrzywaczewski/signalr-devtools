import { describe, expect, it, vi } from 'vitest';
import longPolling from '../longPolling.js';

const RS = '\u001e';
const endpoint = 'https://localhost/chatHub';
const token = 'secret-connection-token';

function request({
  url = `${endpoint}?id=${encodeURIComponent(token)}`,
  method = 'GET',
  status = 200,
  contentType = 'text/plain; charset=utf-8',
  content = '',
  encoding = '',
  postData,
  promiseContent = false,
} = {}) {
  const getContent = vi.fn((callback) => {
    if (promiseContent) {
      return Promise.resolve({ content, encoding });
    }
    callback(content, encoding);
    return undefined;
  });

  return {
    request: {
      url,
      method,
      ...(postData === undefined ? {} : { postData: { text: postData } }),
    },
    response: {
      status,
      headers: [{ name: 'Content-Type', value: contentType }],
    },
    getContent,
  };
}

function negotiationRequest(overrides = {}) {
  return request({
    url: `${endpoint}/negotiate?negotiateVersion=1`,
    method: 'POST',
    content: JSON.stringify({
      connectionId: 'public-connection-id',
      connectionToken: token,
      negotiateVersion: 1,
      availableTransports: [
        { transport: 'WebSockets', transferFormats: ['Text', 'Binary'] },
        { transport: 'LongPolling', transferFormats: ['Text', 'Binary'] },
      ],
    }),
    ...overrides,
  });
}

describe('Long Polling DevTools observer', () => {
  it('correlates negotiation, buffers the outgoing handshake, and captures the first poll', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish, now: () => 1234 });
    const handshake = `{"protocol":"json","version":1}${RS}`;
    const handshakeResponse = `{}${RS}`;

    await observer.observe(negotiationRequest());
    await observer.observe(request({ method: 'POST', postData: handshake }));

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'negotiation',
        lifecycleEvent: 'negotiate',
      }),
    );

    await observer.observe(request({ content: handshakeResponse }));

    expect(publish).toHaveBeenCalledTimes(4);
    expect(publish.mock.calls[1][0]).toMatchObject({
      transport: 'long polling',
      lifecycleEvent: 'transport-open',
    });
    expect(publish.mock.calls[2][0]).toMatchObject({
      transport: 'long polling',
      direction: 'outgoing',
      endpoint: `${endpoint}`,
      timestamp: 1234,
      encoding: 'text',
      textPayload: handshake,
    });
    expect(publish.mock.calls[3][0]).toMatchObject({
      direction: 'incoming',
      textPayload: handshakeResponse,
    });
    expect(publish.mock.calls.slice(1).map(([message]) => message.connectionSeq)).toEqual([
      1, 1, 1,
    ]);
    expect(JSON.stringify(publish.mock.calls)).not.toContain(token);
  });

  it('captures subsequent JSON invocations in both directions', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const outgoing = `${JSON.stringify({ type: 1, target: 'SendMessage' })}${RS}`;
    const incoming = `${JSON.stringify({ type: 1, target: 'ReceiveMessage' })}${RS}`;

    await observer.observe(negotiationRequest());
    await observer.observe(request({ content: `{}${RS}` }));
    publish.mockClear();

    await observer.observe(request({ method: 'POST', postData: outgoing }));
    await observer.observe(request({ content: btoa(incoming), encoding: 'base64' }));

    expect(publish.mock.calls.map(([message]) => message.direction)).toEqual([
      'outgoing',
      'incoming',
    ]);
    expect(publish.mock.calls.map(([message]) => message.textPayload)).toEqual([
      outgoing,
      incoming,
    ]);
    expect(publish.mock.calls[1][0].encoding).toBe('text');
  });

  it('detects Server-Sent Events from a second send with no completed polls', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish, now: () => 1234 });
    const handshake = `{"protocol":"json","version":1}${RS}`;
    const invocation = `${JSON.stringify({ type: 1, target: 'SendMessage' })}${RS}`;

    await observer.observe(negotiationRequest());
    await observer.observe(request({ method: 'POST', postData: handshake }));

    expect(publish).toHaveBeenCalledOnce();

    await observer.observe(request({ method: 'POST', postData: invocation }));

    expect(
      publish.mock.calls.map(([message]) => [
        message.transport,
        message.lifecycleEvent ?? message.direction,
      ]),
    ).toEqual([
      ['negotiation', 'negotiate'],
      ['server-sent events', 'transport-open'],
      ['server-sent events', 'outgoing'],
      ['server-sent events', 'outgoing'],
    ]);
    expect(publish.mock.calls[1][0]).toMatchObject({
      lifecycleDetail: 'Server-Sent Events connected',
      timestamp: 1234,
      connectionSeq: 1,
      endpoint,
    });
    expect(publish.mock.calls[2][0].textPayload).toBe(handshake);
    expect(publish.mock.calls[3][0].textPayload).toBe(invocation);
  });

  it('closes a Server-Sent Events connection when its stream ends', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const handshake = `{"protocol":"json","version":1}${RS}`;
    const invocation = `${JSON.stringify({ type: 1, target: 'SendMessage' })}${RS}`;

    await observer.observe(negotiationRequest());
    await observer.observe(request({ method: 'POST', postData: handshake }));
    await observer.observe(request({ method: 'POST', postData: invocation }));
    publish.mockClear();

    await observer.observe(request({ contentType: 'text/event-stream', content: '' }));

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'server-sent events',
        lifecycleEvent: 'transport-close',
        lifecycleDetail: 'Server-Sent Events stream ended',
        connectionSeq: 1,
      }),
    );
  });

  it('detects a receive-only Server-Sent Events connection when its stream ends', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const handshake = `{"protocol":"json","version":1}${RS}`;

    await observer.observe(negotiationRequest());
    await observer.observe(request({ method: 'POST', postData: handshake }));
    await observer.observe(request({ contentType: 'text/event-stream', content: '' }));

    expect(
      publish.mock.calls.map(([message]) => message.lifecycleEvent ?? message.direction),
    ).toEqual(['negotiate', 'transport-open', 'outgoing', 'transport-close']);
    expect(
      publish.mock.calls.slice(1).every(([message]) => message.transport === 'server-sent events'),
    ).toBe(true);
  });

  it('keeps queueing sends without negotiation instead of guessing Server-Sent Events', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const handshake = `{"protocol":"json","version":1}${RS}`;
    const invocation = `${JSON.stringify({ type: 1, target: 'SendMessage' })}${RS}`;

    await observer.observe(request({ method: 'POST', postData: handshake }));
    await observer.observe(request({ method: 'POST', postData: invocation }));

    expect(publish).not.toHaveBeenCalled();
  });

  it('detects an Azure SignalR redirect without retaining its access token', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(
      negotiationRequest({
        content: JSON.stringify({
          url: 'https://demo.service.signalr.net/client/?hub=chat&id=secret&access_token=query-secret',
          accessToken: 'jwt-secret',
        }),
      }),
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'negotiation',
        lifecycleEvent: 'azure-signalr-redirect',
        lifecycleDetail: 'https://demo.service.signalr.net/client/?hub=chat',
      }),
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain('secret');
  });

  it('does not label a generic SignalR redirect as Azure SignalR', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(
      negotiationRequest({
        content: JSON.stringify({
          url: 'https://signalr.example.com/client/?hub=chat',
          accessToken: 'token',
        }),
      }),
    );

    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores empty polls, timeouts, stream bodies, and unrelated HTTP traffic', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(negotiationRequest());
    await observer.observe(request({ content: '' }));
    await observer.observe(request({ status: 204, content: '' }));
    await observer.observe(
      request({
        contentType: 'text/event-stream',
        content: `data: {"type":6}${RS}\n\n`,
      }),
    );
    await observer.observe(
      request({
        url: 'https://localhost/api/items',
        content: `${JSON.stringify({ type: 1 })}${RS}`,
      }),
    );

    // The event-stream body is never captured as a message, but its end still closes the
    // already-detected connection under its published Long Polling label.
    expect(publish.mock.calls.map(([message]) => message.lifecycleEvent)).toEqual([
      'negotiate',
      'transport-open',
      'transport-close',
    ]);
  });

  it('publishes a labeled close and forgets the entry when a stream ends on a Long Polling connection', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(negotiationRequest());
    await observer.observe(request({ content: `{}${RS}` }));
    publish.mockClear();

    await observer.observe(request({ contentType: 'text/event-stream', content: '' }));

    // Never relabel: the connection was published as Long Polling, so it closes as one.
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'long polling',
        lifecycleEvent: 'transport-close',
        lifecycleDetail: 'Long Polling stream ended',
        connectionSeq: 1,
      }),
    );

    // The entry was removed with the token, so the next poll starts a fresh connection.
    publish.mockClear();
    await observer.observe(request({ content: `{"type":6}${RS}` }));

    expect(
      publish.mock.calls.map(([message]) => message.lifecycleEvent ?? message.direction),
    ).toEqual(['transport-open', 'incoming']);
    expect(publish.mock.calls[0][0].connectionSeq).toBe(2);
  });

  it('detects a SignalR poll even when DevTools missed negotiation', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const incoming = `${JSON.stringify({ type: 6 })}${RS}`;

    await observer.observe(request({ content: incoming }));

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'long polling',
        direction: 'incoming',
        endpoint,
        textPayload: incoming,
      }),
    );
  });

  it('assigns stable, distinct sequences to concurrent Long Polling connections', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const ping = `{"type":6}${RS}`;

    await observer.observe(request({ url: `${endpoint}?id=first`, content: ping }));
    await observer.observe(request({ url: `${endpoint}?id=second`, content: ping }));

    expect(publish.mock.calls.map(([message]) => message.connectionSeq)).toEqual([1, 1, 2, 2]);
  });

  it('keeps binary Long Polling responses as bounded Base64 payloads', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const binary = btoa(String.fromCharCode(1, 2, 3, 4));

    await observer.observe(negotiationRequest());
    await observer.observe(request({ content: `{}${RS}` }));
    publish.mockClear();
    await observer.observe(request({ content: binary, encoding: 'base64' }));

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        encoding: 'binary',
        size: 4,
        preview: '01 02 03 04',
        base64Payload: binary,
      }),
    );
  });

  it('supports promise-based getContent and reports retrieval errors without rejecting observation', async () => {
    const publish = vi.fn();
    const onError = vi.fn();
    const observer = longPolling.createObserver({ publish, onError });

    await observer.observe(negotiationRequest({ promiseContent: true }));
    await observer.observe(request({ content: `{}${RS}`, promiseContent: true }));
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls.map(([message]) => message.lifecycleEvent)).toEqual([
      'negotiate',
      'transport-open',
      undefined,
    ]);

    await observer.observe({
      request: {
        url: `${endpoint}?id=${encodeURIComponent(token)}`,
        method: 'GET',
      },
      response: { status: 200, headers: [] },
      getContent() {
        throw new Error('content unavailable');
      },
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'content unavailable' }),
    );
  });

  it('clears correlation state on navigation', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(negotiationRequest());
    observer.reset();
    publish.mockClear();
    await observer.observe(request({ method: 'POST', postData: `{"type":6}${RS}` }));

    expect(publish).not.toHaveBeenCalled();
  });

  it('discards response content that completes after navigation', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const delayedNegotiation = negotiationRequest();
    let releaseContent;
    delayedNegotiation.getContent = vi.fn((callback) => {
      releaseContent = callback;
    });

    const observation = observer.observe(delayedNegotiation);
    await vi.waitFor(() => expect(releaseContent).toBeTypeOf('function'));
    observer.reset();
    releaseContent(
      JSON.stringify({
        connectionToken: token,
        availableTransports: [{ transport: 'LongPolling' }],
      }),
      '',
    );
    await observation;

    await observer.observe(
      request({
        method: 'POST',
        postData: `{"protocol":"json","version":1}${RS}`,
      }),
    );
    await observer.observe(request({ content: 'not a SignalR response' }));

    expect(publish).not.toHaveBeenCalled();
  });

  it('bounds tracked connections and evicts the least recently used pending entry', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish, maxTrackedConnections: 2 });
    const handshake = `{"protocol":"json","version":1}${RS}`;

    await observer.observe(
      request({ url: `${endpoint}?id=first`, method: 'POST', postData: handshake }),
    );
    await observer.observe(request({ url: `${endpoint}?id=second`, content: '' }));
    await observer.observe(request({ url: `${endpoint}?id=third`, content: '' }));
    await observer.observe(request({ url: `${endpoint}?id=first`, content: `{"type":6}${RS}` }));

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'incoming',
        endpoint,
      }),
    );
  });

  it('ignores invalid sends and removes queued state after DELETE cleanup', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });
    const handshake = `{"protocol":"json","version":1}${RS}`;

    await observer.observe(request({ url: 'chrome-extension://extension/page', method: 'GET' }));
    await observer.observe(request({ method: 'POST', postData: 'not SignalR' }));
    await observer.observe(request({ method: 'POST', postData: handshake }));
    await observer.observe(request({ method: 'DELETE' }));
    await observer.observe(request({ content: `{}${RS}` }));

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'incoming',
        endpoint,
        textPayload: `{}${RS}`,
      }),
    );
  });

  it('publishes Long Polling cleanup after a detected connection is deleted', async () => {
    const publish = vi.fn();
    const observer = longPolling.createObserver({ publish });

    await observer.observe(negotiationRequest());
    await observer.observe(request({ content: `{}${RS}` }));
    publish.mockClear();
    await observer.observe(request({ method: 'DELETE' }));

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'long polling',
        lifecycleEvent: 'transport-close',
        lifecycleDetail: 'Long Polling connection deleted',
      }),
    );
  });
});
