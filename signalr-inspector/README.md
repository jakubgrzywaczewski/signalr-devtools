# SignalR Inspector extension

This directory contains the unpacked Manifest V3 extension for Google Chrome and Microsoft Edge.

## Development

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm run package
```

`npm run check` runs the strict Biome preset, formatting checks, import organization, and the
extension-specific security policy. `npm run test:coverage` enforces coverage thresholds for the
runtime modules imported directly by Vitest; Chrome adapters loaded through VM or jsdom evaluation
remain protected by behavioral tests. Use `npm run lint` for lint-only validation.

Load this directory through `chrome://extensions` in Chrome or `edge://extensions` in Edge to test
changes. Open DevTools and the SignalR Inspector panel before activating the toolbar action so
Long Polling negotiation is captured from the beginning. The package command produces
`../dist/signalr-inspector.zip`.

## Enable inspection

SignalR Inspector does not request access to every website. On the HTTP or HTTPS page that you
want to inspect, click the extension's toolbar icon once. The browser then grants temporary
`activeTab` access, the extension registers its page instrumentation for that tab, and the page
reloads automatically so the SignalR handshake can be captured from `document_start`.

The grant remains limited to the activated tab and its current site. Activate the extension again
after navigating that tab to a different site. Click the toolbar icon again on an activated tab to
remove the page instrumentation and reload the page without it. Opening DevTools alone does not
grant `activeTab` access.

## Architecture

- `injected.js` wraps page-level `WebSocket` and `EventSource` constructors and detects SignalR
  protocol frames.
- `longPolling.js` uses the read-only DevTools Network API to correlate SignalR negotiation,
  incoming GET polls, outgoing POST frames, and DELETE cleanup without wrapping page networking
  APIs.
- `devtools.js` registers the panel and forwards validated Long Polling observations for its
  inspected tab.
- `contentScript.js` validates captured message shape and forwards accepted events across the
  extension boundary.
- `activation.js` registers both scripts for the activated tab and exact HTTP or HTTPS host before
  reloading the page.
- `background.js` stores at most 500 entries per browser tab and connects them to DevTools.
- `panel.js` renders filtering, correlated flows, connection timelines, payload details, and log
  clearing.
- `msgpackDecoder.js` defensively decodes bounded MessagePack values and SignalR VarInt frames.
- `signalrAnalysis.js` correlates invocation flows, stream groups, lifecycle events, and stateful
  reconnect progress without mutating captured records.
- `signalrProtocol.js` maps SignalR JSON and MessagePack Hub Protocol messages to panel records.

The MessagePack decoder has no runtime dependency and is shipped inside the extension package. Its
golden tests are generated separately with the pinned official ASP.NET Core protocol package in
`../tools/msgpack-fixtures`; the generator and NuGet dependencies are not included in the browser
ZIP.

Long Polling endpoint URLs are sanitized before captured messages leave the DevTools page.
Connection IDs, connection tokens, and common access-token query parameters are not stored with
messages or rendered.

See the [repository README](../README.md) for installation, the sample workflow, supported
transports, and project motivation.
