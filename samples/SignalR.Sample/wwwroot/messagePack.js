(function exposeSignalRSampleMessagePack(root) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const MAX_COLLECTION_LENGTH = 1024;
  const MAX_FRAME_LENGTH = 1024 * 1024;

  function asBytes(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Expected binary MessagePack data.');
  }

  function join(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function withUint16(prefix, value) {
    return Uint8Array.of(prefix, value >>> 8, value & 0xff);
  }

  function withUint32(prefix, value) {
    return Uint8Array.of(prefix, value >>> 24, value >>> 16, value >>> 8, value);
  }

  function encodeInteger(value) {
    if (value >= 0 && value <= 0x7f) {
      return Uint8Array.of(value);
    }
    if (value >= -32 && value < 0) {
      return Uint8Array.of(0x100 + value);
    }
    if (value >= 0 && value <= 0xff) {
      return Uint8Array.of(0xcc, value);
    }
    if (value >= 0 && value <= 0xffff) {
      return withUint16(0xcd, value);
    }
    if (value >= 0 && value <= 0xffffffff) {
      return withUint32(0xce, value);
    }
    throw new RangeError('The sample MessagePack encoder supports only 32-bit integers.');
  }

  function encodeString(value) {
    const bytes = textEncoder.encode(value);
    let header;
    if (bytes.length <= 31) {
      header = Uint8Array.of(0xa0 | bytes.length);
    } else if (bytes.length <= 0xff) {
      header = Uint8Array.of(0xd9, bytes.length);
    } else if (bytes.length <= 0xffff) {
      header = withUint16(0xda, bytes.length);
    } else {
      header = withUint32(0xdb, bytes.length);
    }
    return join([header, bytes]);
  }

  function encodeArray(value) {
    const header =
      value.length <= 15 ? Uint8Array.of(0x90 | value.length) : withUint16(0xdc, value.length);
    return join([header, ...value.map(encode)]);
  }

  function encodeMap(value) {
    const entries = Object.entries(value);
    const header =
      entries.length <= 15
        ? Uint8Array.of(0x80 | entries.length)
        : withUint16(0xde, entries.length);
    return join([
      header,
      ...entries.flatMap(([key, entryValue]) => [encodeString(key), encode(entryValue)]),
    ]);
  }

  function encode(value) {
    if (value === null) {
      return Uint8Array.of(0xc0);
    }
    if (value === false) {
      return Uint8Array.of(0xc2);
    }
    if (value === true) {
      return Uint8Array.of(0xc3);
    }
    if (Number.isInteger(value)) {
      return encodeInteger(value);
    }
    if (typeof value === 'string') {
      return encodeString(value);
    }
    if (Array.isArray(value)) {
      return encodeArray(value);
    }
    if (typeof value === 'object') {
      return encodeMap(value);
    }
    throw new TypeError(`Unsupported MessagePack value: ${typeof value}`);
  }

  function encodeFrame(value) {
    const payload = encode(value);
    const prefix = [];
    let remaining = payload.length;
    do {
      let byte = remaining & 0x7f;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) {
        byte |= 0x80;
      }
      prefix.push(byte);
    } while (remaining > 0);
    return join([Uint8Array.from(prefix), payload]);
  }

  class Decoder {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.offset = 0;
    }

    require(length) {
      if (this.offset + length > this.bytes.length) {
        throw new RangeError('Truncated MessagePack value.');
      }
    }

    readByte() {
      this.require(1);
      const value = this.bytes[this.offset];
      this.offset += 1;
      return value;
    }

    readUnsigned(length) {
      this.require(length);
      const value =
        length === 1
          ? this.view.getUint8(this.offset)
          : length === 2
            ? this.view.getUint16(this.offset)
            : this.view.getUint32(this.offset);
      this.offset += length;
      return value;
    }

    readSigned(length) {
      this.require(length);
      const value =
        length === 1
          ? this.view.getInt8(this.offset)
          : length === 2
            ? this.view.getInt16(this.offset)
            : this.view.getInt32(this.offset);
      this.offset += length;
      return value;
    }

    readString(length) {
      this.require(length);
      const value = textDecoder.decode(this.bytes.subarray(this.offset, this.offset + length));
      this.offset += length;
      return value;
    }

    readArray(length) {
      if (length > MAX_COLLECTION_LENGTH) {
        throw new RangeError('MessagePack array is too large for the sample client.');
      }
      return Array.from({ length }, () => this.readValue());
    }

    readMap(length) {
      if (length > MAX_COLLECTION_LENGTH) {
        throw new RangeError('MessagePack map is too large for the sample client.');
      }
      return Object.fromEntries(Array.from({ length }, () => [this.readValue(), this.readValue()]));
    }

    readValue() {
      const prefix = this.readByte();
      if (prefix <= 0x7f) {
        return prefix;
      }
      if (prefix >= 0xe0) {
        return prefix - 0x100;
      }
      if (prefix >= 0xa0 && prefix <= 0xbf) {
        return this.readString(prefix & 0x1f);
      }
      if (prefix >= 0x90 && prefix <= 0x9f) {
        return this.readArray(prefix & 0x0f);
      }
      if (prefix >= 0x80 && prefix <= 0x8f) {
        return this.readMap(prefix & 0x0f);
      }

      switch (prefix) {
        case 0xc0:
          return null;
        case 0xc2:
          return false;
        case 0xc3:
          return true;
        case 0xcc:
          return this.readUnsigned(1);
        case 0xcd:
          return this.readUnsigned(2);
        case 0xce:
          return this.readUnsigned(4);
        case 0xd0:
          return this.readSigned(1);
        case 0xd1:
          return this.readSigned(2);
        case 0xd2:
          return this.readSigned(4);
        case 0xd9:
          return this.readString(this.readUnsigned(1));
        case 0xda:
          return this.readString(this.readUnsigned(2));
        case 0xdb:
          return this.readString(this.readUnsigned(4));
        case 0xdc:
          return this.readArray(this.readUnsigned(2));
        case 0xdd:
          return this.readArray(this.readUnsigned(4));
        case 0xde:
          return this.readMap(this.readUnsigned(2));
        case 0xdf:
          return this.readMap(this.readUnsigned(4));
        default:
          throw new RangeError(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
      }
    }
  }

  function decodeFrames(value) {
    const bytes = asBytes(value);
    const frames = [];
    let offset = 0;

    while (offset < bytes.length) {
      let length = 0;
      let multiplier = 1;
      let prefixByte;
      do {
        if (multiplier > 2 ** 28) {
          throw new RangeError('SignalR frame length prefix is too long.');
        }
        if (offset >= bytes.length) {
          throw new RangeError('Truncated SignalR frame length prefix.');
        }
        prefixByte = bytes[offset];
        offset += 1;
        length += (prefixByte & 0x7f) * multiplier;
        multiplier *= 128;
      } while ((prefixByte & 0x80) !== 0);

      if (length > MAX_FRAME_LENGTH) {
        throw new RangeError('SignalR MessagePack frame is too large for the sample client.');
      }
      if (offset + length > bytes.length) {
        throw new RangeError('Truncated SignalR MessagePack frame.');
      }
      const decoder = new Decoder(bytes.subarray(offset, offset + length));
      const frame = decoder.readValue();
      if (decoder.offset !== length) {
        throw new RangeError('Unexpected bytes after a SignalR MessagePack frame.');
      }
      frames.push(frame);
      offset += length;
    }

    return frames;
  }

  root.SignalRSampleMessagePack = { decodeFrames, encodeFrame };
})(globalThis);
