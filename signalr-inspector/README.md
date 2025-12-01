# SignalR Inspector

Chrome DevTools extension that lists SignalR messages heading to gRPC endpoints (for example in Blazor Server/WebAssembly apps).

## Features

- dedicated DevTools panel with a log (timestamp, direction, endpoint, size, preview)
- filtering by endpoint substring and payload contents
- details pane showing full payload (text or Base64/binary preview)
- per-tab isolation plus manual log clearing

## Installation

1. Copy the `signalr-inspector` folder locally (it contains manifest, icons, code, and license).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and pick `signalr-inspector`.
4. Open a SignalR-enabled site, then DevTools → *SignalR Inspector*.

## How it works

- The content script injects `injected.js`, which wraps `WebSocket` and `EventSource`.
- Every message hitting an endpoint containing `/grpc` is serialized (text/Base64) and posted through `window.postMessage` → `contentScript` → `background`.
- The background service worker keeps a per-tab ring buffer (2,000 entries) and streams updates to the panel using `chrome.runtime.Port`.

## Automated tests

```bash
cd /Users/enkidu/exten/signalr-inspector
npm test
```

The suite currently covers the manifest contract plus the content script behavior using jsdom.

## Limitations

- Supports WebSocket and EventSource transports only (no long polling yet).
- Binary payloads are shown as Base64/hex snippets (no protobuf/MessagePack decoding).
- The extension is read-only; it never mutates or blocks traffic.

## Author & License

- Author: Jakub Grzywaczewski.
- License: see [`LICENSE.md`](LICENSE.md). A privacy note (no data leaves your browser) is available in [`PRIVACY.md`](PRIVACY.md).
