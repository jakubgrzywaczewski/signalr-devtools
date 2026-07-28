'use strict';

const MAX_MESSAGES_PER_TAB = 500;
const MAX_STORED_CHARACTERS_PER_TAB = 10 * 1024 * 1024;
const INITIAL_RECONNECT_DELAY_MS = 100;
const MAX_RECONNECT_DELAY_MS = 5_000;

const state = {
  messages: [],
  storedCharacters: 0,
  endpointFilter: '',
  payloadFilter: '',
  selectedId: null,
};
const parsedPayloads = new WeakMap();

const tableWrapper = document.querySelector('.table-wrapper');
const tableBody = document.getElementById('messages');
const endpointFilterInput = document.getElementById('endpointFilter');
const payloadFilterInput = document.getElementById('payloadFilter');
const clearButton = document.getElementById('clearLog');
const statsEl = document.getElementById('stats');
const detailsMeta = document.getElementById('detailsMeta');
const detailsPayload = document.getElementById('detailsPayload');

// The query parameter is used by the deterministic local screenshot and panel test harnesses.
const requestedTabId = Number(new URLSearchParams(window.location.search).get('tabId'));
const inspectedTabId =
  chrome.devtools?.inspectedWindow?.tabId ??
  (Number.isInteger(requestedTabId) && requestedTabId > 0 ? requestedTabId : 0);
let port = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
let clearPending = false;

endpointFilterInput.addEventListener('input', (event) => {
  state.endpointFilter = event.target.value.trim().toLowerCase();
  render();
});

payloadFilterInput.addEventListener('input', (event) => {
  state.payloadFilter = event.target.value.trim().toLowerCase();
  render();
});

clearButton.addEventListener('click', () => {
  replaceMessages([]);
  state.selectedId = null;
  clearPending = true;
  postToBackground({ type: 'clear-log' });
  render();
});

function handleBackgroundMessage(msg) {
  if (!msg) {
    return;
  }

  if (msg.type === 'init') {
    if (clearPending) {
      return;
    }
    replaceMessages(Array.isArray(msg.payload) ? msg.payload : []);
    reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    render();
    return;
  }

  if (msg.type === 'reset') {
    clearPending = false;
    replaceMessages([]);
    state.selectedId = null;
    render();
    return;
  }

  if (msg.type === 'signalr-message' && msg.payload) {
    const shouldScrollToLatest = isNearLatest();
    const trimmed = appendMessage(msg.payload);
    if (trimmed) {
      render(shouldScrollToLatest);
      return;
    }
    if (messageMatchesFilters(msg.payload)) {
      tableBody.appendChild(createRow(msg.payload));
    }
    updateStats();
    if (shouldScrollToLatest) {
      scrollToLatest();
    }
  }
}

