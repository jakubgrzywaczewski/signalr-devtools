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
    expect(analysis.formatDuration(-2000)).toBe('0 ms');
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
      { timestamp: 1000, size: 27_000 },
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
        timestamp: 1000,
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

  it('merges a resumed transport whose first frame is a Sequence into the dropped connection', () => {
    const socket1 = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socket2 = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socket1),
      message(2, 'outgoing', { protocol: 'json', version: 1 }, socket1),
      message(3, 'incoming', {}, socket1),
      message(
        4,
        'outgoing',
        { type: 4, invocationId: '7', target: 'StreamCounter', arguments: [10] },
        socket1,
      ),
      message(5, 'incoming', { type: 2, invocationId: '7', item: 1 }, socket1),
      message(6, 'incoming', { type: 2, invocationId: '7', item: 2 }, socket1),
      lifecycle(7, 'transport-close', 'websocket', socket1),
      lifecycle(8, 'transport-open', 'websocket', socket2),
      message(9, 'outgoing', { type: 9, sequenceId: 2 }, socket2),
      message(10, 'incoming', { type: 9, sequenceId: 1 }, socket2),
      message(11, 'incoming', { type: 2, invocationId: '7', item: 3 }, socket2),
      message(12, 'incoming', { type: 3, invocationId: '7' }, socket2),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      status: 'connected',
      transport: 'websocket',
      outbound: { resumesAt: 2 },
      inbound: { resumesAt: 1 },
    });
    // The split card's events were reparented and its duplicate "Connection observed" removed —
    // only the original connection's own event remains.
    expect(result.timeline.filter((event) => event.label === 'Connection observed')).toHaveLength(
      1,
    );
    expect(new Set(result.timeline.map((event) => event.connectionId)).size).toBe(1);
    // The stream started before the drop absorbs the items delivered after the resume.
    expect(result.messageInfo.get(4)).toMatchObject({
      streamChildren: [5, 6, 11],
      flowLabels: ['Completed · 3 items · 3.3/s · 800 ms'],
    });
  });

  it('merges a stateful resume even when the capture missed the original handshake', () => {
    // Clearing the log, activating on an already-connected page, or evicting the oldest
    // entries all leave the interrupted connection without a captured handshake; its hub
    // traffic is equivalent proof that a Sequence-first transport resumes it.
    const socket1 = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socket2 = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      message(
        1,
        'outgoing',
        { type: 1, invocationId: '0', target: 'SendMessage', arguments: ['Ada', 'hi'] },
        socket1,
      ),
      message(2, 'incoming', { type: 3, invocationId: '0' }, socket1),
      message(3, 'outgoing', { type: 8, sequenceId: 2 }, socket1),
      lifecycle(4, 'transport-close', 'websocket', socket1),
      lifecycle(5, 'transport-open', 'websocket', socket2),
      message(6, 'outgoing', { type: 9, sequenceId: 2 }, socket2),
      message(7, 'incoming', { type: 9, sequenceId: 1 }, socket2),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      status: 'connected',
      outbound: { resumesAt: 2 },
      inbound: { resumesAt: 1 },
    });
    expect(result.timeline.filter((event) => event.label === 'Connection observed')).toHaveLength(
      1,
    );
  });

  it('merges a stateful resume into the temporally closest interrupted candidate', () => {
    const socketA = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socketB = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const socketC = { documentId: 'doc', connectionSeq: 3, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socketA),
      message(2, 'outgoing', { protocol: 'json', version: 1 }, socketA),
      message(3, 'incoming', {}, socketA),
      lifecycle(4, 'transport-open', 'websocket', socketB),
      message(5, 'outgoing', { protocol: 'json', version: 1 }, socketB),
      message(6, 'incoming', {}, socketB),
      // B (created later) drops first, A drops closer to the resume: the resume must pick A
      // by temporal proximity, not by creation order.
      lifecycle(7, 'transport-close', 'websocket', socketB),
      lifecycle(8, 'transport-close', 'websocket', socketA),
      lifecycle(9, 'transport-open', 'websocket', socketC),
      message(10, 'outgoing', { type: 9, sequenceId: 5 }, socketC),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(2);
    const resumed = result.connections.find((connection) => connection.startedAt === 100);
    expect(resumed).toMatchObject({ status: 'connected', outbound: { resumesAt: 5 } });
    const untouched = result.connections.find((connection) => connection.startedAt === 400);
    expect(untouched).toMatchObject({ status: 'disconnected', outbound: { resumesAt: null } });
  });

  it('does not merge a Sequence preceded by other hub frames on a handshake-less transport', () => {
    const socket1 = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socket2 = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socket1),
      message(
        2,
        'outgoing',
        { type: 1, invocationId: '1', target: 'Send', arguments: [] },
        socket1,
      ),
      lifecycle(3, 'transport-close', 'websocket', socket1),
      lifecycle(4, 'transport-open', 'websocket', socket2),
      // An invocation before the Sequence proves this transport is not a fresh resume.
      message(
        5,
        'outgoing',
        { type: 1, invocationId: '2', target: 'Send', arguments: [] },
        socket2,
      ),
      message(6, 'outgoing', { type: 9, sequenceId: 3 }, socket2),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].status).toBe('disconnected');
    expect(result.connections[1]).toMatchObject({
      status: 'connected',
      outbound: { resumesAt: 3 },
    });
  });

  it('keeps the card intact when a sequenceId is not an integer', () => {
    const socket = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socket),
      message(2, 'outgoing', { type: 9, sequenceId: {} }, socket),
      message(3, 'incoming', { type: 8, sequenceId: 'twelve' }, socket),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections[0]).toMatchObject({
      outbound: { acknowledgedThrough: null, resumesAt: null },
    });
    const details = result.timeline.map((event) => event.detail).join('\n');
    expect(details).not.toContain('[object Object]');
    expect(result.timeline.find((event) => event.kind === 'sequence').detail).toBe(
      'Outbound resumes at (invalid sequenceId)',
    );
    expect(result.timeline.find((event) => event.kind === 'ack').detail).toBe(
      'Outbound delivered through (invalid sequenceId)',
    );
  });

  it('keeps a single keep-alive event when pings surround a stateful resume', () => {
    const socket1 = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socket2 = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socket1),
      message(2, 'outgoing', { protocol: 'json', version: 1 }, socket1),
      message(3, 'incoming', {}, socket1),
      message(4, 'incoming', { type: 6 }, socket1),
      message(5, 'incoming', { type: 6 }, socket1),
      lifecycle(6, 'transport-close', 'websocket', socket1),
      lifecycle(7, 'transport-open', 'websocket', socket2),
      // A ping may precede the resumed transport's Sequence without breaking the merge.
      message(8, 'incoming', { type: 6 }, socket2),
      message(9, 'outgoing', { type: 9, sequenceId: 2 }, socket2),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(1);
    const pingEvents = result.timeline.filter((event) => event.label === 'Keep-alive pings');
    expect(pingEvents).toHaveLength(1);
    expect(pingEvents[0].detail).toBe('3 pings · median gap 100 ms');
    expect(pingEvents[0].connectionId).toBe(result.connections[0].id);
  });

  it('keeps a reconnect that opens with a handshake as a separate connection', () => {
    const socket1 = { documentId: 'doc', connectionSeq: 1, endpoint: 'wss://localhost/chatHub' };
    const socket2 = { documentId: 'doc', connectionSeq: 2, endpoint: 'wss://localhost/chatHub' };
    const messages = [
      lifecycle(1, 'transport-open', 'websocket', socket1),
      message(2, 'outgoing', { protocol: 'json', version: 1 }, socket1),
      message(3, 'incoming', {}, socket1),
      lifecycle(4, 'transport-close', 'websocket', socket1),
      lifecycle(5, 'transport-open', 'websocket', socket2),
      message(6, 'outgoing', { protocol: 'json', version: 1 }, socket2),
      message(7, 'incoming', {}, socket2),
      message(8, 'outgoing', { type: 9, sequenceId: 4 }, socket2),
    ];

    const result = analysis.analyze(messages, protocol.parsePayload);

    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].status).toBe('disconnected');
    expect(result.connections[1].status).toBe('connected');
  });

  it('does not resume across a server-initiated close or outside the resume window', () => {
    const cleanSocket1 = {
      documentId: 'doc',
      connectionSeq: 1,
      endpoint: 'wss://localhost/chatHub',
    };
    const cleanSocket2 = {
      documentId: 'doc',
      connectionSeq: 2,
      endpoint: 'wss://localhost/chatHub',
    };
    const cleanClose = analysis.analyze(
      [
        lifecycle(1, 'transport-open', 'websocket', cleanSocket1),
        message(2, 'outgoing', { protocol: 'json', version: 1 }, cleanSocket1),
        message(3, 'incoming', {}, cleanSocket1),
        message(4, 'incoming', { type: 7, allowReconnect: true }, cleanSocket1),
        lifecycle(5, 'transport-close', 'websocket', cleanSocket1),
        lifecycle(6, 'transport-open', 'websocket', cleanSocket2),
        message(7, 'outgoing', { type: 9, sequenceId: 1 }, cleanSocket2),
      ],
      protocol.parsePayload,
    );
    expect(cleanClose.connections).toHaveLength(2);

    const lateResume = analysis.analyze(
      [
        lifecycle(1, 'transport-open', 'websocket', cleanSocket1),
        message(2, 'outgoing', { protocol: 'json', version: 1 }, cleanSocket1),
        message(3, 'incoming', {}, cleanSocket1),
        lifecycle(4, 'transport-close', 'websocket', cleanSocket1),
        lifecycle(5, 'transport-open', 'websocket', { ...cleanSocket2, timestamp: 40_000 }),
        message(6, 'outgoing', { type: 9, sequenceId: 1 }, { ...cleanSocket2, timestamp: 40_100 }),
      ],
      protocol.parsePayload,
    );
    expect(lateResume.connections).toHaveLength(2);
  });
});
