const state = {
  messages: [],
  endpointFilter: '',
  payloadFilter: '',
  selectedId: null,
};

const tableWrapper = document.querySelector('.table-wrapper');
const tableBody = document.getElementById('messages');
const endpointFilterInput = document.getElementById('endpointFilter');
const payloadFilterInput = document.getElementById('payloadFilter');
const clearButton = document.getElementById('clearLog');
const statsEl = document.getElementById('stats');
const detailsMeta = document.getElementById('detailsMeta');
const detailsPayload = document.getElementById('detailsPayload');

const requestedTabId = Number(new URLSearchParams(window.location.search).get('tabId'));
const inspectedTabId =
  chrome.devtools?.inspectedWindow?.tabId ??
  (Number.isInteger(requestedTabId) && requestedTabId > 0 ? requestedTabId : 0);
const port = chrome.runtime.connect({ name: `signalr-panel:${inspectedTabId}` });

endpointFilterInput.addEventListener('input', (event) => {
  state.endpointFilter = event.target.value.trim().toLowerCase();
  render();
});

payloadFilterInput.addEventListener('input', (event) => {
  state.payloadFilter = event.target.value.trim().toLowerCase();
  render();
});

clearButton.addEventListener('click', () => {
  state.messages = [];
  state.selectedId = null;
  port.postMessage({ type: 'clear-log' });
  render();
  showDetails(null);
});

port.onMessage.addListener((msg) => {
  if (!msg) {
    return;
  }

  if (msg.type === 'init') {
    state.messages = Array.isArray(msg.payload) ? msg.payload.slice() : [];
    render();
    return;
  }

  if (msg.type === 'reset') {
    state.messages = [];
    state.selectedId = null;
    render();
    showDetails(null);
    return;
  }

  if (msg.type === 'signalr-message' && msg.payload) {
    state.messages.push(msg.payload);
    render(true);
  }
});

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
    const parsed = SignalRProtocol.parsePayload(message);
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

function render(scrollToLatest = false) {
  const fragment = document.createDocumentFragment();
  const filtered = [];

  state.messages.forEach((message) => {
    if (!messageMatchesFilters(message)) {
      return;
    }
    filtered.push(message);
    const parsed = SignalRProtocol.parsePayload(message);
    const row = document.createElement('tr');
    row.dataset.messageId = String(message.id);
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
    fragment.appendChild(row);
  });

  tableBody.textContent = '';
  tableBody.appendChild(fragment);

  statsEl.textContent = `${filtered.length} / ${state.messages.length} messages`;

  if (scrollToLatest && tableWrapper) {
    tableWrapper.scrollTop = tableWrapper.scrollHeight;
  }

  if (state.selectedId) {
    const current = state.messages.find((msg) => msg.id === state.selectedId);
    if (current) {
      showDetails(current);
    }
  } else {
    showDetails(null);
  }
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
    SignalRProtocol.parsePayload(message).kind,
    message.endpoint,
    `${formatTime(message.timestamp)}`,
    `${formatSize(message.size)}`,
  ]
    .filter(Boolean)
    .join(' | ');

  detailsPayload.textContent = SignalRProtocol.formatPayload(message);
}

tableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr');
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
});

render();
