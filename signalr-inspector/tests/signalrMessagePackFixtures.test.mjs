import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import msgpack from '../msgpackDecoder.js';
import protocol from '../signalrProtocol.js';

globalThis.SignalRMsgPack = msgpack;

const fixtures = JSON.parse(readFileSync('tests/fixtures/signalr-messagepack.json', 'utf8'));

describe('official ASP.NET Core SignalR MessagePack fixtures', () => {
  for (const fixture of fixtures) {
    it(`decodes ${fixture.name}`, () => {
      const parsed = protocol.parsePayload({
        encoding: 'binary',
        preview: fixture.name,
        base64Payload: fixture.base64,
      });

      expect(parsed.diagnostic).toBe('');
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].value).toEqual(fixture.expected);
    });
  }
});
