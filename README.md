# SignalR Inspector

[![CI](https://github.com/jakubgrzywaczewski/signalr-devtools/actions/workflows/ci.yml/badge.svg)](https://github.com/jakubgrzywaczewski/signalr-devtools/actions/workflows/ci.yml)
[![Google Chrome](https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white)](#install)
[![Microsoft Edge](https://img.shields.io/badge/Edge-supported-0078D7?logo=microsoftedge&logoColor=white)](#install)

SignalR Inspector is a Chromium DevTools extension for Google Chrome and Microsoft Edge that turns
ASP.NET Core SignalR traffic into a focused, searchable message log.

![SignalR Inspector filtering a stream and showing its connection timeline](docs/images/signalr-inspector-demo.gif)

A browser's Network panel can display WebSocket frames, but a busy application quickly becomes
hard to follow: hub traffic is mixed with other requests, payloads are disconnected from their
direction and endpoint, and comparing messages requires repeatedly opening individual frames.
SignalR Inspector was created to keep that debugging loop in one place.

## Install

Chrome Web Store and Microsoft Edge Add-ons use the same reviewed Manifest V3 package:

- [Chrome Web Store](https://chromewebstore.google.com/detail/signalr-inspector/lgaffhilcepfgfiealbdadfedpdfnfla)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/signalr-inspector/hlohgfgkniolajoidmnmahelkejeimnh)

To install the current build from source, use Google Chrome or Microsoft Edge with Node.js 22 or
newer:

```bash
git clone https://github.com/jakubgrzywaczewski/signalr-devtools.git
cd signalr-devtools/signalr-inspector
npm ci
```

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select `signalr-inspector`.
3. Pin SignalR Inspector if you want its per-tab activation button to remain visible.

## What it provides

- automatic SignalR detection from the protocol handshake, regardless of the hub URL;
- incoming and outgoing messages with timestamps, endpoint, size, and payload preview;
- SignalR message types, hub methods, invocation IDs, completions, and errors;
- invocation-to-completion timing, error status, related-message navigation, and collapsible
  stream groups;
- a connection timeline for negotiation, transport changes, handshake, keep-alives, reconnects,
  closes, acknowledgements, and sequences;
- an Insights view with messages/s, bytes/s, hub-method distribution, and focused warnings for
  large outbound payloads, stale non-streaming invocations, interrupted streams, and abnormal
  keep-alive gaps;
- Azure SignalR Service redirect detection with a sanitized service-endpoint badge;
- WebSocket, Server-Sent Events, and HTTP Long Polling transport visibility;
- endpoint and payload search plus direction, message-type, and transport filters;
- keep-alive pings hidden from Messages by default while remaining available on demand and in the
  Timeline summary;
- formatted JSON and MessagePack payloads, with original Base64 retained for binary messages;
- versioned JSON session export/import for bug reports, offline review, and reproducible traces;
- a capture-state indicator ("Capturing · last at …" / "Not capturing") with an onboarding hint
  that explains how to activate capture from the toolbar icon;
- bounded per-tab, in-memory logs with a 500-message limit;
- no analytics, remote services, synchronization, or automatic persistence.

## Browser support

SignalR Inspector supports current stable versions of:

- Google Chrome;
- Microsoft Edge.

Both browsers use the same Manifest V3 package and extension APIs. Firefox and Safari are not
currently supported. Automated end-to-end coverage runs the unpacked extension in Playwright's
bundled Chromium against the real .NET sample; Chrome and Edge release candidates retain a manual
smoke test because branded browsers do not support automated side-loading through Playwright.

## Try the included sample

The sample requires the .NET 10 SDK. From the repository root, start it with:

```bash
dotnet run --project samples/SignalR.Sample
```

1. Open the sample URL in the browser where the extension is installed.
2. Open DevTools and select **SignalR Inspector**. Opening DevTools starts passive Long Polling
   observation for the inspected tab so negotiation and HTTP requests can be correlated from the
   beginning. WebSocket and SSE instrumentation remains off until explicit activation.
3. Click the SignalR Inspector toolbar icon. The extension activates page instrumentation only for
   that tab and reloads the page. Click the icon again to disable instrumentation and reload the
   tab without it.
4. Choose **WebSockets (JSON)**, **Long Polling (JSON)**, **Server-Sent Events (JSON)**, or
   **MessagePack (WebSockets)** and send a message.
5. Select **Run 3-item stream** to capture a StreamInvocation, three StreamItem records, and its
   Completion as one collapsible flow.
6. Select **Drop and reconnect**, then open Timeline to see the closed transport and replacement
   connection.
7. Use the direction, message-type, and transport selectors. Enable **Show pings** only when raw
   keep-alive traffic is useful.
8. Select **Export session** to save the current bounded log. Select **Import session** to replace
   the current log with a previously exported file after local validation.
9. Open **Insights** to review traffic rates, the busiest hub methods, protocol warnings, and
   whether the connection was redirected through Azure SignalR Service.

## SignalR-aware inspection

SignalR Inspector understands the JSON and MessagePack Hub Protocol encodings. It distinguishes
handshakes, invocations, stream items, completions, cancellations, pings, closes, acknowledgements,
and sequences. Hub targets such as `SendMessage` and `ReceiveMessage` are shown directly in the
table. Selected MessagePack payloads are decoded to readable JSON while retaining their original
Base64 for low-level comparison. The **Flow** column pairs invocations with their completion,
shows observed duration or errors, and groups stream items. The **Timeline** view reconstructs
connection lifecycle and stateful reconnect progress from captured protocol and transport events.
The **Insights** view derives local session statistics and conservative protocol warnings from the
same bounded log. A standard Azure SignalR Service negotiation redirect is shown without retaining
the returned access token. Only standard `*.service.signalr.net` endpoints are recognized — Azure
SignalR custom domains are not detected — and the redirect is observed only when DevTools is open
before the negotiation happens.
The panel can export the current bounded log as a versioned JSON session and import it later for
offline review. Exported files retain captured application payloads, omit transient tab and row
IDs, replace browser-generated document IDs with session-local pseudonyms, and re-sanitize
connection and access-token parameters in endpoint URLs.

![SignalR connection lifecycle timeline](docs/images/signalr-inspector-timeline.png)

![Filtering SignalR invocations by hub method](docs/images/signalr-inspector-filtering.png)

![SignalR traffic statistics and protocol warnings](docs/images/signalr-inspector-insights.png)

## Official SignalR references

SignalR Inspector is an independent developer tool built against the public ASP.NET Core SignalR
documentation and protocol:

- [ASP.NET Core SignalR overview](https://learn.microsoft.com/aspnet/core/signalr/introduction);
- [ASP.NET Core SignalR JavaScript client](https://learn.microsoft.com/aspnet/core/signalr/javascript-client);
- [ASP.NET Core SignalR MessagePack protocol](https://learn.microsoft.com/aspnet/core/signalr/messagepackhubprotocol);
- [SignalR Hub Protocol specification](https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/HubProtocol.md);
- [SignalR Transport Protocol specification](https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/TransportProtocols.md);
- [Chrome DevTools Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network);
- [ASP.NET Core source repository](https://github.com/dotnet/aspnetcore).

This project is not affiliated with or endorsed by Microsoft.

## How it works

```text
WebSocket / EventSource ──→ detection in the page's MAIN world ─┐
                                                               │
Long Polling / outgoing SSE HTTP ──→ read-only DevTools Network observer ─┤
                                                               ▼
              validation → extension service worker → DevTools panel
                              │
                              ├─ in-memory, per-tab ring buffer
                              └─ explicit user-directed JSON export/import
```

The extension does not guess based on paths such as `/signalr`, `/chatHub`, `/_blazor`, or
`/grpc`. A WebSocket is classified as SignalR when it sends the standard protocol handshake or
a valid JSON protocol frame. Long Polling requests are correlated through the negotiation
response, connection token, HTTP method, and SignalR frames. Connection and access tokens are
removed from displayed endpoints. This also supports applications with custom hub routes.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`signalr-inspector`](signalr-inspector) | Chromium extension, packaging, and tests |
| [`samples/SignalR.Sample`](samples/SignalR.Sample) | .NET 10 SignalR demo with dependency-free browser clients |
| [`tools/msgpack-fixtures`](tools/msgpack-fixtures) | Official .NET MessagePack golden-fixture generator |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Node and .NET continuous integration |
| [`CHANGELOG.md`](CHANGELOG.md) | Version-by-version project history |
| [`docs/store`](docs/store) | Public marketplace privacy policies |

## Current scope

SignalR Inspector currently captures:

- WebSocket traffic using the JSON or MessagePack protocol after a detectable handshake, including
  field-level decoding of standard MessagePack hub messages;
- incoming Server-Sent Events JSON protocol messages, plus outgoing SSE HTTP posts through the
  DevTools network observer — the send side therefore requires DevTools to be open before
  negotiation, and both observations of one SSE connection are merged into a single conversation;
- incoming and outgoing Long Polling JSON protocol messages, including negotiation correlation,
  empty-poll handling, and connection cleanup;
- stateful reconnect (.NET 8+) Ack and Sequence traffic — a resumed transport whose first hub
  frame is a Sequence is deterministically a resume, so it is folded back into the interrupted
  conversation and invocation pairing and stream groups continue across the drop.

Blazor Server circuits negotiate the MessagePack-based `blazorpack` protocol, which shares the
standard hub protocol framing and message shapes: the panel decodes circuit traffic on `/_blazor`
(`StartCircuit`, `JS.RenderBatch`, `OnRenderCompleted`, JS interop calls) with full message
semantics, while non-standard argument payloads fall back to raw previews.

It does not yet capture WebSocket or SSE traffic created inside iframes
or Web Workers. Non-SignalR binary payloads and malformed or incomplete MessagePack frames fall
back to Base64 and hex previews. Page code can detect or bypass the WebSocket and EventSource
wrappers, so the extension is a diagnostics aid rather than a security monitor. The extension is
read-only and never modifies application traffic.

## Inspect MessagePack traffic

The extension decodes the standard SignalR MessagePack framing automatically after the normal JSON
handshake selects `messagepack`. No extension setting or additional browser permission is needed.
Configure the application with the official protocol implementation:

```csharp
builder.Services.AddSignalR().AddMessagePackProtocol();
```

```javascript
const connection = new signalR.HubConnectionBuilder()
  .withUrl("/chatHub")
  .withHubProtocol(new signalR.protocols.msgpack.MessagePackHubProtocol())
  .build();
```

The server uses the `Microsoft.AspNetCore.SignalR.Protocols.MessagePack` NuGet package. The browser
client uses `@microsoft/signalr-protocol-msgpack`. The inspector decodes captured bytes for display
only; it does not deserialize them into application types or alter the connection.

## Browser store assets

The checked-in screenshots and README GIF in [`docs/images`](docs/images) render the shipped panel
with fixed fictional SignalR records. Run `npm run demo:generate` from `signalr-inspector` to
reproduce them. The 1280×800 screenshots and promotional tiles match the Chrome Web Store and
Microsoft Edge Add-ons listing dimensions.

## Privacy and security

SignalR Inspector does not request access to every website. WebSocket and SSE instrumentation is
installed only after the developer clicks the toolbar icon and grants temporary `activeTab`
access. Long Polling and outgoing Server-Sent Events posts are observed through the browser's
read-only DevTools Network API for the tab currently being inspected. Captured data remains in extension memory and is removed when the tab
closes, the service worker restarts, or the log is cleared. Connection and common access-token
parameters are removed from all displayed endpoints before captured messages are stored, and
payloads larger than 256 KiB are not retained. The extension writes captured data to disk only
when the developer explicitly selects **Export session**; those files can contain application
payloads and remain under the developer's control until deleted.

See [PRIVACY.md](signalr-inspector/PRIVACY.md), [SECURITY.md](SECURITY.md), and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Governance

[Jakub Grzywaczewski](https://github.com/jakubgrzywaczewski) is the sole maintainer and code
owner. External contributions are welcome through pull requests, but only the maintainer has
write and merge access to this repository.

## License

Released under the [MIT License](LICENSE).
