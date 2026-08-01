'use strict';

importScripts('activation.js', 'sessionFormat.js');

const MAX_MESSAGES_PER_TAB = 500;
const MAX_STORED_CHARACTERS_PER_TAB = 10 * 1024 * 1024;
const MAX_STRING_LENGTH = 350_000;
const SENSITIVE_QUERY_PARAMETERS = ['id', 'access_token', 'accessToken'];
const PANEL_PORT_TAB_ID_PATTERN = /^[1-9]\d*$/;
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
const messageStore = new Map(); // tabId -> Array
const panelPorts = new Map(); // tabId -> Set<Port>
const messageCounters = new Map(); // tabId -> number
const storedCharacterCounts = new Map(); // tabId -> number
const messageCharacterCounts = new WeakMap(); // message -> number
const activation = globalThis.SignalRInspectorActivation;
const sessionFormat = globalThis.SignalRSessionFormat;
const devtoolsPageUrl = chrome.runtime.getURL('devtools.html');

// Keep this boundary validation in sync with contentScript.js.
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
  return ['preview', 'textPayload', 'base64Payload', 'encoding', 'error', 'lifecycleDetail'].every(
    (key) =>
      payload[key] === undefined ||
      (typeof payload[key] === 'string' && payload[key].length <= MAX_STRING_LENGTH),
  );
}

function sanitizeEndpoint(endpoint) {
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

function sanitizePayload(payload) {
  const sanitized = {
    transport: payload.transport,
    direction: payload.direction,
    endpoint: sanitizeEndpoint(payload.endpoint),
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

function getMessageTabId(message, sender) {
  if (typeof sender.tab?.id === 'number') {
    return sender.tab.id;
  }
  const senderUrl = sender.url || sender.documentUrl;
  if (
    message.type === 'devtools-signalr-message' &&
    sender.id === chrome.runtime.id &&
    senderUrl === devtoolsPageUrl &&
    Number.isInteger(message.tabId) &&
    message.tabId > 0
  ) {
    return message.tabId;
  }
  return null;
}

async function showActivationResult(tabId, result) {
  const active = result === 'active';
  const error = result === 'error';
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({
      color: error ? '#b42318' : '#16803c',
      tabId,
    }),
    chrome.action.setBadgeText({ text: active ? 'ON' : error ? '!' : '', tabId }),
    chrome.action.setTitle({
      title: active
        ? 'Disable SignalR Inspector for this tab'
        : error
          ? 'SignalR Inspector could not be enabled on this page'
          : 'Enable SignalR Inspector for this tab',
      tabId,
    }),
  ]);
}

async function handleActionClick(tab) {
  try {
    const result = await activation.toggleTab(chrome, tab);
    await showActivationResult(tab.id, result);
  } catch (error) {
    console.error('SignalR Inspector: tab activation failed', error);
    if (!Number.isInteger(tab?.id)) {
      return;
    }
    try {
      await showActivationResult(tab.id, 'error');
    } catch (badgeError) {
      console.error('SignalR Inspector: failed to update the action badge', badgeError);
    }
  }
}

chrome.action.onClicked.addListener(handleActionClick);

async function refreshActivationBadge(tabId, tab) {
  if (!Number.isInteger(tabId) || tabId <= 0 || typeof tab?.url !== 'string') {
    return;
  }

  const registrations = await chrome.scripting.getRegisteredContentScripts({
    ids: activation.scriptIdsForTab(tabId),
  });
  if (registrations.length === 0) {
    return;
  }

  const currentMatch = activation.matchPatternForUrl(tab.url);
  const matchesCurrentPage =
    currentMatch &&
    registrations.length === 2 &&
    registrations.every((registration) => registration.matches?.includes(currentMatch));
  if (matchesCurrentPage) {
    await showActivationResult(tabId, 'active');
    return;
  }

  await activation.deactivateTab(chrome, tabId);
}

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.status !== 'loading' && changeInfo?.status !== 'complete') {
    return;
  }
  refreshActivationBadge(tabId, tab).catch((error) => {
    console.error('SignalR Inspector: failed to restore the action badge', error);
  });
});

function getTabMessages(tabId) {
  if (!messageStore.has(tabId)) {
    messageStore.set(tabId, []);
  }
  return messageStore.get(tabId);
}

function getTabPorts(tabId) {
  if (!panelPorts.has(tabId)) {
    panelPorts.set(tabId, new Set());
  }
  return panelPorts.get(tabId);
}

function trimMessages(tabId) {
  const messages = getTabMessages(tabId);
  let storedCharacters = storedCharacterCounts.get(tabId) ?? 0;
  while (
    messages.length > MAX_MESSAGES_PER_TAB ||
    storedCharacters > MAX_STORED_CHARACTERS_PER_TAB
  ) {
    if (messages.length === 0) {
      break;
    }
    const removed = messages.shift();
    storedCharacters -= (removed && messageCharacterCounts.get(removed)) ?? 0;
  }
  storedCharacterCounts.set(tabId, Math.max(0, storedCharacters));
}

