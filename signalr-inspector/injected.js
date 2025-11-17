(function setupSignalRInspector() {
  const FLAG = '__signalrInspectorInjected';
  if (window[FLAG]) {
    return;
  }
  Object.defineProperty(window, FLAG, { value: true, enumerable: false, configurable: false });

  const NativeWebSocket = window.WebSocket;
  const NativeEventSource = window.EventSource;
  let messageCounter = 0;

  function normalizeUrl(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch (err) {
      return url;
    }
  }

  function shouldTrack(url) {
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.pathname.toLowerCase().includes('/grpc');
    } catch (err) {
      return String(url).toLowerCase().includes('/grpc');
    }
  }

  function utf8Length(input) {
    try {
      return new TextEncoder().encode(input).length;
    } catch (err) {
      return input.length;
    }
  }

  function truncate(text, limit = 400) {
    if (!text || text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}…`;
  }

  function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function bufferPreview(buffer, maxBytes = 64) {
    const view = new Uint8Array(buffer);
    const slice = view.slice(0, maxBytes);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
    return view.length > maxBytes ? `${hex} …` : hex;
  }

  function buildPayload(data) {
    if (typeof data === 'string') {
      return Promise.resolve({
        encoding: 'text',
        preview: truncate(data),
        size: utf8Length(data),
        textPayload: data,
      });
    }

    if (data instanceof ArrayBuffer) {
      return Promise.resolve({
        encoding: 'binary',
        size: data.byteLength,
        preview: bufferPreview(data),
        base64Payload: bufferToBase64(data),
      });
    }

    if (ArrayBuffer.isView(data)) {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return Promise.resolve({
        encoding: 'binary',
        size: data.byteLength,
        preview: bufferPreview(buffer),
        base64Payload: bufferToBase64(buffer),
      });
    }

    if (data instanceof Blob) {
      return data
        .arrayBuffer()
        .then((buffer) => ({
          encoding: `blob:${data.type || 'binary'}`,
          size: buffer.byteLength,
          preview: bufferPreview(buffer),
          base64Payload: bufferToBase64(buffer),
        }))
        .catch(() => ({
          encoding: `blob:${data.type || 'binary'}`,
          size: data.size ?? null,
          preview: '[Blob - unreadable]',
        }));
    }

    return Promise.resolve({
      encoding: typeof data,
      size: null,
      preview: truncate(String(data)),
    });
  }

  function publish(payload) {
    window.postMessage(
      {
        source: 'signalr-inspector',
        type: 'signalr-message',
        payload,
      },
      '*',
    );
  }

  function emitMessage({ transport, direction, endpoint, connectionId, data }) {
    buildPayload(data)
      .then((payload) => {
        publish({
          id: ++messageCounter,
          transport,
          direction,
          endpoint,
          connectionId,
          timestamp: Date.now(),
          ...payload,
        });
      })
      .catch((err) => {
        publish({
          id: ++messageCounter,
          transport,
          direction,
          endpoint,
          connectionId,
          timestamp: Date.now(),
          preview: '[Payload serialization error]',
          encoding: 'error',
          size: null,
          error: String(err),
        });
      });
  }

  function instrumentWebSocket(ws, url) {
    const endpoint = normalizeUrl(url || ws.url);
    if (!shouldTrack(endpoint)) {
      return;
    }

    const connectionId = `ws-${Math.random().toString(16).slice(2)}-${Date.now()}`;
    const originalSend = ws.send;

    ws.send = function patchedSend(data) {
      try {
        emitMessage({ transport: 'websocket', direction: 'outgoing', endpoint, connectionId, data });
      } catch (err) {
        console.warn('SignalR Inspector: failed while monitoring send()', err);
      }
      return originalSend.apply(this, arguments);
    };

    ws.addEventListener('message', (event) => {
      emitMessage({ transport: 'websocket', direction: 'incoming', endpoint, connectionId, data: event.data });
    });
  }

  function wrapWebSocket() {
    if (typeof NativeWebSocket !== 'function') {
      return;
    }

    function SignalRInspectorWebSocket(url, protocols) {
      const ws = protocols !== undefined ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
      try {
        instrumentWebSocket(ws, url);
      } catch (err) {
        console.warn('SignalR Inspector: failed to instrument WebSocket', err);
      }
      return ws;
    }

    SignalRInspectorWebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperty(SignalRInspectorWebSocket, 'name', { value: 'WebSocket' });
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((prop) => {
      if (prop in NativeWebSocket) {
        SignalRInspectorWebSocket[prop] = NativeWebSocket[prop];
      }
    });

    window.WebSocket = SignalRInspectorWebSocket;
  }

  function instrumentEventSource(es, url) {
    const endpoint = normalizeUrl(url || es.url);
    if (!shouldTrack(endpoint)) {
      return;
    }

    const connectionId = `es-${Math.random().toString(16).slice(2)}-${Date.now()}`;
    es.addEventListener('message', (event) => {
      emitMessage({
        transport: 'eventsource',
        direction: 'incoming',
        endpoint,
        connectionId,
        data: event.data,
      });
    });
  }

  function wrapEventSource() {
    if (typeof NativeEventSource !== 'function') {
      return;
    }

    function SignalRInspectorEventSource(url, config) {
      const es = new NativeEventSource(url, config);
      try {
        instrumentEventSource(es, url);
      } catch (err) {
        console.warn('SignalR Inspector: failed to instrument EventSource', err);
      }
      return es;
    }

    SignalRInspectorEventSource.prototype = NativeEventSource.prototype;
    Object.defineProperty(SignalRInspectorEventSource, 'name', { value: 'EventSource' });

    window.EventSource = SignalRInspectorEventSource;
  }

  wrapWebSocket();
  wrapEventSource();
})();
