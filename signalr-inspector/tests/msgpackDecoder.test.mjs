import { describe, expect, it } from 'vitest';
import msgpack from '../msgpackDecoder.js';

function bytes(...values) {
  return Uint8Array.from(values.flat());
}

function decoded(...values) {
  return msgpack.decode(bytes(...values));
}

describe('MessagePack decoder', () => {
  it('decodes fixed primitives, arrays, and maps', () => {
    expect(decoded(0x2a).value).toBe(42);
    expect(decoded(0xff).value).toBe(-1);
    expect(decoded(0xc0).value).toBeNull();
    expect(decoded(0xc2).value).toBe(false);
    expect(decoded(0xc3).value).toBe(true);
    expect(decoded(0xa3, 0x66, 0x6f, 0x6f).value).toBe('foo');
    expect(decoded(0x93, 0x01, 0xc3, 0xa1, 0x78).value).toEqual([1, true, 'x']);
    expect(decoded(0x81, 0xa1, 0x78, 0x02).value).toEqual({ x: 2 });
  });

  it('decodes every integer family and preserves unsafe 64-bit values as strings', () => {
    expect(decoded(0xcc, 0xfe).value).toBe(254);
    expect(decoded(0xcd, 0x01, 0x00).value).toBe(256);
    expect(decoded(0xce, 0x00, 0x01, 0x00, 0x00).value).toBe(65_536);
    expect(decoded(0xcf, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a).value).toBe(42);
    expect(decoded(0xcf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff).value).toBe(
      (2n ** 64n - 1n).toString(),
    );
    expect(decoded(0xd0, 0x80).value).toBe(-128);
    expect(decoded(0xd1, 0x80, 0x00).value).toBe(-32_768);
    expect(decoded(0xd2, 0x80, 0x00, 0x00, 0x00).value).toBe(-2_147_483_648);
    expect(decoded(0xd3, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xd6).value).toBe(-42);
    expect(decoded(0xd3, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00).value).toBe(
      (-(2n ** 63n)).toString(),
    );
  });

  it('decodes floating point numbers', () => {
    expect(decoded(0xca, 0x3f, 0xc0, 0x00, 0x00).value).toBe(1.5);
    expect(decoded(0xcb, 0xc0, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00).value).toBe(-2.5);
  });

  it('decodes all string, binary, array, and map length families', () => {
    expect(decoded(0xd9, 0x01, 0x61).value).toBe('a');
    expect(decoded(0xda, 0x00, 0x01, 0x62).value).toBe('b');
    expect(decoded(0xdb, 0x00, 0x00, 0x00, 0x01, 0x63).value).toBe('c');

    for (const prefix of [
      [0xc4, 0x02],
      [0xc5, 0x00, 0x02],
      [0xc6, 0x00, 0x00, 0x00, 0x02],
    ]) {
      expect(decoded(prefix, 0xaa, 0xbb).value).toEqual({
        type: 'binary',
        length: 2,
        preview: 'aa bb',
      });
    }

    expect(decoded(0xdc, 0x00, 0x01, 0x01).value).toEqual([1]);
    expect(decoded(0xdd, 0x00, 0x00, 0x00, 0x01, 0x02).value).toEqual([2]);
    expect(decoded(0xde, 0x00, 0x01, 0xa1, 0x61, 0x01).value).toEqual({ a: 1 });
    expect(decoded(0xdf, 0x00, 0x00, 0x00, 0x01, 0xa1, 0x62, 0x02).value).toEqual({
      b: 2,
    });
  });

  it('decodes fixed and variable extensions, including MessagePack timestamps', () => {
    expect(decoded(0xd4, 0x01, 0xaa).value).toEqual({
      type: 'extension',
      extensionType: 1,
      length: 1,
      preview: 'aa',
    });
    expect(decoded(0xd5, 0x02, 0xaa, 0xbb).value.length).toBe(2);
    expect(decoded(0xd6, 0xff, 0x00, 0x00, 0x00, 0x00).value).toBe('1970-01-01T00:00:00.000Z');
    expect(decoded(0xd7, 0x03, 0, 0, 0, 0, 0, 0, 0, 0).value.length).toBe(8);
    expect(decoded(0xd8, 0x04, new Array(16).fill(0)).value.length).toBe(16);
    expect(decoded(0xc7, 0x01, 0x05, 0xaa).value.length).toBe(1);
    expect(decoded(0xc8, 0x00, 0x01, 0x06, 0xbb).value.length).toBe(1);
    expect(decoded(0xc9, 0x00, 0x00, 0x00, 0x01, 0x07, 0xcc).value.length).toBe(1);
  });

  it('reports corruption and resource-limit violations without throwing', () => {
    expect(decoded(0xc1).error).toContain('Unsupported');
    expect(decoded(0xd9, 0x05, 0x61).error).toContain('Truncated');

    const tooDeep = bytes(new Array(34).fill(0x91), 0xc0);
    expect(msgpack.decode(tooDeep).error).toContain('nesting');

    const declared = 100_001;
    const tooMany = new Uint8Array(5 + declared);
    tooMany.set([0xdd, 0x00, 0x01, 0x86, 0xa1]);
    tooMany.fill(0xc0, 5);
    expect(msgpack.decode(tooMany).error).toContain('100000');
  });

  it('never throws for deterministic random input', () => {
    let seed = 0x12345678;
    for (let sample = 0; sample < 1_000; sample += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const input = new Uint8Array(seed % 65);
      for (let index = 0; index < input.length; index += 1) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        input[index] = seed & 0xff;
      }
      expect(() => msgpack.decode(input)).not.toThrow();
    }
  });
});

describe('SignalR binary framing', () => {
  it('splits multiple VarInt-framed messages', () => {
    const frames = msgpack.decodeVarIntFrames(bytes(0x02, 0x91, 0x06, 0x02, 0x91, 0x06));
    expect(frames).toHaveLength(2);
    expect(Array.from(frames[0])).toEqual([0x91, 0x06]);
    expect(Array.from(frames[1])).toEqual([0x91, 0x06]);
    expect(frames.incomplete).toBe(false);
    expect(frames.error).toBe('');
  });

  it('distinguishes incomplete prefixes and payloads from invalid prefixes', () => {
    expect(msgpack.decodeVarIntFrames(bytes(0x80)).incomplete).toBe(true);
    expect(msgpack.decodeVarIntFrames(bytes(0x03, 0x91, 0x06)).incomplete).toBe(true);
    expect(msgpack.decodeVarIntFrames(bytes(0xff, 0xff, 0xff, 0xff, 0x07)).incomplete).toBe(true);
    expect(msgpack.decodeVarIntFrames(bytes(0x80, 0x80, 0x80, 0x80, 0x80)).error).toContain(
      'too long',
    );
    expect(msgpack.decodeVarIntFrames(bytes(0xff, 0xff, 0xff, 0xff, 0x08)).error).toContain(
      '2 GiB',
    );
  });
});
