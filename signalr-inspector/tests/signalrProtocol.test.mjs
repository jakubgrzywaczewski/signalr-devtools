import { describe, expect, it } from 'vitest';
import msgpack from '../msgpackDecoder.js';
import protocol from '../signalrProtocol.js';

const RS = '\u001e';
globalThis.SignalRMsgPack = msgpack;

function message(textPayload) {
  return { encoding: 'text', textPayload, preview: textPayload };
}

function encodeMessagePack(value) {
  if (value === null) {
    return [0xc0];
  }
  if (value === true) {
    return [0xc3];
  }
  if (value === false) {
    return [0xc2];
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
    return [value];
  }
  if (typeof value === 'string') {
    const encoded = Array.from(new TextEncoder().encode(value));
    return [0xa0 | encoded.length, ...encoded];
  }
  if (Array.isArray(value)) {
    return [0x90 | value.length, ...value.flatMap(encodeMessagePack)];
  }
  const entries = Object.entries(value);
  return [
    0x80 | entries.length,
    ...entries.flatMap(([key, item]) => [...encodeMessagePack(key), ...encodeMessagePack(item)]),
  ];
}

function binaryMessage(...values) {
  const bytes = values.flatMap((value) => {
    const payload = encodeMessagePack(value);
    return [payload.length, ...payload];
  });
  return {
    encoding: 'binary',
    preview: 'MessagePack',
    base64Payload: Buffer.from(bytes).toString('base64'),
  };
}

describe('SignalR protocol parser', () => {
  it('parses the protocol handshake', () => {
    expect(protocol.parsePayload(message(`{"protocol":"json","version":1}${RS}`))).toMatchObject({
      kind: 'Handshake',
      summary: 'json protocol v1',
    });
  });

  it('extracts hub method and invocation ID', () => {
    const parsed = protocol.parsePayload(
      message(
        `${JSON.stringify({
          type: 1,
          invocationId: '42',
          target: 'SendMessage',
          arguments: ['Ada', 'Hello'],
        })}${RS}`,
      ),
    );

    expect(parsed).toMatchObject({
      kind: 'Invocation',
      target: 'SendMessage',
      invocationId: '42',
    });
  });

  it('parses multiple records in one transport frame', () => {
    const parsed = protocol.parsePayload(message(`{"type":6}${RS}{"type":7}${RS}`));
    expect(parsed.kind).toBe('Ping + Close');
    expect(parsed.records).toHaveLength(2);
  });

  it('pretty-prints JSON records', () => {
    expect(protocol.formatPayload(message(`{"type":3,"invocationId":"1"}${RS}`))).toContain(
      '"invocationId": "1"',
    );
  });

  it('parses every SignalR MessagePack hub message type', () => {
    const parsed = protocol.parsePayload(
      binaryMessage(
        [1, {}, '42', 'Send', ['hello'], []],
        [2, {}, '42', 'item'],
        [3, {}, '42', 3, 42],
        [4, {}, '43', 'Stream', [], []],
        [5, {}, '43'],
        [6],
        [7, 'bye', true],
        [8, 12],
        [9, 13],
      ),
    );

    expect(parsed.kind).toBe(
      'Invocation + Stream item + Completion + Stream invocation + Cancel invocation + Ping + Close + Acknowledgement + Sequence',
    );
    expect(parsed.target).toBe('Send');
    expect(parsed.invocationId).toBe('42');
    expect(parsed.records.map((record) => record.value)).toMatchObject([
      { type: 1, invocationId: '42', target: 'Send', arguments: ['hello'], streamIds: [] },
      { type: 2, invocationId: '42', item: 'item' },
      { type: 3, invocationId: '42', result: 42 },
      { type: 4, invocationId: '43', target: 'Stream' },
      { type: 5, invocationId: '43' },
      { type: 6 },
      { type: 7, error: 'bye', allowReconnect: true },
      { type: 8, sequenceId: 12 },
      { type: 9, sequenceId: 13 },
    ]);
  });

  it('parses MessagePack completion result kinds', () => {
    const parsed = protocol.parsePayload(
      binaryMessage([3, {}, '1', 1, 'failed'], [3, {}, '2', 2], [3, {}, '3', 3, 42]),
    );

    expect(parsed.records.map((record) => record.value)).toEqual([
      { type: 3, invocationId: '1', error: 'failed' },
      { type: 3, invocationId: '2' },
      { type: 3, invocationId: '3', result: 42 },
    ]);
  });

  it('shows decoded MessagePack and the original Base64 in details', () => {
    const captured = binaryMessage([1, {}, null, 'Notify', [], []]);
    const formatted = protocol.formatPayload(captured);

    expect(formatted).toContain('"target": "Notify"');
    expect(formatted).toContain(`Raw Base64:\n${captured.base64Payload}`);
  });

  it('falls back safely for incomplete or malformed binary frames', () => {
    const incomplete = {
      encoding: 'binary',
      preview: '91 06',
      base64Payload: Buffer.from([0x03, 0x91, 0x06]).toString('base64'),
    };
    expect(protocol.parsePayload(incomplete)).toMatchObject({
      kind: 'Binary',
      diagnostic: expect.stringContaining('incomplete'),
    });

    const malformed = binaryMessage('not an array');
    expect(protocol.parsePayload(malformed)).toMatchObject({
      kind: 'Binary',
      diagnostic: expect.stringContaining('not a SignalR hub message array'),
    });
  });

  it('preserves unknown MessagePack types and completion result kinds for diagnostics', () => {
    const parsed = protocol.parsePayload(
      binaryMessage([42, 'future payload'], [3, {}, '9', 9, 'future result']),
    );

    expect(parsed.records.map((record) => record.value)).toEqual([
      { type: 42, messagePack: ['future payload'] },
      { type: 3, invocationId: '9', resultKind: 9, result: 'future result' },
    ]);
  });

  it('reports trailing MessagePack bytes while retaining the decoded record', () => {
    const captured = {
      encoding: 'binary',
      preview: 'MessagePack with trailing byte',
      base64Payload: Buffer.from([0x03, 0x91, 0x06, 0x00]).toString('base64'),
    };
    const parsed = protocol.parsePayload(captured);

    expect(parsed.kind).toBe('Ping');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.diagnostic).toContain('1 trailing byte');
    expect(protocol.formatPayload(captured)).toContain('Raw Base64');
  });

  it('handles blob payloads, invalid Base64, and plain text fallbacks', () => {
    expect(
      protocol.parsePayload({
        encoding: 'blob:application/octet-stream',
        preview: '01 02',
      }),
    ).toMatchObject({ kind: 'Binary', summary: '01 02', records: [] });

    const invalidBase64 = {
      encoding: 'binary',
      preview: 'invalid',
      base64Payload: '%%%',
    };
    expect(protocol.formatPayload(invalidBase64)).toContain(
      'The captured binary payload is not valid Base64.',
    );
    expect(protocol.formatPayload(message(`plain text${RS}`))).toBe('plain text');
  });
});
