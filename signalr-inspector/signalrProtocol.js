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

  function parsePayload(message) {
    if (message?.encoding !== 'text' || typeof message.textPayload !== 'string') {
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
      return message?.base64Payload
        ? `Base64 (${message.encoding || 'binary'}):\n${message.base64Payload}`
        : message?.textPayload || message?.preview || '(no data)';
    }

    return parsed.records
      .map((record) => {
        if (record.value === undefined) {
          return record.raw;
        }
        return JSON.stringify(record.value, null, 2);
      })
      .join('\n\n');
  }

  const api = { parsePayload, formatPayload };
  root.SignalRProtocol = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
