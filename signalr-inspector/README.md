# SignalR Inspector extension

This directory contains the unpacked Manifest V3 extension for Google Chrome and Microsoft Edge.

## Development

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm run test:e2e:install
npm run test:e2e
npm run demo:generate
npm run package
```

`npm run check` runs the strict Biome preset, formatting checks, import organization, and the
extension-specific security policy. `npm run test:coverage` enforces coverage thresholds for the
runtime modules imported directly by Vitest; Chrome adapters loaded through VM or jsdom evaluation
remain protected by behavioral tests. Use `npm run lint` for lint-only validation.

`npm run test:e2e` starts the real .NET sample and loads a temporary copy of the unpacked
extension in Playwright's bundled Chromium. It verifies the Manifest V3 service worker,
dynamic MAIN/ISOLATED-world instrumentation, live JSON and MessagePack traffic, Flow and Insights,
and the session export/clear/import round-trip. The temporary copy receives host access only for
`http://127.0.0.1/*`, because headless Chromium cannot reproduce a toolbar click and its
`activeTab` grant; the shipped manifest remains limited to `activeTab` and `scripting`. The
toolbar grant, DevTools tab registration, and branded Chrome/Edge behavior remain part of the
manual browser smoke test.

`npm run demo:generate` opens the shipped panel in headless Chrome or Edge, injects fixed fictional
SignalR records through its normal port handler, asserts ping hiding, reconnect rendering, and
Insights warnings, and regenerates the README GIF, three 1280×800 store screenshots, and a separate
Insights screenshot. Set `CHROME_PATH` when the browser is not installed in a standard location.
GIF encoding currently uses the macOS Swift toolchain.

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
  Azure SignalR redirects, incoming GET polls, outgoing POST frames, and DELETE cleanup without
  wrapping page networking APIs. It distinguishes Server-Sent Events connections from Long
  Polling deterministically — a repeated SignalR POST with no completed poll proves the handshake
  response arrived through an event stream — and captures their outgoing posts and stream-end
  close. Redirect access tokens are never published into the captured log.
- `devtools.js` registers the panel and forwards validated network observations (Long Polling and
  outgoing Server-Sent Events posts) for its inspected tab.
- `contentScript.js` validates captured message shape and forwards accepted events across the
  extension boundary.
- `activation.js` registers both scripts for the activated tab and exact HTTP or HTTPS host before
  reloading the page.
- `background.js` stores at most 500 entries per browser tab and connects them to DevTools.
- The service worker adds a trusted, transient document identity to local connection sequences so
  concurrent connections to the same hub remain separate without retaining SignalR tokens.
- `panel.js` renders endpoint, payload, direction, message-type, and transport filtering,
  correlated flows, connection timelines, local traffic insights, protocol warnings, payload
  details, session import/export, and log clearing. Protocol pings remain captured but are hidden
  from Messages by default.
- `msgpackDecoder.js` defensively decodes bounded MessagePack values and SignalR VarInt frames.
- `sessionFormat.js` defines the versioned JSON session contract, strips transient identifiers,
  re-sanitizes endpoints, and enforces the same message-count and text budgets as the live log.
- `signalrAnalysis.js` correlates invocation flows, stream groups, lifecycle events, stateful
  reconnect progress, traffic statistics, and conservative warning thresholds without mutating
  captured records.
- `signalrProtocol.js` maps SignalR JSON and MessagePack Hub Protocol messages to panel records.

The MessagePack decoder has no runtime dependency and is shipped inside the extension package. Its
golden tests are generated separately with the pinned official ASP.NET Core protocol package in
`../tools/msgpack-fixtures`; the generator and NuGet dependencies are not included in the browser
ZIP.

Long Polling endpoint URLs are sanitized before captured messages leave the DevTools page.
Connection IDs, connection tokens, and common access-token query parameters are not stored with
messages or rendered.

## Session files

**Export session** writes the current bounded log to a local JSON file with format identifier
`signalr-inspector-session` and version `1`. Transient row and tab IDs are excluded. Captured
payloads are preserved, so exported files must be handled like the inspected application's own
debug logs. Browser-generated document IDs are replaced with stable session-local pseudonyms so
connection correlation is preserved without exposing the browser values.

**Import session** accepts only the current format version, at most 500 messages, the existing
10 MiB captured-text budget, and a 64 MiB serialized file limit. The panel validates the file
before sending it to the service worker; the service worker validates it again, replaces the log
atomically, assigns trusted row/tab/document IDs, and then continues normal bounded live capture.

See the [repository README](../README.md) for installation, the sample workflow, supported
transports, and project motivation.
