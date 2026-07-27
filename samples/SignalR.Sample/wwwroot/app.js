const RECORD_SEPARATOR = '\u001e';
const statusElement = document.getElementById('status');
const sendButton = document.getElementById('send');
const messages = document.getElementById('messages');
let socket;
let invocationId = 0;

async function connect() {
  const negotiateResponse = await fetch('/chatHub/negotiate?negotiateVersion=1', {
    method: 'POST',
  });
  if (!negotiateResponse.ok) {
    throw new Error(`Negotiation failed with HTTP ${negotiateResponse.status}`);
  }

  const negotiation = await negotiateResponse.json();
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${window.location.host}/chatHub?id=${encodeURIComponent(
    negotiation.connectionToken,
  )}`;

  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
  });
  socket.addEventListener('message', handleFrame);
  socket.addEventListener('close', () => {
    statusElement.textContent = 'Disconnected. Refresh the page to reconnect.';
    sendButton.disabled = true;
  });
}

function handleFrame(event) {
  for (const record of event.data.split(RECORD_SEPARATOR).filter(Boolean)) {
    const frame = JSON.parse(record);

    if (frame.error) {
      throw new Error(frame.error);
    }

    if (frame.type === undefined) {
      statusElement.textContent = 'Connected to /chatHub';
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

document.getElementById('messageForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const user = document.getElementById('user').value.trim();
  const message = document.getElementById('message').value.trim();
  if (!user || !message || socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    `${JSON.stringify({
      type: 1,
      invocationId: String(++invocationId),
      target: 'SendMessage',
      arguments: [user, message],
    })}${RECORD_SEPARATOR}`,
  );
});

connect().catch((error) => {
  statusElement.textContent = `Connection failed: ${error.message}`;
});
