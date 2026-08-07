const RECORD_SEPARATOR = '\u001e';
const statusElement = document.getElementById('status');
const sendButton = document.getElementById('send');
const streamButton = document.getElementById('stream');
const reconnectButton = document.getElementById('reconnect');
const messages = document.getElementById('messages');
const parameters = new URLSearchParams(window.location.search);
const transportParameter = parameters.get('transport');
const selectedTransport = ['long-polling', 'server-sent-events'].includes(transportParameter)
  ? transportParameter
  : 'websockets';
const selectedProtocol =
  selectedTransport === 'websockets' && parameters.get('protocol') === 'messagepack'
    ? 'messagepack'
    : 'json';
const selectedScenario =
  selectedTransport === 'websockets'
    ? `websockets-${selectedProtocol}`
    : `${selectedTransport}-json`;
let sendFrame;
let invocationId = 0;
let activeTransport;
let reconnecting = false;

for (const button of document.querySelectorAll('[data-scenario]')) {
  if (button.dataset.scenario === selectedScenario) {
    button.setAttribute('aria-current', 'page');
  }
}

function setControlsEnabled(enabled) {
  sendButton.disabled = !enabled;
  streamButton.disabled = !enabled;
  reconnectButton.disabled = !enabled;
}

function setDisconnected(message) {
  statusElement.textContent = message;
  setControlsEnabled(false);
  sendFrame = undefined;
}

function addReceivedMessage(frame) {
  const item = document.createElement('li');
  item.textContent = `${frame.arguments[0]}: ${frame.arguments[1]}`;
  messages.prepend(item);
}

function addStreamEvent(message) {
  const item = document.createElement('li');
  item.textContent = message;
  messages.prepend(item);
}

function setConnected(connectionLabel) {
  statusElement.textContent = `Connected to /chatHub using ${connectionLabel}`;
  reconnecting = false;
  setControlsEnabled(true);
}

function handleJsonHubMessage(frame) {
  if (frame.type === 1 && frame.target === 'ReceiveMessage') {
    addReceivedMessage(frame);
  } else if (frame.type === 2) {
    addStreamEvent(`Stream item ${frame.item}`);
  } else if (frame.type === 3) {
    addStreamEvent(`Stream ${frame.invocationId} completed`);
  }
}

function handleJsonFrames(data, connectionLabel) {
  for (const record of data.split(RECORD_SEPARATOR).filter(Boolean)) {
    const frame = JSON.parse(record);

    if (frame.error) {
      throw new Error(frame.error);
    }

    if (frame.type === undefined) {
      setConnected(connectionLabel);
      continue;
    }

    handleJsonHubMessage(frame);
  }
}

function handleMessagePackFrames(data) {
  for (const frame of SignalRSampleMessagePack.decodeFrames(data)) {
    if (frame[0] === 1 && frame[3] === 'ReceiveMessage') {
      addReceivedMessage({ arguments: frame[4] });
    } else if (frame[0] === 2) {
      addStreamEvent(`Stream item ${frame[3]}`);
    } else if (frame[0] === 3) {
      addStreamEvent(`Stream ${frame[2]} completed`);
    }
  }
}

function replaceActiveTransport(transport) {
  activeTransport?.stop();
  activeTransport = transport;
}

function stopActiveTransport() {
  const transport = activeTransport;
  activeTransport = undefined;
  sendFrame = undefined;
  transport?.stop();
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
  const transport = {
    stop() {
      socket.close(4000, 'SignalR Inspector demo reconnect');
    },
  };
  replaceActiveTransport(transport);

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
    if (activeTransport !== transport) {
      return;
    }
    activeTransport = undefined;
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
  const transport = {
    stop() {
      abortController.abort();
      fetch(url, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    },
  };
  replaceActiveTransport(transport);
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
    if (!abortController.signal.aborted && activeTransport === transport) {
      activeTransport = undefined;
      setDisconnected(`Connection failed: ${error.message}`);
    }
  });

  await firstPollStarted;
  sendFrame = (payload) => sendHttpFrame(url, payload);
  await sendFrame(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);

  window.addEventListener(
    'pagehide',
    () => {
      if (activeTransport === transport) {
        stopActiveTransport();
      }
    },
    { once: true },
  );
}

async function connectServerSentEvents(negotiation) {
  const url = `/chatHub?id=${encodeURIComponent(negotiation.connectionToken)}`;
  const eventSource = new EventSource(url);
  const transport = {
    stop() {
      eventSource.close();
    },
  };
  replaceActiveTransport(transport);

  eventSource.addEventListener('message', (event) => {
    handleJsonFrames(event.data, 'Server-Sent Events + JSON');
  });
  eventSource.addEventListener('error', () => {
    if (activeTransport !== transport) {
      return;
    }
    activeTransport = undefined;
    eventSource.close();
    setDisconnected('Disconnected. Refresh the page to reconnect.');
  });

  await new Promise((resolve, reject) => {
    eventSource.addEventListener('open', resolve, { once: true });
    eventSource.addEventListener(
      'error',
      () => reject(new Error('Server-Sent Events connection failed')),
      { once: true },
    );
  });
  sendFrame = (payload) => sendHttpFrame(url, payload);
  await sendFrame(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
}

function encodeHubMessage(message) {
  if (selectedProtocol !== 'messagepack') {
    return `${JSON.stringify(message)}${RECORD_SEPARATOR}`;
  }

  return SignalRSampleMessagePack.encodeFrame([
    message.type,
    {},
    message.invocationId,
    message.target,
    message.arguments,
    [],
  ]);
}

function sendHubMessage(message) {
  const result = sendFrame?.(encodeHubMessage(message));
  result?.catch((error) => {
    setDisconnected(`Send failed: ${error.message}`);
  });
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
  } else if (selectedTransport === 'server-sent-events') {
    await connectServerSentEvents(negotiation);
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
  sendHubMessage(invocation);
});

streamButton.addEventListener('click', () => {
  if (!sendFrame) {
    return;
  }
  invocationId += 1;
  sendHubMessage({
    type: 4,
    invocationId: String(invocationId),
    target: 'StreamCounter',
    arguments: [3, 150],
  });
});

reconnectButton.addEventListener('click', async () => {
  if (!activeTransport || reconnecting) {
    return;
  }

  reconnecting = true;
  setDisconnected('Transport dropped. Reconnecting…');
  stopActiveTransport();
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  try {
    await connect();
  } catch (error) {
    reconnecting = false;
    setDisconnected(`Reconnect failed: ${error.message}`);
  }
});

connect().catch((error) => {
  setDisconnected(`Connection failed: ${error.message}`);
});
