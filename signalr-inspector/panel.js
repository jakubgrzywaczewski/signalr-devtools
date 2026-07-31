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
  directionFilter: '',
  typeFilter: '',
  transportFilter: '',
  showPings: false,
  selectedId: null,
  revealedMessageId: null,
  activeView: 'messages',
  collapsedStreams: new Set(),
};
const parsedPayloads = new WeakMap();
let analysisDirty = true;
let currentAnalysis = null;
let renderScheduled = false;
let pendingScrollToLatest = false;

const tableWrapper = document.querySelector('.table-wrapper');
const tableBody = document.getElementById('messages');
const messagesView = document.getElementById('messagesView');
const timelineView = document.getElementById('timelineView');
const messagesTab = document.getElementById('messagesTab');
const timelineTab = document.getElementById('timelineTab');
const connectionSummary = document.getElementById('connectionSummary');
const timelineEvents = document.getElementById('timelineEvents');
const endpointFilterInput = document.getElementById('endpointFilter');
const payloadFilterInput = document.getElementById('payloadFilter');
const directionFilterInput = document.getElementById('directionFilter');
const typeFilterInput = document.getElementById('typeFilter');
const transportFilterInput = document.getElementById('transportFilter');
const showPingsInput = document.getElementById('showPings');
const clearButton = document.getElementById('clearLog');
const statsEl = document.getElementById('stats');
const detailsMeta = document.getElementById('detailsMeta');
const detailsRelations = document.getElementById('detailsRelations');
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
  state.revealedMessageId = null;
  render();
});

payloadFilterInput.addEventListener('input', (event) => {
  state.payloadFilter = event.target.value.trim().toLowerCase();
  state.revealedMessageId = null;
  render();
});

for (const [input, stateKey] of [
  [directionFilterInput, 'directionFilter'],
  [typeFilterInput, 'typeFilter'],
  [transportFilterInput, 'transportFilter'],
]) {
  input.addEventListener('change', (event) => {
    state[stateKey] = event.target.value;
    state.revealedMessageId = null;
    render();
  });
}

showPingsInput.addEventListener('change', (event) => {
  state.showPings = event.target.checked;
  state.revealedMessageId = null;
  render();
});

messagesTab.addEventListener('click', () => {
  setActiveView('messages');
});

