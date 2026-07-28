'use strict';

(function exposeSignalRProtocol(root) {
  const RECORD_SEPARATOR = '\u001e';
  const MESSAGE_TYPES = {
    1: 'Invocation',
    2: 'Stream item',
    3: 'Completion',
    4: 'Stream invocation',
    5: 'Cancel invocation',
    6: 'Ping',
    7: 'Close',
    8: 'Acknowledgement',
    9: 'Sequence',
  };

  function describeHubMessage(value) {
    const kind = MESSAGE_TYPES[value?.type] || `Unknown (${value?.type ?? '?'})`;
    let summary = '';
    if (value?.target) {
      summary = value.target;
    } else if (value?.error) {
      summary = value.error;
    } else if (value?.invocationId !== undefined) {
      summary = `Invocation ${value.invocationId}`;
    } else if (value?.sequenceId !== undefined) {
      summary = `Sequence ${value.sequenceId}`;
    }

    return {
      kind,
      target: value?.target || '',
      invocationId: value?.invocationId,
      summary,
      value,
    };
  }

  function parseRecord(record) {
    let value;
    try {
      value = JSON.parse(record);
    } catch {
      return { kind: 'Text', summary: record, raw: record };
    }

    if (value && typeof value.protocol === 'string' && Number.isInteger(value.version)) {
      return {
        kind: 'Handshake',
        summary: `${value.protocol} protocol v${value.version}`,
        value,
      };
    }

    if (value && typeof value === 'object' && !Array.isArray(value) && value.type === undefined) {
      return {
        kind: value.error ? 'Handshake error' : 'Handshake response',
        summary: value.error || 'Connection accepted',
        value,
      };
    }

    return describeHubMessage(value);
  }

  function base64ToBytes(value) {
    const binary = atob(value.replace(/\s/g, ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function nonEmptyHeaders(headers) {
    return headers && typeof headers === 'object' && Object.keys(headers).length > 0
      ? headers
      : undefined;
  }

  function messagePackValue(array) {
    if (!Array.isArray(array) || !Number.isInteger(array[0])) {
      return null;
    }

    const type = array[0];
    const headers = nonEmptyHeaders(array[1]);
    let value;
    switch (type) {
      case 1:
      case 4:
        value = {
          type,
          headers,
          invocationId: array[2] ?? undefined,
          target: array[3],
          arguments: array[4],
          streamIds: array[5],
        };
        break;
      case 2:
        value = { type, headers, invocationId: array[2], item: array[3] };
        break;
      case 3: {
        value = { type, headers, invocationId: array[2] };
        const resultKind = array[3];
        if (resultKind === 1) {
          value.error = array[4];
        } else if (resultKind === 3) {
          value.result = array[4];
        } else if (resultKind !== 2) {
          value.resultKind = resultKind;
          value.result = array[4];
        }
        break;
      }
      case 5:
        value = { type, headers, invocationId: array[2] };
        break;
      case 6:
        value = { type };
        break;
      case 7:
        value = { type, error: array[1] ?? undefined, allowReconnect: array[2] };
        break;
      case 8:
      case 9:
        value = { type, sequenceId: array[1] };
        break;
      default:
        value = { type, messagePack: array.slice(1) };
        break;
    }

    for (const key of Object.keys(value)) {
      if (value[key] === undefined) {
        delete value[key];
      }
    }
    return value;
  }

  function parseBinaryPayload(message) {
    if (message?.truncated || typeof message?.base64Payload !== 'string' || !root.SignalRMsgPack) {
      return null;
    }

    let bytes;
    try {
      bytes = base64ToBytes(message.base64Payload);
    } catch {
      return {
        kind: 'Binary',
        summary: 'Invalid Base64 payload',
        records: [],
        diagnostic: 'The captured binary payload is not valid Base64.',
      };
    }

    const frames = root.SignalRMsgPack.decodeVarIntFrames(bytes);
    const records = [];
    const diagnostics = [];
    for (const frame of frames) {
      const decoded = root.SignalRMsgPack.decode(frame);
      if (decoded.error) {
        diagnostics.push(decoded.error);
        continue;
      }
      if (decoded.bytesRead !== frame.length) {
        diagnostics.push(
          `MessagePack frame has ${frame.length - decoded.bytesRead} trailing byte(s).`,
        );
      }
      const value = messagePackValue(decoded.value);
      if (!value) {
        diagnostics.push('MessagePack frame is not a SignalR hub message array.');
        continue;
      }
      records.push({ ...describeHubMessage(value), protocol: 'messagepack' });
    }

    if (frames.incomplete) {
      diagnostics.push('The captured SignalR binary frame is incomplete.');
    }
    if (frames.error) {
      diagnostics.push(frames.error);
    }

    if (records.length === 0) {
      return {
        kind: 'Binary',
        summary: diagnostics[0] || message.preview || '',
        records,
        diagnostic: diagnostics.join(' '),
      };
    }

    return {
      kind: records.map((record) => record.kind).join(' + '),
      target: records.find((record) => record.target)?.target || '',
      invocationId: records.find((record) => record.invocationId !== undefined)?.invocationId,
      summary: records
        .map((record) => record.summary)
        .filter(Boolean)
        .join(' · '),
      records,
      protocol: 'messagepack',
      diagnostic: diagnostics.join(' '),
    };
  }

  function parsePayload(message) {
    if (message?.encoding !== 'text' || typeof message.textPayload !== 'string') {
      const binary = parseBinaryPayload(message);
      if (binary) {
        return binary;
      }
      return {
        kind: message?.encoding?.startsWith('blob:') ? 'Binary' : message?.encoding || 'Binary',
        summary: message?.preview || '',
        records: [],
      };
    }

    const records = message.textPayload.split(RECORD_SEPARATOR).filter(Boolean).map(parseRecord);

    if (records.length === 0) {
      return { kind: 'Empty', summary: '', records: [] };
    }

    return {
      kind: records.map((record) => record.kind).join(' + '),
      target: records.find((record) => record.target)?.target || '',
      invocationId: records.find((record) => record.invocationId !== undefined)?.invocationId,
      summary: records
        .map((record) => record.summary)
        .filter(Boolean)
        .join(' · '),
      records,
    };
  }

  function formatPayload(message) {
    const parsed = parsePayload(message);
    if (parsed.records.length === 0) {
      const payload = message?.base64Payload
        ? `Base64 (${message.encoding || 'binary'}):\n${message.base64Payload}`
        : message?.textPayload || message?.preview || '(no data)';
      return parsed.diagnostic ? `${parsed.diagnostic}\n\n${payload}` : payload;
    }

    const formatted = parsed.records
      .map((record) => {
        if (record.value === undefined) {
          return record.raw;
        }
        return JSON.stringify(record.value, null, 2);
      })
      .join('\n\n');
    if (parsed.protocol !== 'messagepack') {
      return formatted;
    }

    const diagnostic = parsed.diagnostic ? `${parsed.diagnostic}\n\n` : '';
    return `${diagnostic}${formatted}\n\nRaw Base64:\n${message.base64Payload}`;
  }

  const api = { parsePayload, formatPayload };
  root.SignalRProtocol = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
