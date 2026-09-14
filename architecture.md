# SignalR Inspector architecture

This document explains how SignalR Inspector captures, validates, stores, presents, and reuses
ASP.NET Core SignalR traffic. It also records the constraints behind the browser extension and the
independently published analysis package.

## Architectural goals

SignalR Inspector is designed around five properties:

1. **One Chromium extension package.** Chrome and Edge receive the same Manifest V3 archive.
2. **Least privilege.** Page instrumentation is enabled for one tab and one HTTP(S) host and
   scheme only after the user clicks the extension action. The shipped manifest requests only
   `activeTab` and `scripting`.
3. **Local and bounded processing.** Captured traffic stays in extension memory unless the user
   explicitly exports a session. There is no telemetry, synchronization, or remote analysis.
4. **Protocol-first detection.** Connections are identified from SignalR negotiation, handshake,
   framing, and hub-protocol evidence rather than application-specific URL patterns.
5. **One source for browser and Node analysis.** The public Node package stages the exact modules
   shipped by the extension instead of maintaining a second copy.

The detailed safety properties are numbered in
[`docs/extension-invariants.md`](docs/extension-invariants.md). Those invariants are part of the
design contract, not optional implementation guidance.

## Runtime data flow

```text
                              inspected HTTP(S) page
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 │                                           │
       WebSocket / EventSource                    negotiation / HTTP traffic
                 │                                           │
        injected.js (MAIN world)                  Chrome DevTools Network API
                 │                                           │
          window.postMessage()                    longPolling.js (DevTools page)
                 │                                           │
    contentScript.js (ISOLATED world)                        devtools.js
                 │                                           │
                 └──────────── chrome.runtime messages ──────┘
                                       │
                            background.js service worker
                       validate → sanitize → bound → correlate
                                       │
                           trusted per-tab panel port(s)
                                       │
                                   panel.js
                   Messages │ Flow │ Timeline │ Insights │ sessions
```

There are two capture paths because browser transports expose different useful observation points:

- `injected.js` wraps page-created `WebSocket` and `EventSource` objects in the MAIN world. This
  path sees WebSocket frames and incoming SSE events while preserving native behavior.
- `longPolling.js` reads completed requests through the DevTools Network API. It correlates
  negotiation, Long Polling GET/POST/DELETE traffic, Azure SignalR redirects, and outgoing SSE
  POSTs without changing page networking APIs.

Both paths converge in the service worker. The panel never trusts page-provided identifiers and
does not maintain a separate unbounded traffic history.

## Runtime components

| Component | Responsibility |
| --- | --- |
| `activation.js` | Registers and removes the per-tab MAIN- and ISOLATED-world scripts for the active HTTP(S) host and scheme, then reloads the tab so capture starts at `document_start`. |
| `injected.js` | Observes WebSocket and EventSource traffic, detects SignalR protocol evidence, preserves per-connection ordering, and emits sanitized capture candidates. |
| `contentScript.js` | Treats MAIN-world messages as hostile, validates and allowlist-copies their fields, and forwards accepted records to the extension. |
| `longPolling.js` | Correlates DevTools network requests into negotiation, Long Polling, and SSE records while removing connection and access tokens. |
| `devtools.js` | Owns the DevTools Network observer, forwards its records for the inspected tab, and registers the panel. |
| `background.js` | Revalidates records, sanitizes endpoints, assigns trusted local identities, stores bounded per-tab logs, and connects panel ports. |
| `panel.js` | Parses and caches records, renders Messages/Flow/Timeline/Insights, and coordinates explicit session import/export. |
| `signalrProtocol.js` | Parses and formats JSON and MessagePack Hub Protocol messages. |
| `msgpackDecoder.js` | Decodes bounded MessagePack values and SignalR VarInt frames without browser dependencies. |
| `signalrAnalysis.js` | Correlates invocations, completions, stream groups, connections, reconnects, statistics, and warnings without mutating captures. |
| `sessionFormat.js` | Defines the versioned portable session format, limits, validation, redaction, and serialization. |

## Capture lifecycle

### 1. Activation

The toolbar click grants `activeTab` access for the current page. The service worker registers two
non-persistent content scripts scoped to that tab's HTTP(S) host and scheme:

- `injected.js` at `document_start` in the MAIN world;
- `contentScript.js` at `document_start` in the ISOLATED world.

The page reload is intentional: observing a connection after its handshake would make protocol
detection and connection correlation incomplete. Opening DevTools alone starts the read-only
network observer but does not grant page instrumentation.

### 2. Validation and redaction

The inspected page is an untrusted boundary. Records crossing MAIN → ISOLATED are validated in
`contentScript.js`, then independently validated again in `background.js`. Only known fields are
copied, strings and payloads have size limits, and invalid records are discarded.

Endpoint query parameters named `id`, `access_token`, or `accessToken` are removed before records
are stored or displayed. Session import validates again in both the panel and service worker and
re-sanitizes endpoints rather than trusting a previously exported file.

### 3. Storage and identity

The service worker stores at most 500 messages and 10 MiB of captured text per tab. Row, tab, and
document identities are generated or normalized on the trusted extension side. Physical
connection sequences allow resumed transports to remain part of one logical conversation without
retaining SignalR connection tokens.

