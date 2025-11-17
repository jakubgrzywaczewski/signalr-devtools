(function inject() {
  const FLAG = '__signalrInspectorContent';
  if (window[FLAG]) {
    return;
  }
  Object.defineProperty(window, FLAG, { value: true, configurable: false, enumerable: false });

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.async = false;
  script.dataset.signalrInspector = 'true';
  script.addEventListener('load', () => script.remove());

  (document.documentElement || document.head || document.body).appendChild(script);
})();

window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'signalr-inspector') {
      return;
    }

    chrome.runtime.sendMessage(event.data);
  },
  false,
);
