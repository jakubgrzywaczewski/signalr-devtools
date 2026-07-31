'use strict';

(function setupSignalRInspectorBridge() {
  const INSTALL_FLAG = '__signalrInspectorBridgeInstalled';

  if (window[INSTALL_FLAG]) {
    return;
  }
  Object.defineProperty(window, INSTALL_FLAG, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  // A Base64 representation of the 256 KiB capture limit is below 350,000 characters.
  const MAX_STRING_LENGTH = 350_000;
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

  // Keep this boundary validation in sync with background.js.
  function isValidPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    if (!ALLOWED_TRANSPORTS.has(payload.transport)) {
      return false;
    }
    if (!ALLOWED_DIRECTIONS.has(payload.direction)) {
      return false;
    }
    if (typeof payload.endpoint !== 'string' || payload.endpoint.length > 4096) {
      return false;
    }
    if (!Number.isFinite(payload.timestamp)) {
      return false;
    }
    if (payload.size !== null && (!Number.isFinite(payload.size) || payload.size < 0)) {
      return false;
    }
    if (payload.truncated !== undefined && typeof payload.truncated !== 'boolean') {
      return false;
    }
    if (
      payload.connectionSeq !== undefined &&
      (!Number.isSafeInteger(payload.connectionSeq) || payload.connectionSeq <= 0)
    ) {
      return false;
    }
    const hasLifecycleEvent = payload.lifecycleEvent !== undefined;
    if ((payload.encoding === 'lifecycle') !== hasLifecycleEvent) {
      return false;
    }
    if (
      hasLifecycleEvent &&
      (!ALLOWED_LIFECYCLE_EVENTS.has(payload.lifecycleEvent) ||
        typeof payload.lifecycleDetail !== 'string' ||
        payload.lifecycleDetail.length > 4096 ||
        payload.textPayload !== undefined ||
        payload.base64Payload !== undefined)
    ) {
      return false;
    }
    if (!hasLifecycleEvent && payload.lifecycleDetail !== undefined) {
      return false;
    }

    return [
      'preview',
      'textPayload',
      'base64Payload',
      'encoding',
      'error',
      'lifecycleDetail',
    ].every(
      (key) =>
        payload[key] === undefined ||
        (typeof payload[key] === 'string' && payload[key].length <= MAX_STRING_LENGTH),
    );
  }

  function sanitizePayload(payload) {
    const sanitized = {
      transport: payload.transport,
      direction: payload.direction,
      endpoint: payload.endpoint,
      timestamp: payload.timestamp,
      size: payload.size,
    };

    for (const key of [
      'preview',
      'textPayload',
      'base64Payload',
      'encoding',
      'error',
      'truncated',
      'lifecycleEvent',
      'lifecycleDetail',
      'connectionSeq',
    ]) {
      if (payload[key] !== undefined) {
        sanitized[key] = payload[key];
      }
    }
    return sanitized;
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !event.data ||
      event.data.source !== 'signalr-inspector' ||
      event.data.type !== 'signalr-message' ||
      !isValidPayload(event.data.payload)
    ) {
      return;
    }

    try {
      const delivery = chrome.runtime.sendMessage({
        source: 'signalr-inspector',
        type: 'signalr-message',
        payload: sanitizePayload(event.data.payload),
      });
      delivery?.catch?.(() => undefined);
    } catch {
      // The extension may have been reloaded while this isolated-world script is still alive.
    }
  });
})();
