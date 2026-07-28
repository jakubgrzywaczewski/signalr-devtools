const RECORD_SEPARATOR = '\u001e';
const statusElement = document.getElementById('status');
const sendButton = document.getElementById('send');
const messages = document.getElementById('messages');
const requestedTransport = new URLSearchParams(window.location.search).get('transport');
let sendFrame;
let invocationId = 0;

function setDisconnected(message) {
  statusElement.textContent = message;
  sendButton.disabled = true;
  sendFrame = undefined;
}

function handleFrame(data, transport) {
  for (const record of data.split(RECORD_SEPARATOR).filter(Boolean)) {
    const frame = JSON.parse(record);

    if (frame.error) {
      throw new Error(frame.error);
    }

    if (frame.type === undefined) {
      statusElement.textContent = `Connected to /chatHub using ${transport}`;
      sendButton.disabled = false;
      continue;
    }

    if (frame.type === 1 && frame.target === 'ReceiveMessage') {
      const item = document.createElement('li');
      item.textContent = `${frame.arguments[0]}: ${frame.arguments[1]}`;
      messages.prepend(item);
    }
  }
}

function connectWebSocket(negotiation) {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${window.location.host}/chatHub?id=${encodeURIComponent(
    negotiation.connectionToken,
  )}`;
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
  });
  socket.addEventListener('message', (event) => {
    handleFrame(event.data, 'WebSockets');
  });
  socket.addEventListener('close', () => {
    setDisconnected('Disconnected. Refresh the page to reconnect.');
  });
  sendFrame = (payload) => socket.send(payload);
}

async function sendLongPollingFrame(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(`Long Polling send failed with HTTP ${response.status}`);
  }
}

async function connectLongPolling(negotiation) {
  const url = `/chatHub?id=${encodeURIComponent(negotiation.connectionToken)}`;
  const abortController = new AbortController();
  let markFirstPollStarted;
  const firstPollStarted = new Promise((resolve) => {
    markFirstPollStarted = resolve;
  });

  async function poll() {
    let firstPoll = true;
    while (!abortController.signal.aborted) {
      if (firstPoll) {
        firstPoll = false;
        markFirstPollStarted();
      }
      const response = await fetch(url, {
        headers: { Accept: 'text/plain' },
        signal: abortController.signal,
      });
      if (response.status === 204) {
        continue;
      }
      if (!response.ok) {
        throw new Error(`Long Polling receive failed with HTTP ${response.status}`);
      }
      const payload = await response.text();
      if (payload) {
        handleFrame(payload, 'Long Polling');
      }
    }
  }

  poll().catch((error) => {
    if (!abortController.signal.aborted) {
      setDisconnected(`Connection failed: ${error.message}`);
    }
  });

  await firstPollStarted;
  sendFrame = (payload) => sendLongPollingFrame(url, payload);
  await sendFrame(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);

  window.addEventListener(
    'pagehide',
    () => {
      abortController.abort();
      fetch(url, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    },
    { once: true },
  );
}

async function connect() {
  const negotiateResponse = await fetch('/chatHub/negotiate?negotiateVersion=1', {
    method: 'POST',
  });
  if (!negotiateResponse.ok) {
    throw new Error(`Negotiation failed with HTTP ${negotiateResponse.status}`);
  }

  const negotiation = await negotiateResponse.json();
  if (requestedTransport === 'long-polling') {
    await connectLongPolling(negotiation);
  } else {
    connectWebSocket(negotiation);
  }
}

document.getElementById('messageForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const user = document.getElementById('user').value.trim();
  const message = document.getElementById('message').value.trim();
  if (!user || !message || !sendFrame) {
    return;
  }

  const result = sendFrame(
    `${JSON.stringify({
      type: 1,
      invocationId: String(++invocationId),
      target: 'SendMessage',
      arguments: [user, message],
    })}${RECORD_SEPARATOR}`,
  );
  result?.catch((error) => {
    setDisconnected(`Send failed: ${error.message}`);
  });
});

connect().catch((error) => {
  setDisconnected(`Connection failed: ${error.message}`);
});