function countStoredCharacters(message) {
  return [
    'endpoint',
    'preview',
    'textPayload',
    'base64Payload',
    'encoding',
    'error',
    'lifecycleDetail',
    'documentId',
  ].reduce((total, key) => total + (typeof message[key] === 'string' ? message[key].length : 0), 0);
}

function importSessionMessages(tabId, candidates) {
  const normalized = sessionFormat.create(candidates).messages;
  const documentIdentities = new Map();
  const imported = normalized.map((message, index) => {
    const entry = { tabId, ...message, id: index + 1 };
    if (message.documentId !== undefined) {
      if (!documentIdentities.has(message.documentId)) {
        documentIdentities.set(
          message.documentId,
          `imported-document-${documentIdentities.size + 1}`,
        );
      }
      entry.documentId = documentIdentities.get(message.documentId);
    }
    messageCharacterCounts.set(entry, countStoredCharacters(entry));
    return entry;
  });
  const storedCharacters = imported.reduce(
    (total, message) => total + (messageCharacterCounts.get(message) ?? 0),
    0,
  );
  messageStore.set(tabId, imported);
  storedCharacterCounts.set(tabId, storedCharacters);
  messageCounters.set(tabId, imported.length);
  broadcastToTab(tabId, { type: 'init', payload: imported });
  return imported.length;
}

function broadcastToTab(tabId, payload) {
  const ports = panelPorts.get(tabId);
  if (!ports) {
    return;
  }
  for (const port of ports) {
    try {
      port.postMessage(payload);
    } catch (err) {
      console.error('SignalR Inspector: failed to post a message to the panel', err);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.source !== 'signalr-inspector') {
    return;
  }

  if (message.type === 'signalr-message' || message.type === 'devtools-signalr-message') {
    const tabId = getMessageTabId(message, sender);
    if (tabId === null || !isValidPayload(message.payload)) {
      return;
    }

    const entry = {
      tabId,
      ...sanitizePayload(message.payload),
      id: (messageCounters.get(tabId) ?? 0) + 1,
    };
    if (typeof sender.documentId === 'string' && sender.documentId.length <= 256) {
      entry.documentId = sender.documentId;
    }
    const entryCharacterCount = countStoredCharacters(entry);
    messageCharacterCounts.set(entry, entryCharacterCount);
    messageCounters.set(tabId, entry.id);

    const messages = getTabMessages(tabId);
    messages.push(entry);
    storedCharacterCounts.set(tabId, (storedCharacterCounts.get(tabId) ?? 0) + entryCharacterCount);
    trimMessages(tabId);

    broadcastToTab(tabId, { type: 'signalr-message', payload: entry });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('signalr-panel:')) {
    return;
  }

  const tabIdText = port.name.slice('signalr-panel:'.length);
  const tabId = Number(tabIdText);
  if (!PANEL_PORT_TAB_ID_PATTERN.test(tabIdText) || !Number.isInteger(tabId) || tabId <= 0) {
    port.disconnect();
    return;
  }

  const ports = getTabPorts(tabId);
  ports.add(port);

  port.postMessage({ type: 'init', payload: getTabMessages(tabId) });

  port.onDisconnect.addListener(() => {
    const set = panelPorts.get(tabId);
    if (!set) {
      return;
    }
    set.delete(port);
    if (set.size === 0) {
      panelPorts.delete(tabId);
    }
  });

  port.onMessage.addListener((msg) => {
    if (!msg) {
      return;
    }

    if (msg.type === 'clear-log') {
      messageStore.set(tabId, []);
      storedCharacterCounts.set(tabId, 0);
      broadcastToTab(tabId, { type: 'reset' });
      return;
    }

    if (msg.type === 'import-session') {
      try {
        const count = importSessionMessages(tabId, msg.payload);
        port.postMessage({ type: 'import-result', ok: true, count });
      } catch (error) {
        port.postMessage({
          type: 'import-result',
          ok: false,
          error: error instanceof Error ? error.message : 'Session import failed.',
        });
      }
    }
  });
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  activation.deactivateTab(chrome, tabId).catch((error) => {
    console.error('SignalR Inspector: failed to remove registered scripts', error);
  });
  messageStore.delete(tabId);
  messageCounters.delete(tabId);
  storedCharacterCounts.delete(tabId);
  const ports = panelPorts.get(tabId);
  if (!ports) {
    return;
  }
  for (const port of ports) {
    try {
      port.postMessage({ type: 'reset' });
      port.disconnect();
    } catch {
      // ignore clean-up errors
    }
  }
  panelPorts.delete(tabId);
});
