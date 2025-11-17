const MAX_MESSAGES_PER_TAB = 2000;
const messageStore = new Map(); // tabId -> Array
const panelPorts = new Map(); // tabId -> Set<Port>

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
  if (messages.length > MAX_MESSAGES_PER_TAB) {
    messages.splice(0, messages.length - MAX_MESSAGES_PER_TAB);
  }
}

function broadcastToTab(tabId, payload) {
  const ports = panelPorts.get(tabId);
  if (!ports) {
    return;
  }
  ports.forEach((port) => {
    try {
      port.postMessage(payload);
    } catch (err) {
      console.error('SignalR Inspector: failed to post a message to the panel', err);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.source !== 'signalr-inspector') {
    return;
  }

  if (message.type === 'signalr-message') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      return;
    }

    const entry = {
      tabId,
      ...message.payload,
    };

    const messages = getTabMessages(tabId);
    messages.push(entry);
    trimMessages(tabId);

    broadcastToTab(tabId, { type: 'signalr-message', payload: entry });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('signalr-panel:')) {
    return;
  }

  const tabId = Number(port.name.split(':')[1]);
  if (Number.isNaN(tabId)) {
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
      broadcastToTab(tabId, { type: 'reset' });
    }
  });
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  messageStore.delete(tabId);
  const ports = panelPorts.get(tabId);
  if (!ports) {
    return;
  }
  ports.forEach((port) => {
    try {
      port.postMessage({ type: 'reset' });
      port.disconnect();
    } catch (err) {
      // ignore clean-up errors
    }
  });
  panelPorts.delete(tabId);
});
