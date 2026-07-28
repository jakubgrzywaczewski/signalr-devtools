'use strict';

importScripts('activation.js');

const MAX_MESSAGES_PER_TAB = 500;
const MAX_STORED_CHARACTERS_PER_TAB = 10 * 1024 * 1024;
const MAX_STRING_LENGTH = 350_000;
const SENSITIVE_QUERY_PARAMETERS = ['id', 'access_token', 'accessToken'];
const PANEL_PORT_TAB_ID_PATTERN = /^[1-9]\d*$/;
const ALLOWED_TRANSPORTS = new Set(['websocket', 'server-sent events', 'long polling']);
const ALLOWED_DIRECTIONS = new Set(['incoming', 'outgoing']);
const messageStore = new Map(); // tabId -> Array
const panelPorts = new Map(); // tabId -> Set<Port>
const messageCounters = new Map(); // tabId -> number
const storedCharacterCounts = new Map(); // tabId -> number
const messageCharacterCounts = new WeakMap(); // message -> number
const activation = globalThis.SignalRInspectorActivation;
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
  return ['preview', 'textPayload', 'base64Payload', 'encoding', 'error'].every(
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
  for (const key of ['preview', 'textPayload', 'base64Payload', 'encoding', 'error', 'truncated']) {
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
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({
      color: active ? '#16803c' : '#b42318',
      tabId,
    }),
    chrome.action.setBadgeText({ text: active ? 'ON' : '!', tabId }),
    chrome.action.setTitle({
      title: active
        ? 'SignalR Inspector is enabled for this tab'
        : 'SignalR Inspector could not be enabled on this page',
      tabId,
    }),
  ]);
}

async function handleActionClick(tab) {
  try {
    await activation.activateTab(chrome, tab);
    await showActivationResult(tab.id, 'active');
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
  return ['endpoint', 'preview', 'textPayload', 'base64Payload', 'encoding', 'error'].reduce(
    (total, key) => total + (typeof message[key] === 'string' ? message[key].length : 0),
    0,
  );
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
