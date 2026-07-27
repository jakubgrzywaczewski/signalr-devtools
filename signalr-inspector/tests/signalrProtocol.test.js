import { describe, expect, it } from 'vitest';
import protocol from '../signalrProtocol.js';

const RS = '\u001e';

function message(textPayload) {
  return { encoding: 'text', textPayload, preview: textPayload };
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
});
