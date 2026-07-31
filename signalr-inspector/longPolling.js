'use strict';

(function exposeLongPollingObserver(root) {
  // biome-ignore lint/performance/useTopLevelRegex: Avoid leaking extension constants globally.
  const SIGNALR_NEGOTIATE_PATH_PATTERN = /\/negotiate\/?$/;
  const RECORD_SEPARATOR = '\u001e';
  const MAX_CAPTURE_BYTES = 256 * 1024;
  const MAX_PREVIEW_CHARACTERS = 400;
  const MAX_PENDING_MESSAGES = 10;
  const MAX_TRACKED_CONNECTIONS = 100;
  const SENSITIVE_QUERY_PARAMETERS = ['id', 'access_token', 'accessToken'];
  const SIGNALR_TRANSPORTS = new Set(['WebSockets', 'ServerSentEvents', 'LongPolling']);

  function utf8Length(input) {
    try {
      return new TextEncoder().encode(input).length;
    } catch {
      return input.length;
    }
  }

  function truncate(text, limit = MAX_PREVIEW_CHARACTERS) {
    return text.length <= limit ? text : `${text.slice(0, limit)}…`;
  }

  function getHeader(headers, name) {
    const header = headers?.find(
      (candidate) => candidate?.name?.toLowerCase() === name.toLowerCase(),
    );
    return typeof header?.value === 'string' ? header.value : '';
  }

  function parseUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function sanitizeEndpoint(url) {
    const sanitized = new URL(url.toString());
    for (const parameter of SENSITIVE_QUERY_PARAMETERS) {
      sanitized.searchParams.delete(parameter);
    }
    return sanitized.toString();
  }

  function getConnectionKey(url) {
    const connectionToken = url.searchParams.get('id');
    if (!connectionToken) {
      return null;
    }
    return `${url.origin}${url.pathname}|${connectionToken}`;
  }

  function getNegotiatedEndpoint(url) {
    const endpoint = new URL(url.toString());
    endpoint.pathname = endpoint.pathname.replace(SIGNALR_NEGOTIATE_PATH_PATTERN, '');
    endpoint.searchParams.delete('negotiateVersion');
    return sanitizeEndpoint(endpoint);
  }

  function isNegotiationRequest(request, url) {
    return (
      request?.request?.method?.toUpperCase() === 'POST' &&
      SIGNALR_NEGOTIATE_PATH_PATTERN.test(url.pathname)
    );
  }

  function isSignalRTextPayload(text) {
    if (typeof text !== 'string' || !text.includes(RECORD_SEPARATOR)) {
      return false;
    }

    const firstRecord = text.split(RECORD_SEPARATOR, 1)[0];
    try {
      const message = JSON.parse(firstRecord);
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return false;
      }
      return (
        (typeof message.protocol === 'string' && Number.isInteger(message.version)) ||
        message.type === undefined ||
        Number.isInteger(message.type)
      );
    } catch {
      return false;
    }
  }

  function buildTextPayload(text) {
    const size = utf8Length(text);
    return {
      encoding: 'text',
      preview: truncate(text),
      size,
      textPayload:
        size <= MAX_CAPTURE_BYTES ? text : `[Payload omitted: ${size} bytes exceeds capture limit]`,
      truncated: size > MAX_CAPTURE_BYTES,
    };
  }

  function base64ByteLength(value) {
    const normalized = value.replace(/\s/g, '');
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }

  function base64Preview(value, maxBytes = 64) {
    try {
      const binary = atob(value);
      const preview = Array.from(binary.slice(0, maxBytes), (character) =>
        character.charCodeAt(0).toString(16).padStart(2, '0'),
      ).join(' ');
      return binary.length > maxBytes ? `${preview} …` : preview;
    } catch {
      return 'Base64 response';
    }
  }

  function decodeBase64Utf8(value) {
    try {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  function buildBase64Payload(base64) {
    const size = base64ByteLength(base64);
    return {
      encoding: 'binary',
      preview: base64Preview(base64),
      size,
      base64Payload:
        size <= MAX_CAPTURE_BYTES
          ? base64
          : `[Payload omitted: ${size} bytes exceeds capture limit]`,
      truncated: size > MAX_CAPTURE_BYTES,
    };
  }

  function readResponseContent(request) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (content, encoding) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          content: typeof content === 'string' ? content : '',
          encoding: typeof encoding === 'string' ? encoding : '',
        });
      };

      try {
        const result = request.getContent((content, encoding) => finish(content, encoding));
        if (result && typeof result.then === 'function') {
          result.then(
            (value) => finish(value?.content, value?.encoding),
            (error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            },
          );
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function parseNegotiation(content) {
    try {
      const negotiation = JSON.parse(content);
      const supportsSignalR = negotiation?.availableTransports?.some((transport) =>
        SIGNALR_TRANSPORTS.has(transport?.transport),
      );
      if (!supportsSignalR) {
        return null;
      }
      return negotiation;
    } catch {
      return null;
    }
  }

  function createObserver({
    publish,
    now = Date.now,
    onError = () => undefined,
    maxTrackedConnections = MAX_TRACKED_CONNECTIONS,
  }) {
    if (typeof publish !== 'function') {
      throw new TypeError('Long Polling observer requires a publish function.');
    }
    if (!Number.isInteger(maxTrackedConnections) || maxTrackedConnections <= 0) {
      throw new TypeError('Long Polling observer requires a positive connection limit.');
    }

    const negotiatedTokens = new Map();
    const connections = new Map();
    let processingQueue = Promise.resolve();
    let generation = 0;
    let nextConnectionSequence = 0;

    function setBounded(map, key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > maxTrackedConnections) {
        map.delete(map.keys().next().value);
      }
    }

    function getConnection(url) {
      const key = getConnectionKey(url);
      if (!key) {
        return null;
      }

      if (!connections.has(key)) {
        const token = url.searchParams.get('id');
        nextConnectionSequence += 1;
        setBounded(connections, key, {
          detected: false,
          endpoint: negotiatedTokens.get(token) || sanitizeEndpoint(url),
          pending: [],
          startedAt: now(),
          connectionSeq: nextConnectionSequence,
        });
      } else {
        setBounded(connections, key, connections.get(key));
      }
      return connections.get(key);
    }

    function createMessage(connection, direction, payload) {
      return {
        transport: 'long polling',
        direction,
        endpoint: connection.endpoint,
        timestamp: now(),
        connectionSeq: connection.connectionSeq,
        ...payload,
      };
    }

    function createLifecycleMessage({
      transport,
      endpoint,
      lifecycleEvent,
      lifecycleDetail,
      connectionSeq,
      timestamp = now(),
    }) {
      return {
        transport,
        direction: 'incoming',
        endpoint,
        timestamp,
        encoding: 'lifecycle',
        size: 0,
        preview: truncate(lifecycleDetail || lifecycleEvent),
        lifecycleEvent,
        lifecycleDetail: truncate(lifecycleDetail),
        ...(connectionSeq === undefined ? {} : { connectionSeq }),
      };
    }

    function publishOrQueue(connection, message) {
      if (connection.detected) {
        publish(message);
        return;
      }
      connection.pending.push(message);
      if (connection.pending.length > MAX_PENDING_MESSAGES) {
        connection.pending.shift();
      }
    }

    function detectConnection(connection) {
      if (connection.detected) {
        return;
      }
      connection.detected = true;
      publish(
        createLifecycleMessage({
          transport: 'long polling',
          endpoint: connection.endpoint,
          lifecycleEvent: 'transport-open',
          lifecycleDetail: 'Long Polling connected',
          connectionSeq: connection.connectionSeq,
          timestamp: connection.startedAt,
        }),
      );
      for (const message of connection.pending) {
        publish(message);
      }
      connection.pending = [];
    }

    async function observeNegotiation(request, url, observationGeneration) {
      const response = await readResponseContent(request);
      if (observationGeneration !== generation) {
        return;
      }
      const content =
        response.encoding.toLowerCase() === 'base64'
          ? decodeBase64Utf8(response.content)
          : response.content;
      if (content === null) {
        return;
      }
      const negotiation = parseNegotiation(content);
      if (!negotiation) {
        return;
      }

      const endpoint = getNegotiatedEndpoint(url);
      const availableTransports = negotiation.availableTransports
        .map((transport) => transport?.transport)
        .filter((transport) => SIGNALR_TRANSPORTS.has(transport));
      publish(
        createLifecycleMessage({
          transport: 'negotiation',
          endpoint,
          lifecycleEvent: 'negotiate',
          lifecycleDetail: `Available transports: ${availableTransports.join(', ')}`,
        }),
      );
      for (const token of [negotiation.connectionToken, negotiation.connectionId]) {
        if (typeof token === 'string' && token) {
          setBounded(negotiatedTokens, token, endpoint);
        }
      }
    }

    async function observePoll(request, url, connection, observationGeneration) {
      const contentType = getHeader(request.response?.headers, 'content-type').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        return;
      }

      const response = await readResponseContent(request);
      if (observationGeneration !== generation) {
        return;
      }
      const token = url.searchParams.get('id');
      const negotiated = negotiatedTokens.has(token);
      const decodedText =
        response.encoding.toLowerCase() === 'base64'
          ? decodeBase64Utf8(response.content)
          : response.content;
      const signalRPayload = decodedText !== null && isSignalRTextPayload(decodedText);
      if (!connection.detected && (negotiated || signalRPayload)) {
        detectConnection(connection);
      }

      if (
        !connection.detected ||
        request.response?.status === 204 ||
        response.content.length === 0
      ) {
        return;
      }

      const payload =
        response.encoding.toLowerCase() === 'base64' && !signalRPayload
          ? buildBase64Payload(response.content)
          : buildTextPayload(decodedText ?? response.content);
      publish(createMessage(connection, 'incoming', payload));
    }

    function observeSend(request, connection) {
      const text = request.request?.postData?.text;
      if (!isSignalRTextPayload(text)) {
        return;
      }
      publishOrQueue(connection, createMessage(connection, 'outgoing', buildTextPayload(text)));
    }

    async function processRequest(request, observationGeneration) {
      const url = parseUrl(request?.request?.url);
      if (!url || !['http:', 'https:'].includes(url.protocol)) {
        return;
      }

      if (isNegotiationRequest(request, url)) {
        await observeNegotiation(request, url, observationGeneration);
        return;
      }

      const method = request.request?.method?.toUpperCase();
      const key = getConnectionKey(url);
      if (!key) {
        return;
      }
      if (method === 'DELETE') {
        const connection = connections.get(key);
        if (connection?.detected) {
          publish(
            createLifecycleMessage({
              transport: 'long polling',
              endpoint: connection.endpoint,
              lifecycleEvent: 'transport-close',
              lifecycleDetail: 'Long Polling connection deleted',
              connectionSeq: connection.connectionSeq,
            }),
          );
        }
        connections.delete(key);
        return;
      }

      const connection = getConnection(url);
      if (method === 'POST') {
        observeSend(request, connection);
      } else if (method === 'GET') {
        await observePoll(request, url, connection, observationGeneration);
      }
    }

    return {
      observe(request) {
        const observationGeneration = generation;
        processingQueue = processingQueue
          .then(() =>
            observationGeneration === generation
              ? processRequest(request, observationGeneration)
              : undefined,
          )
          .catch((error) => {
            onError(error);
          });
        return processingQueue;
      },
      reset() {
        generation += 1;
        negotiatedTokens.clear();
        connections.clear();
      },
    };
  }

  const api = { createObserver };
  root.SignalRLongPolling = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
