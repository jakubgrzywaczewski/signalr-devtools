'use strict';

(function exposeSignalRMsgPack(root) {
  const MAX_DEPTH = 32;
  const MAX_ELEMENTS = 100_000;
  const MAX_VARINT_BYTES = 5;
  const BINARY_PREVIEW_BYTES = 32;
  const textDecoder = new TextDecoder();

  function asBytes(input) {
    if (input instanceof Uint8Array) {
      return input;
    }
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError('MessagePack input must be binary data.');
  }

  function safeInteger(value) {
    const minimum = BigInt(Number.MIN_SAFE_INTEGER);
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    return value >= minimum && value <= maximum ? Number(value) : value.toString();
  }

  function bytesPreview(bytes) {
    const shown = bytes.subarray(0, BINARY_PREVIEW_BYTES);
    const hex = Array.from(shown, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
    return bytes.length > shown.length ? `${hex} …` : hex;
  }

  function binaryValue(bytes) {
    return {
      type: 'binary',
      length: bytes.length,
      preview: bytesPreview(bytes),
    };
  }

  function timestampValue(bytes) {
    let seconds;
    let nanoseconds;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length === 4) {
      seconds = BigInt(view.getUint32(0));
      nanoseconds = 0;
    } else if (bytes.length === 8) {
      const packed = view.getBigUint64(0);
      nanoseconds = Number(packed >> 34n);
      seconds = packed & 0x3ffffffffn;
    } else if (bytes.length === 12) {
      nanoseconds = view.getUint32(0);
      seconds = view.getBigInt64(4);
    } else {
      return null;
    }

    const milliseconds = Number(seconds) * 1000 + Math.floor(nanoseconds / 1_000_000);
    const date = new Date(milliseconds);
    if (Number.isFinite(milliseconds) && !Number.isNaN(date.getTime())) {
      return date.toISOString();
    }

    return {
      type: 'timestamp',
      seconds: seconds.toString(),
      nanoseconds,
    };
  }

  class Decoder {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.offset = 0;
      this.elements = 0;
    }

    require(length) {
      if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
        throw new RangeError('Truncated MessagePack value.');
      }
    }

    countElement() {
      this.elements += 1;
      if (this.elements > MAX_ELEMENTS) {
        throw new RangeError(`MessagePack value exceeds ${MAX_ELEMENTS} elements.`);
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
      let value;
      if (length === 1) {
        value = this.view.getUint8(this.offset);
      } else if (length === 2) {
        value = this.view.getUint16(this.offset);
      } else if (length === 4) {
        value = this.view.getUint32(this.offset);
      } else {
        value = safeInteger(this.view.getBigUint64(this.offset));
      }
      this.offset += length;
      return value;
    }

    readSigned(length) {
      this.require(length);
      let value;
      if (length === 1) {
        value = this.view.getInt8(this.offset);
      } else if (length === 2) {
        value = this.view.getInt16(this.offset);
      } else if (length === 4) {
        value = this.view.getInt32(this.offset);
      } else {
        value = safeInteger(this.view.getBigInt64(this.offset));
      }
      this.offset += length;
      return value;
    }

    readFloat(length) {
      this.require(length);
      const value =
        length === 4 ? this.view.getFloat32(this.offset) : this.view.getFloat64(this.offset);
      this.offset += length;
      return value;
    }

    readBytes(length) {
      this.require(length);
      const value = this.bytes.subarray(this.offset, this.offset + length);
      this.offset += length;
      return value;
    }

    readString(length) {
      return textDecoder.decode(this.readBytes(length));
    }

    readArray(length, depth) {
      if (length > MAX_ELEMENTS) {
        throw new RangeError(`MessagePack array exceeds ${MAX_ELEMENTS} elements.`);
      }
      const value = [];
      for (let index = 0; index < length; index += 1) {
        value.push(this.readValue(depth + 1));
      }
      return value;
    }

    readMap(length, depth) {
      if (length > MAX_ELEMENTS) {
        throw new RangeError(`MessagePack map exceeds ${MAX_ELEMENTS} entries.`);
      }
      const value = Object.create(null);
      for (let index = 0; index < length; index += 1) {
        const key = this.readValue(depth + 1);
        const mapKey = typeof key === 'string' ? key : JSON.stringify(key);
        value[mapKey ?? String(key)] = this.readValue(depth + 1);
      }
      return value;
    }

    readExtension(length) {
      const extensionType = this.readSigned(1);
      const bytes = this.readBytes(length);
      if (extensionType === -1) {
        const timestamp = timestampValue(bytes);
        if (timestamp !== null) {
          return timestamp;
        }
      }
      return {
        type: 'extension',
        extensionType,
        length,
        preview: bytesPreview(bytes),
      };
    }

    readValue(depth = 0) {
      if (depth > MAX_DEPTH) {
        throw new RangeError(`MessagePack nesting exceeds ${MAX_DEPTH} levels.`);
      }
      this.countElement();
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
        return this.readArray(prefix & 0x0f, depth);
      }
      if (prefix >= 0x80 && prefix <= 0x8f) {
        return this.readMap(prefix & 0x0f, depth);
      }

      switch (prefix) {
        case 0xc0:
          return null;
        case 0xc2:
          return false;
        case 0xc3:
          return true;
        case 0xc4:
          return binaryValue(this.readBytes(this.readUnsigned(1)));
        case 0xc5:
          return binaryValue(this.readBytes(this.readUnsigned(2)));
        case 0xc6:
          return binaryValue(this.readBytes(this.readUnsigned(4)));
        case 0xc7:
          return this.readExtension(this.readUnsigned(1));
        case 0xc8:
          return this.readExtension(this.readUnsigned(2));
        case 0xc9:
          return this.readExtension(this.readUnsigned(4));
        case 0xca:
          return this.readFloat(4);
        case 0xcb:
          return this.readFloat(8);
        case 0xcc:
          return this.readUnsigned(1);
        case 0xcd:
          return this.readUnsigned(2);
        case 0xce:
          return this.readUnsigned(4);
        case 0xcf:
          return this.readUnsigned(8);
        case 0xd0:
          return this.readSigned(1);
        case 0xd1:
          return this.readSigned(2);
        case 0xd2:
          return this.readSigned(4);
        case 0xd3:
          return this.readSigned(8);
        case 0xd4:
          return this.readExtension(1);
        case 0xd5:
          return this.readExtension(2);
        case 0xd6:
          return this.readExtension(4);
        case 0xd7:
          return this.readExtension(8);
        case 0xd8:
          return this.readExtension(16);
        case 0xd9:
          return this.readString(this.readUnsigned(1));
        case 0xda:
          return this.readString(this.readUnsigned(2));
        case 0xdb:
          return this.readString(this.readUnsigned(4));
        case 0xdc:
          return this.readArray(this.readUnsigned(2), depth);
        case 0xdd:
          return this.readArray(this.readUnsigned(4), depth);
        case 0xde:
          return this.readMap(this.readUnsigned(2), depth);
        case 0xdf:
          return this.readMap(this.readUnsigned(4), depth);
        default:
          throw new RangeError(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
      }
    }
  }

  function decode(input) {
    try {
      const decoder = new Decoder(asBytes(input));
      const value = decoder.readValue();
      return { value, bytesRead: decoder.offset };
    } catch (error) {
      return {
        value: undefined,
        bytesRead: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function frameResult(frames, incomplete = false, error = '') {
    Object.defineProperties(frames, {
      incomplete: { value: incomplete, enumerable: false },
      error: { value: error, enumerable: false },
    });
    return frames;
  }

  function decodeVarIntFrames(input) {
    const frames = [];
    let bytes;
    try {
      bytes = asBytes(input);
    } catch (error) {
      return frameResult(frames, false, error instanceof Error ? error.message : String(error));
    }

    let offset = 0;
    while (offset < bytes.length) {
      const prefixStart = offset;
      let length = 0;
      let prefixComplete = false;

      for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
        if (offset >= bytes.length) {
          return frameResult(frames, true);
        }
        const byte = bytes[offset];
        offset += 1;
        if (index === MAX_VARINT_BYTES - 1) {
          if ((byte & 0x80) !== 0) {
            return frameResult(frames, false, 'SignalR frame length prefix is too long.');
          }
          if (byte > 0x07) {
            return frameResult(frames, false, 'SignalR frame length exceeds 2 GiB.');
          }
        }
        length += (byte & 0x7f) * 2 ** (index * 7);
        if ((byte & 0x80) === 0) {
          prefixComplete = true;
          break;
        }
      }

      if (!prefixComplete) {
        return frameResult(frames, false, 'SignalR frame length prefix is too long.');
      }
      if (bytes.length - offset < length) {
        return frameResult(frames, true);
      }

      frames.push(bytes.subarray(offset, offset + length));
      offset += length;
      if (offset <= prefixStart) {
        return frameResult(frames, false, 'SignalR frame parser made no progress.');
      }
    }

    return frameResult(frames);
  }

  const api = { decode, decodeVarIntFrames };
  root.SignalRMsgPack = api;
  if (typeof module !== 'undefined' && module.exports) {
    // biome-ignore lint/style/noCommonJs: The browser IIFE also exposes a CommonJS test API.
    module.exports = api;
  }
})(globalThis);
