# SignalR Inspector extension

This directory contains the unpacked Manifest V3 Chrome extension.

## Development

```bash
npm ci
npm test
npm run package
```

Load this directory through `chrome://extensions` to test changes. The package command produces
`../dist/signalr-inspector.zip`.

## Architecture

- `injected.js` wraps page-level `WebSocket` and `EventSource` constructors and detects SignalR
  protocol frames.
- `contentScript.js` validates captured message shape and forwards accepted events across the
  extension boundary.
- `background.js` stores at most 500 entries per browser tab and connects them to DevTools.
- `panel.js` renders filtering, selection, payload details, and log clearing.
- `signalrProtocol.js` decodes SignalR JSON Hub Protocol message types and hub targets.

See the [repository README](../README.md) for installation, the sample workflow, supported
transports, and project motivation.
