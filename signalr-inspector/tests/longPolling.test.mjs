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

    expect(publish).not.toHaveBeenCalled();

    await observer.observe(request({ content: handshakeResponse }));

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toMatchObject({
      transport: 'long polling',
      direction: 'outgoing',
      endpoint: `${endpoint}`,
      timestamp: 1234,
      encoding: 'text',
      textPayload: handshake,
    });
    expect(publish.mock.calls[1][0]).toMatchObject({
      direction: 'incoming',
      textPayload: handshakeResponse,
    });
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

  it('ignores empty polls, timeouts, SSE streams, and unrelated HTTP traffic', async () => {
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

    expect(publish).not.toHaveBeenCalled();
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
    expect(publish).toHaveBeenCalledOnce();

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
});
