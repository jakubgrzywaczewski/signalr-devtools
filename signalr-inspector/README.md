# SignalR Inspector extension

This directory contains the unpacked Manifest V3 extension for Google Chrome and Microsoft Edge.

## Development

```bash
npm ci
npm run check
npm test
npm run package
```

`npm run check` runs the strict Biome preset, formatting checks, import organization, and the
extension-specific security policy. Use `npm run lint` for lint-only validation.

Load this directory through `chrome://extensions` in Chrome or `edge://extensions` in Edge to test
changes. The package command produces `../dist/signalr-inspector.zip`.

## Enable inspection

SignalR Inspector does not request access to every website. On the HTTP or HTTPS page that you
want to inspect, click the extension's toolbar icon once. The browser then grants temporary
`activeTab` access, the extension registers its page instrumentation for that tab, and the page
reloads automatically so the SignalR handshake can be captured from `document_start`.

The grant remains limited to the activated tab and its current site. Activate the extension again
after navigating that tab to a different site. Opening DevTools alone does not grant `activeTab`
access.

## Architecture

- `injected.js` wraps page-level `WebSocket` and `EventSource` constructors and detects SignalR
  protocol frames.
- `contentScript.js` validates captured message shape and forwards accepted events across the
  extension boundary.
- `activation.js` registers both scripts for the activated tab and exact HTTP or HTTPS host before
  reloading the page.
- `background.js` stores at most 500 entries per browser tab and connects them to DevTools.
- `panel.js` renders filtering, selection, payload details, and log clearing.
- `signalrProtocol.js` decodes SignalR JSON Hub Protocol message types and hub targets.

See the [repository README](../README.md) for installation, the sample workflow, supported
transports, and project motivation.