timelineTab.addEventListener('click', () => {
  setActiveView('timeline');
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
    appendMessage(msg.payload);
    scheduleRender(shouldScrollToLatest);
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
  return [
    'endpoint',
    'preview',
    'textPayload',
    'base64Payload',
    'encoding',
    'error',
    'lifecycleDetail',
    'documentId',
  ].reduce(
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
  if (trimmed) {
    cleanupRetainedState();
  }
  return trimmed;
}

function cleanupRetainedState() {
  if (state.selectedId && !state.messages.some((message) => message.id === state.selectedId)) {
    state.selectedId = null;
  }
  const retainedIds = new Set(state.messages.map((message) => message.id));
  for (const streamId of state.collapsedStreams) {
    if (!retainedIds.has(streamId)) {
      state.collapsedStreams.delete(streamId);
    }
  }
  if (state.revealedMessageId && !retainedIds.has(state.revealedMessageId)) {
    state.revealedMessageId = null;
  }
}

function replaceMessages(messages) {
  state.messages = messages.slice();
  state.collapsedStreams.clear();
  state.revealedMessageId = null;
  state.storedCharacters = state.messages.reduce(
    (total, message) => total + countStoredCharacters(message),
    0,
  );
  trimMessages();
  cleanupRetainedState();
  analysisDirty = true;
}

function appendMessage(message) {
  state.messages.push(message);
  state.storedCharacters += countStoredCharacters(message);
  const trimmed = trimMessages();
  analysisDirty = true;
  return trimmed;
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

function getAnalysis() {
  if (analysisDirty || !currentAnalysis) {
    currentAnalysis = SignalRAnalysis.analyze(state.messages, getParsedPayload);
    analysisDirty = false;
  }
  return currentAnalysis;
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
  if (state.directionFilter && message.direction !== state.directionFilter) {
    return false;
  }

  if (state.transportFilter && message.transport !== state.transportFilter) {
    return false;
  }

  const parsed = getParsedPayload(message);
  const kinds = parsed.records?.length
    ? parsed.records.map((record) => record.kind)
    : [parsed.kind].filter(Boolean);
  const pingOnly = kinds.length > 0 && kinds.every((kind) => kind === 'Ping');
  if (pingOnly && !state.showPings && state.typeFilter !== 'Ping') {
    return false;
  }

  if (state.typeFilter) {
    const matchesType =
      (state.typeFilter === 'Lifecycle' && message.encoding === 'lifecycle') ||
      (state.typeFilter === 'Handshake' && kinds.some((kind) => kind.startsWith('Handshake'))) ||
      kinds.includes(state.typeFilter);
    if (!matchesType) {
      return false;
    }
  }

  const endpoint = message.endpoint?.toLowerCase() ?? '';
  if (state.endpointFilter && !endpoint.includes(state.endpointFilter)) {
    return false;
  }

  if (state.payloadFilter) {
    const info = getAnalysis().messageInfo.get(message.id);
    const haystack = [
      message.textPayload,
      message.preview,
      message.base64Payload,
      parsed.kind,
      parsed.target,
      parsed.summary,
      ...(info?.flowLabels ?? []),
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
  const info = getAnalysis().messageInfo.get(message.id);
  const row = document.createElement('tr');
  row.dataset.messageId = String(message.id);
  row.tabIndex = 0;
  row.setAttribute('aria-selected', String(message.id === state.selectedId));
  if (message.id === state.selectedId) {
    row.classList.add('selected');
  }
  if (info?.streamParentId) {
    row.classList.add('stream-child');
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

  const flowCell = document.createElement('td');
  if (info?.streamChildren.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'stream-toggle';
    toggle.dataset.streamId = String(message.id);
    const collapsed = state.collapsedStreams.has(message.id);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = `${collapsed ? '▸' : '▾'} ${info.streamChildren.length}`;
    flowCell.appendChild(toggle);
  }
  const flowLabel = document.createElement('span');
  flowLabel.textContent = info?.flowLabels.join(' · ') || '–';
  flowCell.appendChild(flowLabel);

  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSize(message.size);

  const previewCell = document.createElement('td');
  previewCell.textContent = parsed.summary || message.preview || '(empty payload)';

  row.append(timeCell, directionCell, typeCell, targetCell, flowCell, sizeCell, previewCell);
  return row;
}

function updateStats() {
  if (state.activeView === 'timeline') {
    statsEl.textContent = `${getAnalysis().timeline.length} lifecycle events`;
    return;
  }
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

function scheduleRender(shouldScrollToLatest = false) {
  pendingScrollToLatest ||= shouldScrollToLatest;
  if (renderScheduled) {
    return;
  }
  if (typeof window.requestAnimationFrame !== 'function') {
    const shouldScroll = pendingScrollToLatest;
    pendingScrollToLatest = false;
    render(shouldScroll);
    return;
  }

  renderScheduled = true;
  window.requestAnimationFrame(() => {
    renderScheduled = false;
    const shouldScroll = pendingScrollToLatest;
    pendingScrollToLatest = false;
    render(shouldScroll);
  });
}

function render(shouldScrollToLatest = false) {
  const analysis = getAnalysis();
  updateStats();
  if (state.activeView === 'timeline') {
    renderTimeline(analysis);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const message of state.messages) {
    const info = analysis.messageInfo.get(message.id);
    const reveal = message.id === state.revealedMessageId;
    if (!reveal && info?.streamParentId && state.collapsedStreams.has(info.streamParentId)) {
      continue;
    }
    if (!reveal && !messageMatchesFilters(message)) {
      continue;
    }
    fragment.appendChild(createRow(message));
  }

  tableBody.textContent = '';
  tableBody.appendChild(fragment);

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
  detailsRelations.textContent = '';
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

  if (message.id === state.revealedMessageId && !messageMatchesFilters(message)) {
    const note = document.createElement('span');
    note.className = 'relation-note';
    note.textContent = 'Shown despite active filters.';
    detailsRelations.appendChild(note);
  }

  const info = getAnalysis().messageInfo.get(message.id);
  for (const relatedId of info?.relatedMessageIds ?? []) {
    const related = state.messages.find((candidate) => candidate.id === relatedId);
    if (!related) {
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.relatedMessageId = String(relatedId);
    button.textContent = `Go to ${getParsedPayload(related).kind} #${relatedId}`;
    detailsRelations.appendChild(button);
  }
}

function setActiveView(view) {
  state.activeView = view;
  const showMessages = view === 'messages';
  messagesView.hidden = !showMessages;
  timelineView.hidden = showMessages;
  messagesTab.setAttribute('aria-selected', String(showMessages));
  timelineTab.setAttribute('aria-selected', String(!showMessages));
  endpointFilterInput.disabled = !showMessages;
  payloadFilterInput.disabled = !showMessages;
  directionFilterInput.disabled = !showMessages;
  typeFilterInput.disabled = !showMessages;
  transportFilterInput.disabled = !showMessages;
  showPingsInput.disabled = !showMessages;
  render();
}

function channelSummary(label, channel) {
  const values = [];
  if (channel.acknowledgedThrough !== null) {
    values.push(`delivered through #${channel.acknowledgedThrough}`);
  }
  if (channel.resumesAt !== null) {
    values.push(`resumes at #${channel.resumesAt}`);
  }
  return `${label}: ${values.join(' · ') || 'no Ack/Sequence observed'}`;
}

function renderTimeline(analysis) {
  const summaryFragment = document.createDocumentFragment();
  for (const connection of analysis.connections) {
    const card = document.createElement('article');
    card.className = 'connection-card';
    const title = document.createElement('h3');
    title.textContent = `${connection.id.replace('connection-', '#')} ${connection.transport || 'negotiating'}`;
    const endpoint = document.createElement('div');
    endpoint.className = 'connection-endpoint';
    endpoint.textContent = connection.endpoint;
    const status = document.createElement('div');
    status.textContent = `Status: ${connection.status}`;
    const inbound = document.createElement('div');
    inbound.textContent = channelSummary('Inbound', connection.inbound);
    const outbound = document.createElement('div');
    outbound.textContent = channelSummary('Outbound', connection.outbound);
    card.append(title, endpoint, status, inbound, outbound);
    summaryFragment.appendChild(card);
  }
  connectionSummary.textContent = '';
  connectionSummary.appendChild(summaryFragment);

  const timelineFragment = document.createDocumentFragment();
  for (const event of analysis.timeline) {
    const row = document.createElement('tr');
    row.dataset.messageId = String(event.messageId);
    row.tabIndex = 0;
    const time = document.createElement('td');
    time.textContent = formatTime(event.timestamp);
    const connection = document.createElement('td');
    connection.textContent = event.connectionId.replace('connection-', '#');
    const label = document.createElement('td');
    label.textContent = event.label;
    const detail = document.createElement('td');
    detail.textContent = event.detail || '–';
    row.append(time, connection, label, detail);
    timelineFragment.appendChild(row);
  }
  timelineEvents.textContent = '';
  timelineEvents.appendChild(timelineFragment);
}

function navigateToMessage(messageId, reveal = false) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }
  const info = getAnalysis().messageInfo.get(messageId);
  if (info?.streamParentId) {
    state.collapsedStreams.delete(info.streamParentId);
  }
  state.selectedId = messageId;
  state.revealedMessageId = reveal && !messageMatchesFilters(message) ? messageId : null;
  state.activeView = 'messages';
  messagesView.hidden = false;
  timelineView.hidden = true;
  messagesTab.setAttribute('aria-selected', 'true');
  timelineTab.setAttribute('aria-selected', 'false');
  endpointFilterInput.disabled = false;
  payloadFilterInput.disabled = false;
  directionFilterInput.disabled = false;
  typeFilterInput.disabled = false;
  transportFilterInput.disabled = false;
  showPingsInput.disabled = false;
  render();
  document
    .querySelector(`#messages tr[data-message-id="${messageId}"]`)
    ?.scrollIntoView?.({ block: 'nearest' });
}

function selectRow(row) {
  const messageId = Number(row?.dataset.messageId);
  if (messageId) {
    navigateToMessage(messageId);
  }
}

function selectTimelineRow(row) {
  const messageId = Number(row?.dataset.messageId);
  if (messageId) {
    navigateToMessage(messageId, true);
  }
}

tableBody.addEventListener('click', (event) => {
  const toggle = event.target.closest('.stream-toggle');
  if (toggle) {
    const streamId = Number(toggle.dataset.streamId);
    if (state.collapsedStreams.has(streamId)) {
      state.collapsedStreams.delete(streamId);
    } else {
      state.collapsedStreams.add(streamId);
    }
    render();
    return;
  }
  selectRow(event.target.closest('tr'));
});

tableBody.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  selectRow(event.target.closest('tr'));
});

detailsRelations.addEventListener('click', (event) => {
  const button = event.target.closest('[data-related-message-id]');
  if (!button) {
    return;
  }
  const relatedId = Number(button.dataset.relatedMessageId);
  navigateToMessage(relatedId, true);
});

timelineEvents.addEventListener('click', (event) => {
  selectTimelineRow(event.target.closest('tr'));
});

timelineEvents.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  selectTimelineRow(event.target.closest('tr'));
});

connectToBackground();
render();