function connectToBackground() {
  if (inspectedTabId <= 0) {
    return;
  }

  const nextPort = chrome.runtime.connect({ name: `signalr-panel:${inspectedTabId}` });
  port = nextPort;
  nextPort.onMessage.addListener((message) => {
    if (port === nextPort) {
      handleBackgroundMessage(message);
    }
  });
  nextPort.onDisconnect.addListener(() => {
    if (port !== nextPort) {
      return;
    }
    port = null;
    window.setTimeout(connectToBackground, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  if (clearPending) {
    postToBackground({ type: 'clear-log' });
  }
}

function postToBackground(message) {
  if (!port) {
    return false;
  }
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

function countStoredCharacters(message) {
  return ['endpoint', 'preview', 'textPayload', 'base64Payload', 'encoding', 'error'].reduce(
    (total, key) => total + (typeof message?.[key] === 'string' ? message[key].length : 0),
    0,
  );
}

function trimMessages() {
  let trimmed = false;
  while (
    state.messages.length > MAX_MESSAGES_PER_TAB ||
    state.storedCharacters > MAX_STORED_CHARACTERS_PER_TAB
  ) {
    const removed = state.messages.shift();
    if (!removed) {
      break;
    }
    state.storedCharacters -= countStoredCharacters(removed);
    trimmed = true;
  }
  state.storedCharacters = Math.max(0, state.storedCharacters);

  if (state.selectedId && !state.messages.some((message) => message.id === state.selectedId)) {
    state.selectedId = null;
  }
  return trimmed;
}

function replaceMessages(messages) {
  state.messages = messages.slice();
  state.storedCharacters = state.messages.reduce(
    (total, message) => total + countStoredCharacters(message),
    0,
  );
  trimMessages();
}

function appendMessage(message) {
  state.messages.push(message);
  state.storedCharacters += countStoredCharacters(message);
  return trimMessages();
}

function getParsedPayload(message) {
  if (!message || typeof message !== 'object') {
    return SignalRProtocol.parsePayload(message);
  }
  if (!parsedPayloads.has(message)) {
    parsedPayloads.set(message, SignalRProtocol.parsePayload(message));
  }
  return parsedPayloads.get(message);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function formatSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return '–';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function messageMatchesFilters(message) {
  const endpoint = message.endpoint?.toLowerCase() ?? '';
  if (state.endpointFilter && !endpoint.includes(state.endpointFilter)) {
    return false;
  }

  if (state.payloadFilter) {
    const parsed = getParsedPayload(message);
    const haystack = [
      message.textPayload,
      message.preview,
      message.base64Payload,
      parsed.kind,
      parsed.target,
      parsed.summary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(state.payloadFilter)) {
      return false;
    }
  }

  return true;
}

function createRow(message) {
  const parsed = getParsedPayload(message);
  const row = document.createElement('tr');
  row.dataset.messageId = String(message.id);
  row.tabIndex = 0;
  row.setAttribute('aria-selected', String(message.id === state.selectedId));
  if (message.id === state.selectedId) {
    row.classList.add('selected');
  }

  const timeCell = document.createElement('td');
  timeCell.textContent = formatTime(message.timestamp);

  const directionCell = document.createElement('td');
  directionCell.textContent = message.direction === 'incoming' ? 'IN' : 'OUT';
  directionCell.classList.add(
    message.direction === 'incoming' ? 'direction-incoming' : 'direction-outgoing',
  );

  const typeCell = document.createElement('td');
  typeCell.textContent = parsed.kind;

  const targetCell = document.createElement('td');
  targetCell.textContent = parsed.target || '–';

  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSize(message.size);

  const previewCell = document.createElement('td');
  previewCell.textContent = parsed.summary || message.preview || '(empty payload)';

  row.append(timeCell, directionCell, typeCell, targetCell, sizeCell, previewCell);
  return row;
}

function updateStats() {
  const filteredCount = state.messages.filter(messageMatchesFilters).length;
  statsEl.textContent = `${filteredCount} / ${state.messages.length} messages`;
}

function scrollToLatest() {
  if (tableWrapper) {
    tableWrapper.scrollTop = tableWrapper.scrollHeight;
  }
}

function isNearLatest() {
  if (!tableWrapper) {
    return false;
  }
  return tableWrapper.scrollHeight - tableWrapper.scrollTop - tableWrapper.clientHeight <= 24;
}

function render(shouldScrollToLatest = false) {
  const fragment = document.createDocumentFragment();

  for (const message of state.messages) {
    if (!messageMatchesFilters(message)) {
      continue;
    }
    fragment.appendChild(createRow(message));
  }

  tableBody.textContent = '';
  tableBody.appendChild(fragment);

  updateStats();

  if (shouldScrollToLatest) {
    scrollToLatest();
  }

  const current = state.messages.find((message) => message.id === state.selectedId);
  if (!current) {
    state.selectedId = null;
  }
  showDetails(current ?? null);
}

function showDetails(message) {
  if (!message) {
    detailsMeta.textContent = 'Select a message to inspect its payload.';
    detailsPayload.textContent = '';
    return;
  }

  detailsMeta.textContent = [
    message.direction === 'incoming' ? 'Incoming' : 'Outgoing',
    message.transport,
    getParsedPayload(message).kind,
    message.endpoint,
    `${formatTime(message.timestamp)}`,
    `${formatSize(message.size)}`,
  ]
    .filter(Boolean)
    .join(' | ');

  detailsPayload.textContent = SignalRProtocol.formatPayload(message);
}

function selectRow(row) {
  if (!row) {
    return;
  }
  const messageId = Number(row.dataset.messageId);
  if (!messageId) {
    return;
  }
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }
  state.selectedId = messageId;
  render();
}

tableBody.addEventListener('click', (event) => {
  selectRow(event.target.closest('tr'));
});

tableBody.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  selectRow(event.target.closest('tr'));
});

connectToBackground();
render();
