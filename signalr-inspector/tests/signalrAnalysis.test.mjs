import { describe, expect, it } from 'vitest';
import analysis from '../signalrAnalysis.js';
import protocol from '../signalrProtocol.js';

const RS = '\u001e';

function message(id, direction, value, overrides = {}) {
  const textPayload = `${JSON.stringify(value)}${RS}`;
  return {
    id,
    direction,
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: id * 100,
    encoding: 'text',
    size: textPayload.length,
    preview: textPayload,
    textPayload,
    ...overrides,
  };
}

function lifecycle(id, eventType, transport = 'websocket', overrides = {}) {
  return {
    id,
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    transport,
    timestamp: id * 100,
    encoding: 'lifecycle',
    size: 0,
    preview: eventType,
    lifecycleEvent: eventType,
    lifecycleDetail: eventType,
    ...overrides,
  };
}

describe('SignalR conversation analysis', () => {
  it('pairs invocations with completions in the opposite direction', () => {
    const invocation = message(1, 'outgoing', {
      type: 1,
      invocationId: '42',
      target: 'SendMessage',
      arguments: [],
    });
    const completion = message(
      2,
      'incoming',
      {
        type: 3,
        invocationId: '42',
      },
      { timestamp: 145 },
    );

    const result = analysis.analyze([invocation, completion], protocol.parsePayload);

    expect(result.messageInfo.get(1)).toMatchObject({
      flowLabels: ['Completed · 45 ms'],
      relatedMessageIds: [2],
    });
    expect(result.messageInfo.get(2)).toMatchObject({
      flowLabels: ['↩ SendMessage #42'],
      relatedMessageIds: [1],
    });
  });

  it('keeps equal invocation IDs separate by connection and direction', () => {
    const outgoing = message(1, 'outgoing', {
      type: 1,
      invocationId: '1',
      target: 'ServerMethod',
      arguments: [],
    });
    const incoming = message(2, 'incoming', {
      type: 1,
      invocationId: '1',
      target: 'ClientMethod',
      arguments: [],
    });
    const outgoingCompletion = message(3, 'outgoing', { type: 3, invocationId: '1' });
    const incomingCompletion = message(4, 'incoming', { type: 3, invocationId: '1' });

    const result = analysis.analyze(
      [outgoing, incoming, outgoingCompletion, incomingCompletion],
      protocol.parsePayload,
    );

    expect(result.messageInfo.get(1).relatedMessageIds).toEqual([4]);
    expect(result.messageInfo.get(2).relatedMessageIds).toEqual([3]);
  });

  it('groups stream items and calculates their observed rate', () => {
    const stream = message(1, 'outgoing', {
      type: 4,
      invocationId: '7',
      target: 'Counter',
      arguments: [],
    });
    const firstItem = message(2, 'incoming', { type: 2, invocationId: '7', item: 1 });
    const secondItem = message(
      3,
      'incoming',
      { type: 2, invocationId: '7', item: 2 },
      {
        timestamp: 400,
      },
    );
    const completion = message(4, 'incoming', { type: 3, invocationId: '7' }, { timestamp: 500 });

    const result = analysis.analyze(
      [stream, firstItem, secondItem, completion],
      protocol.parsePayload,
    );

    expect(result.messageInfo.get(1)).toMatchObject({
      flowLabels: ['Completed · 2 items · 5.0/s · 400 ms'],
      relatedMessageIds: [4],
      streamChildren: [2, 3],
    });
    expect(result.messageInfo.get(2)).toMatchObject({
      streamParentId: 1,
      relatedMessageIds: [1],
    });
  });

  it('builds a lifecycle timeline and stateful reconnect summary', () => {
    const websocketEndpoint = { endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'negotiate', 'negotiation', {
        lifecycleDetail: 'WebSockets, ServerSentEvents, LongPolling',
      }),
      lifecycle(2, 'transport-open', 'websocket', websocketEndpoint),
      message(3, 'outgoing', { protocol: 'json', version: 1 }, websocketEndpoint),
      message(4, 'incoming', {}, websocketEndpoint),
      message(5, 'incoming', { type: 6 }, websocketEndpoint),
      message(6, 'incoming', { type: 6 }, websocketEndpoint),
      message(7, 'incoming', { type: 8, sequenceId: 12 }, websocketEndpoint),
      message(8, 'outgoing', { type: 9, sequenceId: 13 }, websocketEndpoint),
      message(
        9,
        'incoming',
        { type: 7, error: 'network', allowReconnect: true },
        websocketEndpoint,
      ),
      lifecycle(10, 'transport-open', 'long polling'),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.timeline.map((event) => event.label)).toEqual([
      'Negotiate',
      'Transport connected',
      'Handshake requested',
      'Handshake accepted',
      'Keep-alive pings',
      'Stateful reconnect acknowledgement',
      'Stateful reconnect sequence',
      'Connection closed; reconnect allowed',
      'Connection observed',
      'Transport fallback',
      'Transport connected',
    ]);
    expect(result.timeline[4].detail).toBe('2 pings · median gap 100 ms');
    expect(result.connections[0]).toMatchObject({
      transport: 'websocket',
      status: 'reconnect allowed',
      outbound: { acknowledgedThrough: 12, resumesAt: 13 },
    });
    expect(result.connections[1]).toMatchObject({ transport: 'long polling' });
    expect(result.connections).toHaveLength(2);
  });

  it('keeps concurrent sockets to the same endpoint in separate conversations', () => {
    const firstConnection = { connectionSeq: 1, documentId: 'document-a' };
    const secondConnection = { connectionSeq: 2, documentId: 'document-a' };
    const firstInvocation = message(
      1,
      'outgoing',
      { type: 1, invocationId: '1', target: 'First', arguments: [] },
      firstConnection,
    );
    const secondInvocation = message(
      2,
      'outgoing',
      { type: 1, invocationId: '1', target: 'Second', arguments: [] },
      secondConnection,
    );
    const secondCompletion = message(
      3,
      'incoming',
      { type: 3, invocationId: '1' },
      secondConnection,
    );
    const firstCompletion = message(4, 'incoming', { type: 3, invocationId: '1' }, firstConnection);

    const result = analysis.analyze(
      [firstInvocation, secondInvocation, secondCompletion, firstCompletion],
      protocol.parsePayload,
    );

    expect(result.connections).toHaveLength(2);
    expect(result.messageInfo.get(1).relatedMessageIds).toEqual([4]);
    expect(result.messageInfo.get(2).relatedMessageIds).toEqual([3]);
  });

  it('clamps negative observed durations to zero', () => {
    expect(analysis.formatDuration(-2_000)).toBe('0 ms');
  });

  it('reports pending and failed invocations', () => {
    const pending = message(1, 'outgoing', {
      type: 1,
      invocationId: '1',
      target: 'Pending',
      arguments: [],
    });
    const failed = message(2, 'outgoing', {
      type: 1,
      invocationId: '2',
      target: 'Failed',
      arguments: [],
    });
    const completion = message(3, 'incoming', {
      type: 3,
      invocationId: '2',
      error: 'boom',
    });

    const result = analysis.analyze([pending, failed, completion], protocol.parsePayload);

    expect(result.messageInfo.get(1).flowLabels).toEqual(['Pending #1']);
    expect(result.messageInfo.get(2).flowLabels).toEqual(['Error · 100 ms']);
  });

  it('calculates traffic and hub-method statistics and warns about stale large invocations', () => {
    const invocation = message(
      1,
      'outgoing',
      {
        type: 1,
        invocationId: 'large-1',
        target: 'UploadChunk',
        arguments: ['payload'],
      },
      { timestamp: 1_000, size: 27_000 },
    );
    const laterPing = message(2, 'incoming', { type: 6 }, { timestamp: 32_000, size: 12 });

    const result = analysis.analyze([invocation, laterPing], protocol.parsePayload);

    expect(result.insights.summary).toMatchObject({
      hubMessages: 2,
      capturedBytes: 27_012,
      durationMs: 31_000,
      azureConnections: 0,
    });
    expect(result.insights.summary.messagesPerSecond).toBeCloseTo(2 / 31);
    expect(result.insights.methods).toEqual([{ target: 'UploadChunk', count: 1, percentage: 50 }]);
    expect(result.insights.warnings).toEqual([
      expect.objectContaining({ kind: 'large-payload', messageId: 1, severity: 'warning' }),
      expect.objectContaining({ kind: 'pending-invocation', messageId: 1 }),
    ]);
  });

  it('flags a keep-alive gap only after establishing an observed baseline', () => {
    const messages = [
      message(1, 'incoming', { type: 6 }, { timestamp: 0 }),
      message(2, 'incoming', { type: 6 }, { timestamp: 15_000 }),
      message(3, 'incoming', { type: 6 }, { timestamp: 30_000 }),
      message(4, 'incoming', { type: 6 }, { timestamp: 60_001 }),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.insights.warnings).toEqual([
      expect.objectContaining({
        kind: 'keep-alive-gap',
        messageId: 4,
        detail: expect.stringContaining('observed median was 15.00 s'),
      }),
    ]);
  });

  it('does not warn about an active stream or a coalesced batch of smaller hub messages', () => {
    const stream = message(
      1,
      'outgoing',
      {
        type: 4,
        invocationId: 'stream-1',
        target: 'Counter',
        arguments: [],
      },
      { timestamp: 0 },
    );
    const batched = message(
      2,
      'outgoing',
      { type: 1, target: 'First', arguments: [] },
      {
        timestamp: 1_000,
        size: 27_000,
      },
    );
    batched.textPayload = `${JSON.stringify({ type: 1, target: 'First', arguments: [] })}${RS}${JSON.stringify({ type: 1, target: 'Second', arguments: [] })}${RS}`;
    const laterPing = message(3, 'incoming', { type: 6 }, { timestamp: 60_000 });

    const result = analysis.analyze([stream, batched, laterPing], protocol.parsePayload);

    expect(result.insights.warnings).toEqual([]);
  });

  it('correlates an Azure SignalR redirect with the service transport', () => {
    const azureEndpoint = 'https://demo.service.signalr.net/client/?hub=chat';
    const redirect = lifecycle(1, 'azure-signalr-redirect', 'negotiation', {
      lifecycleDetail: azureEndpoint,
    });
    const opened = lifecycle(2, 'transport-open', 'websocket', {
      endpoint: 'wss://demo.service.signalr.net/client/?hub=chat',
    });

    const result = analysis.analyze([redirect, opened], protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      azureEndpoint,
      endpoint: 'wss://demo.service.signalr.net/client/?hub=chat',
      transport: 'websocket',
    });
    expect(result.timeline.map((event) => event.label)).toEqual([
      'Azure SignalR redirect',
      'Transport connected',
    ]);
    expect(result.insights.summary.azureConnections).toBe(1);
  });

  it('merges the repeated service negotiation into the redirected Azure connection', () => {
    const azureEndpoint = 'https://demo.service.signalr.net/client/?hub=chat';
    const redirect = lifecycle(1, 'azure-signalr-redirect', 'negotiation', {
      lifecycleDetail: azureEndpoint,
    });
    const serviceNegotiate = lifecycle(2, 'negotiate', 'negotiation', {
      endpoint: azureEndpoint,
    });
    const opened = lifecycle(3, 'transport-open', 'websocket', {
      endpoint: 'wss://demo.service.signalr.net/client/?hub=chat',
    });

    const result = analysis.analyze([redirect, serviceNegotiate, opened], protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      azureEndpoint,
      endpoint: 'wss://demo.service.signalr.net/client/?hub=chat',
      transport: 'websocket',
      startedAt: 100,
    });
    expect(result.timeline.map((event) => event.label)).toEqual([
      'Azure SignalR redirect',
      'Negotiate',
      'Transport connected',
    ]);
    expect(result.insights.summary.azureConnections).toBe(1);
  });

  it('merges page and network observations of one Server-Sent Events connection', () => {
    const sse = 'server-sent events';
    const messages = [
      lifecycle(1, 'negotiate', 'negotiation'),
      lifecycle(2, 'transport-open', sse, {
        documentId: 'doc-1',
        connectionSeq: 1,
        lifecycleDetail: 'Server-Sent Events connected',
      }),
      lifecycle(3, 'transport-open', sse, {
        connectionSeq: 1,
        lifecycleDetail: 'Server-Sent Events connected',
      }),
      message(
        4,
        'outgoing',
        { type: 1, invocationId: '7', target: 'SendMessage', arguments: [] },
        { transport: sse, connectionSeq: 1 },
      ),
      message(
        5,
        'incoming',
        { type: 3, invocationId: '7' },
        { transport: sse, documentId: 'doc-1', connectionSeq: 1 },
      ),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].transport).toBe(sse);
    expect(result.timeline.filter((event) => event.kind === 'transport-open')).toHaveLength(1);
    expect(result.messageInfo.get(4).connectionId).toBe(result.messageInfo.get(5).connectionId);
    expect(result.messageInfo.get(4)).toMatchObject({ flowLabels: ['Completed · 100 ms'] });
  });

  it('merges the observers in either arrival order without touching closed connections', () => {
    const sse = 'server-sent events';
    const messages = [
      lifecycle(1, 'transport-open', sse, { connectionSeq: 1 }),
      lifecycle(2, 'transport-open', sse, { documentId: 'doc-1', connectionSeq: 1 }),
      lifecycle(3, 'transport-close', sse, { connectionSeq: 1 }),
      lifecycle(4, 'transport-open', sse, { documentId: 'doc-1', connectionSeq: 2 }),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].closed).toBe(true);
    expect(result.connections[1].closed).toBe(false);
  });

  it('keeps Azure correlation and fresh start times across a reconnect cycle', () => {
    const azureEndpoint = 'https://demo.service.signalr.net/client/?hub=chat';
    const serviceSocket = 'wss://demo.service.signalr.net/client/?hub=chat';
    const messages = [
      lifecycle(1, 'azure-signalr-redirect', 'negotiation', { lifecycleDetail: azureEndpoint }),
      lifecycle(2, 'negotiate', 'negotiation', { endpoint: azureEndpoint }),
      lifecycle(3, 'transport-open', 'websocket', { endpoint: serviceSocket }),
      lifecycle(4, 'transport-close', 'websocket', { endpoint: serviceSocket }),
      lifecycle(5, 'azure-signalr-redirect', 'negotiation', { lifecycleDetail: azureEndpoint }),
      lifecycle(6, 'negotiate', 'negotiation', { endpoint: azureEndpoint }),
      lifecycle(7, 'transport-open', 'websocket', { endpoint: serviceSocket }),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(2);
    expect(result.connections[0]).toMatchObject({
      azureEndpoint,
      transport: 'websocket',
      startedAt: 100,
    });
    expect(result.connections[1]).toMatchObject({
      azureEndpoint,
      transport: 'websocket',
      startedAt: 500,
    });
    expect(result.insights.summary.azureConnections).toBe(2);
  });
});
