'use strict';

(function setupSignalRInspector() {
  const INSTALL_FLAG = '__signalrInspectorInstalled';
  const RECORD_SEPARATOR = '\u001e';
  const MAX_PREVIEW_CHARACTERS = 400;
  const MAX_CAPTURE_BYTES = 256 * 1024;
  const MAX_PENDING_MESSAGES = 10;
  const MAX_PENDING_LIFECYCLE_EVENTS = 4;
  const SENSITIVE_QUERY_PARAMETERS = ['id', 'access_token', 'accessToken'];
  let nextConnectionSequence = 0;

  if (window[INSTALL_FLAG]) {
    return;
  }
  Object.defineProperty(window, INSTALL_FLAG, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  const NativeWebSocket = window.WebSocket;
  const NativeEventSource = window.EventSource;

  function sanitizeEndpoint(url) {
    try {
      const sanitized = new URL(url, window.location.href);
      for (const parameter of SENSITIVE_QUERY_PARAMETERS) {
        sanitized.searchParams.delete(parameter);
      }
      return sanitized.toString();
    } catch {
      return '';
    }
  }

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

  function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function bufferPreview(buffer, maxBytes = 64) {
    const bytes = new Uint8Array(buffer);
    const preview = Array.from(bytes.subarray(0, maxBytes), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(' ');
    return bytes.length > maxBytes ? `${preview} …` : preview;
  }

  function isSignalRHandshake(data) {
    if (typeof data !== 'string') {
      return false;
    }

    const firstRecord = data.split(RECORD_SEPARATOR, 1)[0];
    try {
      const message = JSON.parse(firstRecord);
      return (
        typeof message === 'object' &&
        message !== null &&
        typeof message.protocol === 'string' &&
        Number.isInteger(message.version)
      );
    } catch {
      return false;
    }
  }

  function isSignalRMessage(data) {
    if (typeof data !== 'string' || !data.includes(RECORD_SEPARATOR)) {
      return false;
    }

    try {
      const record = JSON.parse(data.split(RECORD_SEPARATOR, 1)[0]);
      return typeof record === 'object' && record !== null && Number.isInteger(record.type);
    } catch {
      return false;
    }
  }

  async function buildPayload(data) {
    if (typeof data === 'string') {
      const size = utf8Length(data);
      return {
        encoding: 'text',
        preview: truncate(data),
        size,
        textPayload:
          size <= MAX_CAPTURE_BYTES
            ? data
            : `[Payload omitted: ${size} bytes exceeds capture limit]`,
        truncated: size > MAX_CAPTURE_BYTES,
      };
    }

    let buffer;
    let encoding = 'binary';
    if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (ArrayBuffer.isView(data)) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
      encoding = `blob:${data.type || 'binary'}`;
    }

    if (buffer) {
      return {
        encoding,
        size: buffer.byteLength,
        preview: bufferPreview(buffer),
        base64Payload:
          buffer.byteLength <= MAX_CAPTURE_BYTES
            ? bufferToBase64(buffer)
            : `[Payload omitted: ${buffer.byteLength} bytes exceeds capture limit]`,
        truncated: buffer.byteLength > MAX_CAPTURE_BYTES,
      };
    }

    return {
      encoding: typeof data,
      size: null,
      preview: truncate(String(data)),
    };
  }

  function publish(payload) {
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
    window.postMessage(
      {
        source: 'signalr-inspector',
        type: 'signalr-message',
        payload,
      },
      targetOrigin,
    );
  }

  function createConnection(transport, endpoint) {
    nextConnectionSequence += 1;
    const connectionSeq = nextConnectionSequence;
    let detected = false;
    let pendingMessages = [];
    let pendingLifecycleEvents = [];
    let serializationQueue = Promise.resolve();

    function serializeAndPublish(direction, data, timestamp) {
      serializationQueue = serializationQueue
        .then(() => buildPayload(data))
        .then((payload) => {
          publish({
            transport,
            direction,
            endpoint,
            timestamp,
            connectionSeq,
            ...payload,
          });
        })
        .catch((error) => {
          publish({
            transport,
            direction,
            endpoint,
            timestamp,
            connectionSeq,
            encoding: 'error',
            size: null,
            preview: '[Payload serialization error]',
            error: String(error),
          });
        });
    }

    function serializeLifecycle(lifecycleEvent, lifecycleDetail, timestamp) {
      serializationQueue = serializationQueue.then(() => {
        publish({
          transport,
          direction: 'incoming',
          endpoint,
          timestamp,
          connectionSeq,
          encoding: 'lifecycle',
          size: 0,
          preview: lifecycleDetail || lifecycleEvent,
          lifecycleEvent,
          lifecycleDetail,
        });
      });
    }

    function serialize(item) {
      if (item.lifecycleEvent) {
        serializeLifecycle(item.lifecycleEvent, item.lifecycleDetail, item.timestamp);
      } else {
        serializeAndPublish(item.direction, item.data, item.timestamp);
      }
    }

    function observeItem(item) {
      if (detected) {
        serialize(item);
        return;
      }

      const pending = item.lifecycleEvent ? pendingLifecycleEvents : pendingMessages;
      pending.push(item);
      const limit = item.lifecycleEvent ? MAX_PENDING_LIFECYCLE_EVENTS : MAX_PENDING_MESSAGES;
      if (pending.length > limit) {
        pending.shift();
      }
    }

    return {
      observe(direction, data) {
        observeItem({ direction, data, timestamp: Date.now() });

        if (isSignalRHandshake(data) || isSignalRMessage(data)) {
          detected = true;
          for (const item of pendingLifecycleEvents) {
            serialize(item);
          }
          for (const item of pendingMessages) {
            serialize(item);
          }
          pendingLifecycleEvents = [];
          pendingMessages = [];
        }
      },
      observeLifecycle(lifecycleEvent, lifecycleDetail = '') {
        observeItem({
          lifecycleEvent,
          lifecycleDetail: truncate(String(lifecycleDetail)),
          timestamp: Date.now(),
        });
      },
    };
  }

  function instrumentWebSocket(socket, url) {
    const connection = createConnection('websocket', sanitizeEndpoint(url || socket.url));
    const nativeSend = socket.send;

    socket.addEventListener('open', () => {
      connection.observeLifecycle('transport-open', 'WebSocket connected');
    });
    socket.addEventListener('close', (event) => {
      const detail = [`Code ${event.code}`, event.reason].filter(Boolean).join(' · ');
      connection.observeLifecycle('transport-close', detail);
    });
    socket.addEventListener('error', () => {
      connection.observeLifecycle('transport-error', 'WebSocket error');
    });

    socket.send = function signalRInspectorSend(data) {
      connection.observe('outgoing', data);
      return nativeSend.apply(this, arguments);
    };

    socket.addEventListener('message', (event) => {
      connection.observe('incoming', event.data);
    });
  }

  function wrapWebSocket() {
    if (typeof NativeWebSocket !== 'function') {
      return;
    }

    function SignalRInspectorWebSocket(url, protocols) {
      const socket =
        protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      instrumentWebSocket(socket, url);
      return socket;
    }

    Object.setPrototypeOf(SignalRInspectorWebSocket, NativeWebSocket);
    SignalRInspectorWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = SignalRInspectorWebSocket;
  }

  function wrapEventSource() {
    if (typeof NativeEventSource !== 'function') {
      return;
    }

    function SignalRInspectorEventSource(url, config) {
      const eventSource = new NativeEventSource(url, config);
      const connection = createConnection(
        'server-sent events',
        sanitizeEndpoint(url || eventSource.url),
      );
      const nativeClose = eventSource.close;
      let closed = false;
      let errorObserved = false;
      eventSource.addEventListener('open', () => {
        errorObserved = false;
        connection.observeLifecycle('transport-open', 'Server-Sent Events connected');
      });
      eventSource.addEventListener('message', (event) => {
        connection.observe('incoming', event.data);
      });
      eventSource.addEventListener('error', () => {
        if (closed || errorObserved) {
          return;
        }
        errorObserved = true;
        connection.observeLifecycle('transport-error', 'Server-Sent Events error');
      });
      if (typeof nativeClose === 'function') {
        eventSource.close = function signalRInspectorClose() {
          if (!closed) {
            closed = true;
            connection.observeLifecycle('transport-close', 'Server-Sent Events closed');
          }
          return nativeClose.apply(this, arguments);
        };
      }
      return eventSource;
    }

    Object.setPrototypeOf(SignalRInspectorEventSource, NativeEventSource);
    SignalRInspectorEventSource.prototype = NativeEventSource.prototype;
    window.EventSource = SignalRInspectorEventSource;
  }

  wrapWebSocket();
  wrapEventSource();
})();
