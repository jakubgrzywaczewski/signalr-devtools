'use strict';

const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
const longPollingObserver = SignalRLongPolling.createObserver({
  publish(payload) {
    const result = chrome.runtime.sendMessage({
      source: 'signalr-inspector',
      type: 'devtools-signalr-message',
      tabId: inspectedTabId,
      payload,
    });
    result?.catch((error) => {
      console.error('SignalR Inspector: failed to forward Long Polling traffic', error);
    });
  },
  onError(error) {
    console.error('SignalR Inspector: failed to inspect a network request', error);
  },
});

chrome.devtools.network.onRequestFinished.addListener((request) => {
  longPollingObserver.observe(request);
});

chrome.devtools.network.onNavigated.addListener(() => {
  longPollingObserver.reset();
});

chrome.devtools.panels.create(
  'SignalR Inspector',
  'icons/icon32.png',
  'panel.html',
  () => undefined,
);
