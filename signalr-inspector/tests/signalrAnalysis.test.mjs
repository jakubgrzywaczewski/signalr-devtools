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
      'Keep-alive ping',
      'Keep-alive ping',
      'Stateful reconnect acknowledgement',
      'Stateful reconnect sequence',
      'Connection closed; reconnect allowed',
      'Connection observed',
      'Transport fallback',
      'Transport connected',
    ]);
    expect(result.timeline[5].detail).toBe('100 ms since previous ping');
    expect(result.connections[0]).toMatchObject({
      transport: 'websocket',
      status: 'reconnect allowed',
      outbound: { acknowledgedThrough: 12, resumesAt: 13 },
    });
    expect(result.connections[1]).toMatchObject({ transport: 'long polling' });
    expect(result.connections).toHaveLength(2);
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
});
