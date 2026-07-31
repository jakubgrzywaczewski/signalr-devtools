const RECORD_SEPARATOR = '\u001e';
const statusElement = document.getElementById('status');
const sendButton = document.getElementById('send');
const messages = document.getElementById('messages');
const parameters = new URLSearchParams(window.location.search);
const selectedTransport =
  parameters.get('transport') === 'long-polling' ? 'long-polling' : 'websockets';
const selectedProtocol =
  selectedTransport === 'websockets' && parameters.get('protocol') === 'messagepack'
    ? 'messagepack'
    : 'json';
const selectedScenario =
  selectedTransport === 'long-polling' ? 'long-polling-json' : `websockets-${selectedProtocol}`;
let sendFrame;
let invocationId = 0;

for (const button of document.querySelectorAll('[data-scenario]')) {
  if (button.dataset.scenario === selectedScenario) {
    button.setAttribute('aria-current', 'page');
  }
}

function setDisconnected(message) {
  statusElement.textContent = message;
  sendButton.disabled = true;
  sendFrame = undefined;
}

function addReceivedMessage(frame) {
  const item = document.createElement('li');
  item.textContent = `${frame.arguments[0]}: ${frame.arguments[1]}`;
  messages.prepend(item);
}

function handleJsonFrames(data, connectionLabel) {
  for (const record of data.split(RECORD_SEPARATOR).filter(Boolean)) {
    const frame = JSON.parse(record);

    if (frame.error) {
      throw new Error(frame.error);
    }

    if (frame.type === undefined) {
      statusElement.textContent = `Connected to /chatHub using ${connectionLabel}`;
      sendButton.disabled = false;
      continue;
    }

    if (frame.type === 1 && frame.target === 'ReceiveMessage') {
      addReceivedMessage(frame);
    }
  }
}

function handleMessagePackFrames(data) {
  for (const frame of SignalRSampleMessagePack.decodeFrames(data)) {
    if (frame[0] === 1 && frame[3] === 'ReceiveMessage') {
      addReceivedMessage({ arguments: frame[4] });
    }
  }
}

function connectWebSocket(negotiation) {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${window.location.host}/chatHub?id=${encodeURIComponent(
    negotiation.connectionToken,
  )}`;
  const socket = new WebSocket(url);
  const connectionLabel =
    selectedProtocol === 'messagepack' ? 'WebSockets + MessagePack' : 'WebSockets + JSON';
  let handshakeComplete = false;
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => {
    socket.send(`${JSON.stringify({ protocol: selectedProtocol, version: 1 })}${RECORD_SEPARATOR}`);
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string' || !handshakeComplete) {
      const handshake =
        typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      handleJsonFrames(handshake, connectionLabel);
      handshakeComplete = true;
    } else {
      handleMessagePackFrames(event.data);
    }
  });
  socket.addEventListener('close', () => {
    setDisconnected('Disconnected. Refresh the page to reconnect.');
  });
  sendFrame = (payload) => socket.send(payload);
}

async function sendHttpFrame(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(`HTTP send failed with status ${response.status}`);
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
        handleJsonFrames(payload, 'Long Polling + JSON');
      }
    }
  }

  poll().catch((error) => {
    if (!abortController.signal.aborted) {
      setDisconnected(`Connection failed: ${error.message}`);
    }
  });

  await firstPollStarted;
  sendFrame = (payload) => sendHttpFrame(url, payload);
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
  if (selectedTransport === 'long-polling') {
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

  invocationId += 1;
  const invocation = {
    type: 1,
    invocationId: String(invocationId),
    target: 'SendMessage',
    arguments: [user, message],
  };
  const payload =
    selectedProtocol === 'messagepack'
      ? SignalRSampleMessagePack.encodeFrame([
          invocation.type,
          {},
          invocation.invocationId,
          invocation.target,
          invocation.arguments,
          [],
        ])
      : `${JSON.stringify(invocation)}${RECORD_SEPARATOR}`;
  const result = sendFrame(payload);
  result?.catch((error) => {
    setDisconnected(`Send failed: ${error.message}`);
  });
});

connect().catch((error) => {
  setDisconnected(`Connection failed: ${error.message}`);
});