The MV3 service worker may stop between events. Panel ports reconnect, and state either survives in
the current worker instance or degrades explicitly; no hidden persistent store is introduced.

### 4. Analysis and presentation

The panel derives its views from the same bounded log:

- **Messages** shows decoded protocol records and filters;
- **Flow** pairs invocations with completions, reports observed duration and errors, and groups
  streaming messages;
- **Timeline** reconstructs negotiation, transport, handshake, reconnect, acknowledgement,
  sequence, and close events;
- **Insights** summarizes rates, sizes, methods, Azure SignalR use, and conservative warnings.

Analysis is read-only and cached. Incoming bursts are coalesced so one message does not trigger a
full hidden-view rebuild.

### 5. Session files

Export is the only persistence path and requires an explicit user action. A session contains the
captured application payloads, so it must be handled like a debug log. Transient browser IDs are
removed or replaced with session-local pseudonyms. Import is atomic and bounded to the same
message and text budgets as live capture, with an additional serialized-file limit.

## Shared analysis package

`@signalr-devtools/analysis` makes the headless protocol and analysis core available to Node
consumers. The extension remains the canonical source for these four files:

```text
signalr-inspector/msgpackDecoder.js
signalr-inspector/sessionFormat.js
signalr-inspector/signalrAnalysis.js
signalr-inspector/signalrProtocol.js
```

`packages/analysis/` permanently contains only package metadata, documentation, the license, and a
source digest. During a guarded pack or publish operation, the four canonical modules are copied
there temporarily, verified byte-for-byte, passed to npm, and removed on success or failure.

The package gate enforces:

- no browser-only `window`, `document`, or `chrome` dependency in the shared modules;
- SHA-256 source digests tied to the independent library version;
- byte identity between staged modules and extension sources;
- exactly seven files in the tarball;
- real CommonJS and ESM consumers installed from the generated tarball.

This keeps the extension free of a bundler and runtime dependencies while preventing browser and
Node behavior from silently diverging.

## Packaging and publication

The extension and analysis library have independent versions:

- every repository commit bumps the extension version in `package.json`, `package-lock.json`, and
  `manifest.json` together;
- a change to any of the four shared modules also requires
  `npm run analysis:version:bump -- <patch|minor|major>`, which updates the library manifest and
  regenerates its source digest.

The guarded npm wrapper has two deliberate execution modes:

| Operation | Process API | Streams | Reason |
| --- | --- | --- | --- |
| pack and machine-readable dry-run | `execFile` | captured | Release gates parse npm's JSON output. |
| real publish without `--dry-run` or `--json` | `spawn` | inherited | npm can display an OTP prompt or browser-authorization link in real time. |

Both modes run digest and source checks before npm and the same cleanup afterward. A nonzero
interactive exit code is an error; it cannot be mistaken for a successful publication.

A commit, extension release, npm publication, and browser-store submission are separate actions.
A version bump or push does not imply any of the others. In particular, pushing a `v*` tag starts
the GitHub release workflow, so tags are publication operations.

## Validation layers

| Layer | What it protects |
| --- | --- |
| Biome and extension security rules | Syntax, formatting, unsafe patterns, and repository policy. |
| Vitest and coverage thresholds | Parsing, boundaries, lifecycle behavior, panel behavior, and regression cases. |
| Analysis package gate | Purity, source identity, version digest, exact tarball, CJS, and ESM. |
| .NET sample and fixture builds | Compatibility with the real SignalR server and official MessagePack encoder. |
| Playwright E2E | The unpacked MV3 extension against live JSON, MessagePack, transport, Flow, Insights, and session scenarios. |
| Archive inspection | The store ZIP contains only the intended extension files. |
| Manual Chrome/Edge smoke test | Branded-browser activation, DevTools registration, and marketplace candidate behavior. |

Real npm publication is intentionally not a test: the first successful upload permanently consumes
a package version. The interactive process path is therefore tested with a stubbed child process,
while dry-run packaging and publication use npm itself.

## Repository map

| Path | Role |
| --- | --- |
| `signalr-inspector/` | Browser extension, release scripts, unit tests, Playwright tests, and packaging. |
| `packages/analysis/` | Metadata and staging location for the independently versioned Node package. |
| `samples/SignalR.Sample/` | Real .NET SignalR application used for manual and automated scenarios. |
| `tools/msgpack-fixtures/` | Generator using the official ASP.NET Core MessagePack protocol package. |
| `docs/extension-invariants.md` | Security, privacy, memory, lifecycle, and performance contracts. |
| `docs/store/` | Public marketplace privacy disclosures. |
| `.github/workflows/` | CI, archive validation, and release automation. |

## Rules for architectural changes

- A new capture field must update every matching validator, allowlist copy, and size-accounting
  path in the content script, service worker, panel, and session format.
- A new capture mechanism must preserve protocol-first detection, ordering, bounded memory, and
  endpoint redaction.
- A new permission, host scope, persistence mechanism, outbound request, telemetry path, or remote
  code source requires an explicit owner decision before implementation.
- A change to a shared module must satisfy both browser tests and the independently versioned Node
  package gates.
- A behavior change needs a regression test at the boundary where the behavior is enforced.
- Implementation and independent review are separate roles. The owner decides when to invoke the
  reviewer and when an accepted commit may be pushed or published.
