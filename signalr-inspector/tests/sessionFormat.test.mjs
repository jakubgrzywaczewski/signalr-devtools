import { describe, expect, it } from 'vitest';
import sessionFormat from '../sessionFormat.js';

const sanitizedEndpoint = new URL('/chatHub', 'https://localhost');
sanitizedEndpoint.searchParams.set('keep', '1');
const SANITIZED_ENDPOINT = sanitizedEndpoint.toString();

function message(overrides = {}) {
  return {
    id: 17,
    tabId: 42,
    transport: 'websocket',
    direction: 'incoming',
    endpoint:
      'https://localhost/chatHub?id=connection-secret&access_token=token&accessToken=legacy&keep=1',
    timestamp: 1_722_424_800_000,
    size: 13,
    encoding: 'text',
    preview: '{"type":1}',
    textPayload: '{"type":1}\u001e',
    documentId: 'browser-document-id',
    connectionSeq: 2,
    unexpected: 'drop me',
    ...overrides,
  };
}

describe('SignalR Inspector session format', () => {
  it('round-trips allowlisted messages and removes transient or sensitive metadata', () => {
    const serialized = sessionFormat.serialize([message()], '2026-08-01T12:00:00.000Z');
    const parsed = sessionFormat.parse(serialized);

    expect(parsed).toMatchObject({
      format: 'signalr-inspector-session',
      version: 1,
      exportedAt: '2026-08-01T12:00:00.000Z',
    });
    expect(parsed.messages[0]).toMatchObject({
      endpoint: SANITIZED_ENDPOINT,
      documentId: 'browser-document-id',
      connectionSeq: 2,
      textPayload: '{"type":1}\u001e',
    });
    expect(parsed.messages[0]).not.toHaveProperty('id');
    expect(parsed.messages[0]).not.toHaveProperty('tabId');
    expect(parsed.messages[0]).not.toHaveProperty('unexpected');
    expect(serialized).not.toContain('connection-secret');
    expect(serialized).not.toContain('token');
  });

  it('preserves bounded lifecycle records', () => {
    const parsed = sessionFormat.parse(
      sessionFormat.serialize([
        message({
          transport: 'negotiation',
          encoding: 'lifecycle',
          textPayload: undefined,
          lifecycleEvent: 'negotiate',
          lifecycleDetail: 'Available transports: WebSockets',
          size: 0,
        }),
      ]),
    );

    expect(parsed.messages[0]).toMatchObject({
      lifecycleEvent: 'negotiate',
      lifecycleDetail: 'Available transports: WebSockets',
    });
  });

  it.each([
    ['not JSON', 'file is not valid JSON'],
    [
      JSON.stringify({
        format: 'other',
        version: 1,
        exportedAt: new Date().toISOString(),
        messages: [],
      }),
      'format must be',
    ],
    [
      JSON.stringify({
        format: sessionFormat.FORMAT,
        version: 2,
        exportedAt: new Date().toISOString(),
        messages: [],
      }),
      'unsupported format version 2',
    ],
    [
      JSON.stringify({
        format: sessionFormat.FORMAT,
        version: 1,
        exportedAt: 'never',
        messages: [],
      }),
      'exportedAt must be',
    ],
  ])('rejects an incompatible session', (serialized, expected) => {
    expect(() => sessionFormat.parse(serialized)).toThrow(expected);
  });

  it('rejects malformed messages and count overflow', () => {
    expect(() => sessionFormat.create([message({ direction: 'sideways' })])).toThrow(
      'unsupported direction',
    );
    expect(() =>
      sessionFormat.create(
        Array.from({ length: 501 }, (_, index) => message({ timestamp: index })),
      ),
    ).toThrow('at most 500 messages');
  });

  it.each([
    [null, 'must be an object'],
    [message({ transport: 'smtp' }), 'unsupported transport'],
    [message({ endpoint: 42 }), 'invalid endpoint'],
    [message({ endpoint: 'x'.repeat(4097) }), 'invalid endpoint'],
    [message({ timestamp: Number.NaN }), 'invalid timestamp'],
    [message({ size: -1 }), 'invalid size'],
    [message({ truncated: 'yes' }), 'invalid truncated flag'],
    [message({ connectionSeq: 0 }), 'invalid connection sequence'],
    [message({ documentId: 'x'.repeat(257) }), 'invalid document identity'],
    [message({ preview: 42 }), 'invalid preview'],
    [message({ preview: 'x'.repeat(350_001) }), 'invalid preview'],
    [message({ encoding: 'lifecycle' }), 'inconsistent lifecycle metadata'],
    [
      message({
        encoding: 'lifecycle',
        textPayload: undefined,
        lifecycleEvent: 'unknown',
        lifecycleDetail: 'Unknown event',
      }),
      'invalid lifecycle metadata',
    ],
    [message({ lifecycleDetail: 'orphaned detail' }), 'lifecycle detail without an event'],
  ])('rejects an invalid message field', (candidate, expected) => {
    expect(() => sessionFormat.create([candidate])).toThrow(expected);
  });

  it('normalizes empty and malformed endpoints without retaining their contents', () => {
    expect(sessionFormat.create([message({ endpoint: '' })]).messages[0].endpoint).toBe('');
    expect(sessionFormat.create([message({ endpoint: 'not a URL' })]).messages[0].endpoint).toBe(
      '',
    );
  });

  it('rejects invalid roots, message containers, timestamps, and oversized files', () => {
    expect(() => sessionFormat.create('messages')).toThrow('messages must be an array');
    expect(() => sessionFormat.create([], 42)).toThrow('exportedAt must be an ISO timestamp');
    expect(() => sessionFormat.create([], '2026-08-01T12:00:00+00:00')).toThrow(
      'exportedAt must be an ISO timestamp',
    );
    expect(() => sessionFormat.parse(42)).toThrow('file contents must be text');
    expect(() => sessionFormat.parse('[]')).toThrow('root value must be an object');
    expect(() => sessionFormat.parse('null')).toThrow('root value must be an object');
    expect(() => sessionFormat.parse('x'.repeat(sessionFormat.MAX_FILE_CHARACTERS + 1))).toThrow(
      'file exceeds the 64 MiB limit',
    );
  });

  it('rejects aggregate captured text above the in-memory budget', () => {
    const payload = 'x'.repeat(350_000);
    expect(() =>
      sessionFormat.create(
        Array.from({ length: 31 }, (_, index) =>
          message({ timestamp: index, preview: payload, textPayload: undefined }),
        ),
      ),
    ).toThrow('10 MiB session limit');
  });
});
