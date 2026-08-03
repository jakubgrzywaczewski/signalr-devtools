'use strict';

(function exposeSignalRSessionFormat(root) {
  const FORMAT = 'signalr-inspector-session';
  const VERSION = 1;
  const MAX_MESSAGES = 500;
  const MAX_STORED_CHARACTERS = 10 * 1024 * 1024;
  const MAX_STRING_LENGTH = 350_000;
  const MAX_FILE_CHARACTERS = 64 * 1024 * 1024;
  const SENSITIVE_QUERY_PARAMETERS = ['id', 'access_token', 'accessToken'];
  // Keep this validation contract in sync with contentScript.js and background.js.
  const ALLOWED_TRANSPORTS = new Set([
    'websocket',
    'server-sent events',
    'long polling',
    'negotiation',
  ]);
  const ALLOWED_DIRECTIONS = new Set(['incoming', 'outgoing']);
  const ALLOWED_LIFECYCLE_EVENTS = new Set([
    'negotiate',
    'transport-open',
    'transport-close',
    'transport-error',
  ]);
  const OPTIONAL_STRING_FIELDS = [
    'preview',
    'textPayload',
    'base64Payload',
    'encoding',
    'error',
    'lifecycleDetail',
  ];
  const STORED_STRING_FIELDS = ['endpoint', ...OPTIONAL_STRING_FIELDS, 'documentId'];

  function fail(message) {
    throw new Error(`Invalid SignalR Inspector session: ${message}`);
  }

  function sanitizeEndpoint(endpoint) {
    if (endpoint === '') {
      return '';
    }
    try {
      const sanitized = new URL(endpoint);
      for (const parameter of SENSITIVE_QUERY_PARAMETERS) {
        sanitized.searchParams.delete(parameter);
      }
      return sanitized.toString();
    } catch {
      return '';
    }
  }

  function countStoredCharacters(message) {
    return STORED_STRING_FIELDS.reduce(
      (total, key) => total + (typeof message[key] === 'string' ? message[key].length : 0),
      0,
    );
  }

  function normalizeMessage(message, index) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      fail(`message ${index + 1} must be an object`);
    }
    if (!ALLOWED_TRANSPORTS.has(message.transport)) {
      fail(`message ${index + 1} has an unsupported transport`);
    }
    if (!ALLOWED_DIRECTIONS.has(message.direction)) {
      fail(`message ${index + 1} has an unsupported direction`);
    }
    if (typeof message.endpoint !== 'string' || message.endpoint.length > 4096) {
      fail(`message ${index + 1} has an invalid endpoint`);
    }
    if (!Number.isFinite(message.timestamp)) {
      fail(`message ${index + 1} has an invalid timestamp`);
    }
    if (message.size !== null && (!Number.isFinite(message.size) || message.size < 0)) {
      fail(`message ${index + 1} has an invalid size`);
    }
    if (message.truncated !== undefined && typeof message.truncated !== 'boolean') {
      fail(`message ${index + 1} has an invalid truncated flag`);
    }
    if (
      message.connectionSeq !== undefined &&
      (!Number.isSafeInteger(message.connectionSeq) || message.connectionSeq <= 0)
    ) {
      fail(`message ${index + 1} has an invalid connection sequence`);
    }
    if (
      message.documentId !== undefined &&
      (typeof message.documentId !== 'string' || message.documentId.length > 256)
    ) {
      fail(`message ${index + 1} has an invalid document identity`);
    }
    for (const key of OPTIONAL_STRING_FIELDS) {
      if (
        message[key] !== undefined &&
        (typeof message[key] !== 'string' || message[key].length > MAX_STRING_LENGTH)
      ) {
        fail(`message ${index + 1} has an invalid ${key}`);
      }
    }

    const hasLifecycleEvent = message.lifecycleEvent !== undefined;
    if ((message.encoding === 'lifecycle') !== hasLifecycleEvent) {
      fail(`message ${index + 1} has inconsistent lifecycle metadata`);
    }
    if (
      hasLifecycleEvent &&
      (!ALLOWED_LIFECYCLE_EVENTS.has(message.lifecycleEvent) ||
        typeof message.lifecycleDetail !== 'string' ||
        message.lifecycleDetail.length > 4096 ||
        message.textPayload !== undefined ||
        message.base64Payload !== undefined)
    ) {
      fail(`message ${index + 1} has invalid lifecycle metadata`);
    }
    if (!hasLifecycleEvent && message.lifecycleDetail !== undefined) {
      fail(`message ${index + 1} has lifecycle detail without an event`);
    }

    const normalized = {
      transport: message.transport,
      direction: message.direction,
      endpoint: sanitizeEndpoint(message.endpoint),
      timestamp: message.timestamp,
      size: message.size,
    };
    for (const key of [
      ...OPTIONAL_STRING_FIELDS,
      'truncated',
      'lifecycleEvent',
      'connectionSeq',
      'documentId',
    ]) {
      if (message[key] !== undefined) {
        normalized[key] = message[key];
      }
    }
    return normalized;
  }

  function normalizeMessages(messages) {
    if (!Array.isArray(messages)) {
      fail('messages must be an array');
    }
    if (messages.length > MAX_MESSAGES) {
      fail(`sessions can contain at most ${MAX_MESSAGES} messages`);
    }
    const normalized = messages.map(normalizeMessage);
    const storedCharacters = normalized.reduce(
      (total, message) => total + countStoredCharacters(message),
      0,
    );
    if (storedCharacters > MAX_STORED_CHARACTERS) {
      fail('captured text exceeds the 10 MiB session limit');
    }
    return normalized;
  }

  function normalizeExportedAt(exportedAt) {
    if (typeof exportedAt !== 'string') {
      fail('exportedAt must be an ISO timestamp');
    }
    const parsed = new Date(exportedAt);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== exportedAt) {
      fail('exportedAt must be an ISO timestamp');
    }
    return exportedAt;
  }

  function create(messages, exportedAt = new Date().toISOString()) {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: normalizeExportedAt(exportedAt),
      messages: normalizeMessages(messages),
    };
  }

  function pseudonymizeDocumentIdentities(messages) {
    const documentIdentities = new Map();
    return messages.map((message) => {
      if (message.documentId === undefined) {
        return message;
      }
      if (!documentIdentities.has(message.documentId)) {
        documentIdentities.set(message.documentId, `document-${documentIdentities.size + 1}`);
      }
      return { ...message, documentId: documentIdentities.get(message.documentId) };
    });
  }

  function serialize(messages, exportedAt) {
    const session = create(messages, exportedAt);
    session.messages = pseudonymizeDocumentIdentities(session.messages);
    const serialized = JSON.stringify(session, null, 2);
    if (serialized.length > MAX_FILE_CHARACTERS) {
      fail('serialized data exceeds the 64 MiB file limit');
    }
    return serialized;
  }

  function parse(serialized) {
    if (typeof serialized !== 'string') {
      fail('file contents must be text');
    }
    if (serialized.length > MAX_FILE_CHARACTERS) {
      fail('file exceeds the 64 MiB limit');
    }
    let session;
    try {
      session = JSON.parse(serialized);
    } catch {
      fail('file is not valid JSON');
    }
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      fail('root value must be an object');
    }
    if (session.format !== FORMAT) {
      fail(`format must be ${FORMAT}`);
    }
    if (session.version !== VERSION) {
      fail(`unsupported format version ${String(session.version)}`);
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: normalizeExportedAt(session.exportedAt),
      messages: normalizeMessages(session.messages),
    };
  }

  const api = {
    FORMAT,
    VERSION,
    MAX_FILE_CHARACTERS,
    create,
    parse,
    serialize,
  };
  root.SignalRSessionFormat = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
