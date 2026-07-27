# SignalR Inspector

[![CI](https://github.com/jakubgrzywaczewski/signalr-devtools/actions/workflows/ci.yml/badge.svg)](https://github.com/jakubgrzywaczewski/signalr-devtools/actions/workflows/ci.yml)

SignalR Inspector is a Chrome DevTools extension that turns ASP.NET Core SignalR traffic into a
focused, searchable message log.

![SignalR Inspector showing decoded hub traffic](docs/images/signalr-inspector-live.png)

Chrome's Network panel can display WebSocket frames, but a busy application quickly becomes hard
to follow: hub traffic is mixed with other requests, payloads are disconnected from their
direction and endpoint, and comparing messages requires repeatedly opening individual frames.
SignalR Inspector was created to keep that debugging loop in one place.

## What it provides

- automatic SignalR detection from the protocol handshake, regardless of the hub URL;
- incoming and outgoing messages with timestamps, endpoint, size, and payload preview;
- SignalR message types, hub methods, invocation IDs, completions, and errors;
- endpoint and payload filtering;
- complete text payloads and Base64 previews for binary messages;
- bounded per-tab, in-memory logs with a 500-message limit;
- no analytics, remote services, or persistence.

## Try it in five minutes

Requirements: Chrome, Node.js 22 or newer, and the .NET 10 SDK.

```bash
git clone git@github.com:jakubgrzywaczewski/signalr-devtools.git
cd signalr-devtools/signalr-inspector
npm ci
npm test
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `signalr-inspector`.
3. Start the included sample:

   ```bash
   dotnet run --project samples/SignalR.Sample
   ```

4. Open the sample URL in Chrome.
5. Open DevTools, select **SignalR Inspector**, and send a message from the sample page.
6. Select any captured row to inspect the full JSON protocol frame.

## SignalR-aware inspection

SignalR Inspector understands the JSON Hub Protocol record separator and message types. It
distinguishes handshakes, invocations, stream items, completions, cancellations, pings, closes,
acknowledgements, and sequences. Hub targets such as `SendMessage` and `ReceiveMessage` are shown
directly in the table, while selected payloads are formatted as readable JSON.

![Filtering SignalR invocations by hub method](docs/images/signalr-inspector-filtering.png)

## How it works

```text
WebSocket / EventSource
        │
        ▼
SignalR protocol detection in the page's MAIN world
        │  validated window message
        ▼
Isolated content script → extension service worker → DevTools panel
                              │
                              └─ in-memory, per-tab ring buffer
```

The extension does not guess based on paths such as `/signalr`, `/chatHub`, `/_blazor`, or
`/grpc`. A WebSocket is classified as SignalR when it sends the standard protocol handshake or
a valid JSON protocol frame. This also supports applications with custom hub routes.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`signalr-inspector`](signalr-inspector) | Chrome extension, packaging, and tests |
| [`samples/SignalR.Sample`](samples/SignalR.Sample) | Dependency-free .NET 10 SignalR demo |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Node and .NET continuous integration |

## Current scope

SignalR Inspector currently captures:

- WebSocket traffic using the JSON or MessagePack protocol after a detectable handshake;
- incoming Server-Sent Events JSON protocol messages.

It does not yet capture Long Polling requests, outgoing SSE HTTP posts, decode MessagePack, or
decode MessagePack fields. Binary payloads are shown as Base64 and hex previews. The extension is
read-only and never modifies application traffic.

## Store assets

The checked-in screenshots were produced from the real .NET sample and extension pipeline. Their
dimensions and intended Chrome Web Store slots are documented in
[`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md). The local generation harness is excluded
from source control because it is not part of the extension or its automated verification.

## Privacy and security

Inspecting arbitrary SignalR applications requires access to pages where the developer opens
DevTools, so Chrome displays a broad site-access warning. Captured data remains in extension
memory and is removed when the tab closes or the log is cleared. Payloads larger than 256 KiB are
not retained.

See [PRIVACY.md](signalr-inspector/PRIVACY.md), [SECURITY.md](SECURITY.md), and
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Released under the [MIT License](LICENSE).
