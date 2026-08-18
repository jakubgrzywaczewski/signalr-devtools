# SignalR Is Not Just a WebSocket Frame

## Building the Chrome DevTools panel I wanted while debugging real-time applications

![SignalR Inspector — understand hub traffic, not raw frames](images/signalr-inspector-cover.png)

Recently, I returned to a small browser extension I had written some time ago.

The extension had a dedicated panel in Chrome DevTools, a table with incoming and outgoing
messages, filters, and a details view. It worked well enough for the application I was debugging
at the time. Like many internal tools, it was born from a very concrete irritation, solved a
specific problem, and then quietly waited in a repository.

When I opened the code again with the intention of publishing it, I expected mostly maintenance:
update dependencies, improve the README, add a sample, perhaps create a few screenshots.

Instead, I found a much more interesting question:

> What exactly does it mean to inspect SignalR traffic?

Is it enough to display WebSocket frames? Should an inspector recognize a URL such as
`/notificationsHub` or `/chatHub`? Is SignalR simply a label attached to a WebSocket connection,
or is there a protocol hiding one level above the transport?

The difference sounds academic until we try to build a debugging tool. Then it becomes the whole
architecture.

In this article, “SignalR” means ASP.NET Core SignalR and its Hub Protocol, not the older ASP.NET
SignalR implementation.

## Problem: Chrome Shows the Transport, Not the Conversation

Chrome DevTools already has a Network panel. When an application establishes a WebSocket
connection, we can select it and inspect the messages flowing in both directions.

For a simple application, this may be sufficient.

For a real SignalR application, the view quickly becomes less helpful. We see frames such as:

```text
{"type":1,"invocationId":"1","target":"SendMessage","arguments":["Ada","Hello"]}\u001e
```

The data is there, but its meaning is implicit.

The developer still has to remember that:

- `type: 1` means an invocation,
- `target` is a hub method,
- `invocationId` connects an invocation with its completion,
- several protocol messages may share one transport frame,
- a record separator terminates JSON Hub Protocol messages,
- `{}` is the successful handshake response,
- `type: 6` is a ping,
- `type: 7` closes the connection.

Chrome exposes the wire. The developer reconstructs the conversation.

This is not necessarily a defect in Chrome. The Network panel is a general-purpose instrument. It
cannot turn every application protocol into a first-class debugging model. But this is precisely
where specialized developer tools become useful.

Firefox provides an interesting point of comparison. Its WebSocket inspector explicitly supports
several higher-level protocols, including SignalR, and can present parsed payloads as expandable
data [4]. Chrome has excellent low-level visibility, but it leaves more of the SignalR
interpretation to the developer.

This gap became the reason for building SignalR Inspector.

![SignalR Inspector showing decoded hub traffic](images/signalr-inspector-live.png)

## My First Mistake: Looking at the Endpoint Instead of the Protocol

The first version of the extension classified traffic by URL. If an endpoint contained `/grpc`,
the extension assumed that it represented the traffic I wanted to inspect.

This worked for one application.

It was also conceptually wrong.

SignalR and gRPC are different technologies. More importantly, a SignalR hub can use practically
any route:

```csharp
app.MapHub<ChatHub>("/chatHub");
```

Another application may expose `/notifications`, `/events`, or a route defined by an internal
convention.

An inspector that recognizes only one path is not a protocol inspector. It is an application-
specific filter wearing a generic name.

This distinction reminded me of a common architectural smell: identifying a concept by where we
happened to find it rather than by what it actually is. It is similar to assuming that every JSON
response under `/api` is REST, or that every long-running HTTP request is streaming.

URLs are deployment choices. The SignalR handshake is protocol evidence.

## From URL Heuristics to Protocol Detection

After SignalR establishes an underlying transport, it begins the Hub Protocol conversation with a
handshake. The handshake does not select WebSockets, Server-Sent Events, or Long Polling; that
choice has already happened. It selects the message format used above the transport — JSON or
MessagePack [1].

For the JSON Hub Protocol, the client sends a handshake similar to:

```json
{"protocol":"json","version":1}
```

The message is followed by the ASCII record separator character (`0x1e`). Once the handshake
completes, hub messages carry numeric types defined by the protocol.

That gives the extension a much stronger detection strategy:

1. Observe a WebSocket or Server-Sent Events stream.
2. Buffer a small number of initial messages.
3. Look for the SignalR handshake or a plausible JSON Hub Protocol message.
4. Only after detection, publish the buffered messages to the extension.
5. Ignore unrelated WebSocket traffic.

In simplified form:

```javascript
function isSignalRHandshake(data) {
  if (typeof data !== 'string') {
    return false;
  }

  const firstRecord = data.split('\u001e', 1)[0];

  try {
    const message = JSON.parse(firstRecord);
    return (
      typeof message?.protocol === 'string' &&
      Number.isInteger(message.version)
    );
  } catch {
    return false;
  }
}
```

The extension no longer needs to know whether the hub is called `/chatHub`, `/_blazor`, or
`/this-name-will-change-next-sprint`.

It recognizes SignalR because SignalR introduces itself.

There is one transport this strategy cannot see at all: HTTP Long Polling has no page-level
stream to wrap. That story requires a different observation point, and I will return to it after
describing the architecture.

## A Browser Extension Is a Distributed System in Miniature

At first glance, a DevTools extension appears to be a few JavaScript files and a manifest.

Architecturally, it is closer to a tiny distributed system running inside the browser.

SignalR Inspector has four relevant execution areas:

```text
Application page (MAIN world)
        ↓
Content script (ISOLATED world)
        ↓
Extension service worker
        ↓
DevTools panel
```

Each boundary exists for a reason.

### Layer 1: The page world — close to the traffic, far from trust

To observe calls to `WebSocket.send`, the extension has to instrument the constructor used by the
application. An isolated content script cannot directly replace a page-owned JavaScript global.

Manifest V3 allows content scripts to run in the `MAIN` world [2]. An early version declared
this script statically for `<all_urls>`, which meant the extension instrumented every website all
the time. SignalR Inspector 1.0 inverts that: nothing is injected until the developer clicks the
toolbar action on the tab they want to inspect. The click grants temporary `activeTab` access,
and the extension registers its scripts dynamically, scoped to that tab's exact host:

```javascript
await chrome.scripting.registerContentScripts([
  {
    id: `signalr-main-${tabId}`,
    js: ['injected.js'],
    matches: [`${url.protocol}//${url.hostname}/*`],
    runAt: 'document_start',
    world: 'MAIN',
    persistAcrossSessions: false,
  },
]);
```

Running at `document_start` matters. If the application captures the native `WebSocket`
constructor before the extension wraps it, the inspector will miss the connection. Because
activation happens on a page that has already loaded, the extension reloads the tab after
registration so the handshake is observed from the very first frame. Clicking the toolbar action
again unregisters the instrumentation and reloads the page without it — activation is a true
per-tab toggle, not a one-way switch.

The MAIN world solves the visibility problem, but it creates a trust problem. Code in this world
shares an environment with the page. The page can inspect it, interfere with it, or imitate the
messages it emits.

The instrumentation must therefore remain deliberately unprivileged.

### Layer 2: The isolated content script — the customs officer

The content script receives messages crossing from the page into the extension. Checking
`event.source` and `event.origin` is useful, but it does not authenticate the page against itself.
The page is still capable of producing a correctly shaped `window.postMessage`.

Therefore, the bridge must behave like an API exposed to untrusted input:

- accept only known transports and directions,
- validate timestamps and sizes,
- limit URL and payload lengths,
- discard unexpected properties,
- construct a new allowlisted object,
- never accept tab, row, or document identifiers from the page.

I like to think of this layer as a customs officer. Its purpose is not to understand the whole
SignalR conversation. Its purpose is to decide exactly what may cross the border.

### Layer 3: The service worker — transient coordination

The service worker associates messages with browser tabs, maintains a bounded in-memory log, and
streams updates to the DevTools panel.

Manifest V3 service workers are ephemeral and Chrome may terminate them after a period of
inactivity [3]. This is often treated as an inconvenience, but it is better understood as a
design constraint: process lifetime is not storage.

For this extension, transient state is acceptable and even desirable. Captured messages:

- remain in memory,
- are scoped per tab,
- are limited to 500 entries and an aggregate payload budget,
- are stripped of connection IDs and common access-token query parameters before display,
- disappear when the tab closes or the worker restarts,
- are never sent to a remote service,
- leave the browser only when the developer explicitly exports them to a local file.

Ephemeral workers also restart at inconvenient moments. The DevTools panel therefore reconnects
its port after a worker restart instead of assuming the first connection lives forever — another
place where the platform's lifecycle rules become explicit code.

The privacy model and the runtime model reinforce each other.

### Layer 4: The panel — meaning above transport

The DevTools panel should not repeat the Network panel with a different color scheme. Its purpose
is to raise the abstraction level.

The parser maps SignalR message types into developer concepts:

| Type | Meaning |
| ---: | --- |
| 1 | Invocation |
| 2 | Stream item |
| 3 | Completion |
| 4 | Stream invocation |
| 5 | Cancel invocation |
| 6 | Ping |
| 7 | Close |
| 8 | Acknowledgement |
| 9 | Sequence |

As a result, the table can show `Invocation → SendMessage` instead of asking the developer to
decode `{"type":1,"target":"SendMessage"}` repeatedly.

![Filtering a stream invocation by message type](images/signalr-inspector-filtering.png)

SignalR Inspector 1.0 decodes both Hub Protocol encodings: JSON and MessagePack.

## Beyond JSON: Decoding MessagePack

MessagePack support started as an honest limitation. The handshake is always JSON, so the
extension could identify a MessagePack connection, but for a while it presented the binary frames
only as Base64 and hexadecimal previews rather than pretending to understand them.

Version 1.0 understands them. After the handshake selects `messagepack`, the binary payload is a
sequence of messages, each stored as a VarInt length prefix followed by a MessagePack-encoded hub
message [9]. The extension ships a
dependency-free decoder that handles the framing, maps hub message types 1–9, renders 64-bit
integers without silent precision loss, decodes timestamp extensions, and previews embedded
binary data as bounded hexadecimal.

Decoding untrusted binary input inside a DevTools panel deserves the same paranoia as the message
bridge. The decoder enforces nesting-depth and element-count limits, and any corrupt or
truncated frame falls back to the raw Base64 and hexadecimal view instead of failing the panel.

Correctness has an external anchor: golden fixtures are generated by the official ASP.NET Core
SignalR MessagePack implementation, so the decoder is tested against what the real server
produces, not against my reading of the specification. Deterministic fuzz tests cover the frames
no server would ever send.

## The Transport Without a Socket: Long Polling

Long Polling is the transport the page-world instrumentation cannot see. There is no
`WebSocket` or `EventSource` constructor to wrap — only ordinary HTTP requests that happen to
carry a SignalR conversation.

Instead of wrapping `fetch` and `XMLHttpRequest` in the page (a far more invasive
instrumentation surface), the extension observes Long Polling through the read-only
`chrome.devtools.network` API [10]. It recognizes the `negotiate` exchange, then correlates the
subsequent GET polls, outgoing POST frames, and the final DELETE cleanup into one logical
connection — again without assuming anything about hub paths. Connection IDs, connection tokens,
and common access-token query parameters are redacted before any captured record leaves the
DevTools page.

The read-only choice has a visible consequence: the DevTools network API only observes while
DevTools is open. Capturing the negotiation therefore requires opening the panel before the
connection starts. That is a real constraint, and the documentation states it instead of hiding
it — a trade I would make again, because the alternative is instrumenting every HTTP request on
the page.

For most of this project, this section ended with a documented gap: outgoing HTTP posts used
with Server-Sent Events were not captured either. Closing that gap turned out to be a small
case study in the article's central argument, so it deserves its own section.

## The Other Half of Server-Sent Events

Server-Sent Events spent a long time in an odd middle state. The incoming half of the
conversation was easy: the page constructs an `EventSource`, the MAIN-world instrumentation
wraps it, and every hub message arriving on the stream is observed at its source. The outgoing
half was the documented limitation — an SSE client sends its invocations as ordinary HTTP
POSTs, exactly as Long Polling does [14], and no page-level constructor announces them.

The network observer described above was already watching those POSTs. The problem was
classification. Seen from outside the page, a sequence of SignalR POSTs against a negotiated
connection looks the same for Server-Sent Events and for Long Polling, and the difference is
not cosmetic: it decides the transport recorded on every captured message and lifecycle event,
and whether the observer's view must be merged with a page-world stream that is already
reporting the incoming half. Guessing from the URL or from timing would have been easy. It
would also have been the article's opening mistake in yet another costume.

The protocol supplies real evidence. A SignalR client does not send invocations until the
server's handshake response has arrived [1]. Over Long Polling, that response can only arrive
on a completed poll GET. So when the observer sees a repeated SignalR POST while zero polls
have completed, it holds a proof — not a hint — that the handshake response arrived through an
event stream, and the connection is classified as Server-Sent Events. A symmetric signal exists
at the end of the connection's life: a `text/event-stream` GET only finishes when the stream
itself ends, which yields the close event.

One connection is now seen from two observation points — incoming messages from the page world,
outgoing posts from the network observer — so the analysis layer merges the two views into a
single conversation. Flow pairing and the Insights statistics treat them as one connection,
which is what they are.

The limitations move rather than disappear. Like all network observation in this extension, the
outgoing half requires DevTools to be open before the connection starts. Page-level WebSocket and
incoming SSE traffic created inside iframes or Web Workers remains uncaptured; HTTP traffic may
still be visible through the DevTools network observer. Limitations belong in the README, not in
the gap between marketing and behavior.

## From Messages to Conversations

Decoding a message answers "what is this frame?" It does not answer the questions a developer
actually debugs with: did this call succeed, how long did it take, which error belongs to which
invocation, and why did the connection drop at 14:32?

The releases leading to 1.0 add an analysis layer on top of the decoded log. It runs entirely inside
the panel, mutates nothing, and treats the captured messages as evidence of conversations:

- Invocations are paired with their completions by connection, direction, and invocation ID. The
  table shows the outcome and the observed duration inline — `Completed · 240 ms`,
  `Error · 1.3 s` — with direct navigation between an invocation and its response.
- Stream items are grouped under their stream invocation as a collapsible group with an item
  count and observed delivery rate.
- A Timeline view reconstructs each connection's lifecycle: negotiation, transport open and
  close, handshake, keep-alive gaps, reconnects, transport fallback, and close reasons.
  Keep-alive pings are aggregated per connection with a count and median gap, so the timeline
  shows anomalies rather than two hundred rows of routine heartbeat.
- Stateful reconnect — the acknowledgement and sequence messages ASP.NET Core added for
  resumable connections — is visualized separately for inbound and outbound traffic.

![Following an invocation to its completion, grouping a stream, and opening the connection timeline](images/signalr-inspector-conversation.gif)

Building this produced a small echo of the article's opening lesson. The first version of the
correlation grouped messages into connections by endpoint and transport. That is the URL mistake
again, one level up: two components talking to the same hub from one page would merge into a
single imaginary connection. Meanwhile the page-world instrumentation knows the answer exactly —
it wraps each individual `WebSocket` and `EventSource` instance. So every wrapped connection now
carries a monotonic per-document sequence number, published with each message and validated at
the trust boundaries like every other field. Correlation became exact for WebSockets and
Server-Sent Events; Long Polling, observed from outside the page, keeps its heuristic
correlation through the negotiation exchange.

The general form of the lesson: derive identity where it is known for certain, not where it is
convenient to guess.

Correlation also raised a performance constraint. The analysis re-runs as traffic arrives, and a
completion can change the label of a row rendered minutes ago, which rules out naive append-only
rendering. The panel therefore coalesces bursts of traffic into one render per animation frame
and rebuilds only the view that is actually visible. A debugging tool that lags during streaming
would fail exactly when it is most needed.

This is, in the end, a fourth answer to the question the article started with. Inspecting
SignalR traffic does not mean showing frames, and not only decoding messages. It means restoring
the conversation: calls with their answers, streams with their items, connections with their
life stories.

## Evidence That Survives the Tab

The privacy model described above has a deliberate consequence: everything the extension captures
dies with the tab. For live debugging, that is a feature. For a bug report, it is a problem —
"attach what you saw" is not an instruction anyone can follow when what I saw lived in a bounded
in-memory log.

The releases leading to 1.0 add the missing artifact. The current log can be exported as a versioned
JSON session file and imported later — on a different day, or in a colleague's browser. The idea
is close in spirit to a HAR file [11]: a portable record of observed traffic, produced only on
explicit request.

Two design decisions did most of the work.

First, export is a boundary, and boundaries re-apply rules. The in-memory records were already
sanitized, so it would be easy to write them to disk as they are. But a file has a different
threat model than process memory: it gets attached to issues, shared in chats, archived. The
exporter therefore validates and rewrites every record against an explicit schema. Endpoints are
sanitized a second time. Transient row and tab identifiers never enter the format. The
browser-assigned document identifiers used for connection correlation are replaced with
session-local pseudonyms — `document-1`, `document-2` — which preserve the correlation without
preserving the browser's identifier. The file also inherits the 500-message live limit and
enforces separate bounds on retained text and serialized-file length.

An honest caveat belongs next to that: sanitization removes the extension's own identifiers and
known token parameters, not application data. The exported file preserves the captured payloads —
that is its purpose — and remains under the developer's judgment like any other debugging
artifact.

Second, import makes my own file format untrusted input. A session file claims to have been
produced by the exporter; nothing guarantees it. So an imported file receives the same paranoia
as messages arriving from the page world: it is parsed and validated in the panel, then validated
again in the service worker before it touches the log. The import is atomic — the log is either
replaced entirely or left untouched — imported records receive fresh identifiers assigned inside
the trusted boundary, and live capture simply continues on top of the restored session.

Even the mundane part had a lesson. The download uses a Blob URL, and revoking that URL
immediately after triggering the download races the browser's own download pipeline; the
revocation is deferred until the browser has started processing the download. Platform lifecycles
keep turning into explicit code.

This is a fifth answer to the question the article started with. Inspecting SignalR traffic also
means producing evidence that outlives the inspection: a conversation that can be handed to
someone else and replayed in their DevTools.

![Exporting, clearing, and restoring a SignalR debugging session](images/signalr-inspector-session-roundtrip.gif)

## From Observation to Judgment

Once the extension could show a conversation, the next question suggested itself: what should a
developer conclude from it? A table of decoded messages still leaves the reader doing statistics
in their head — how fast is this connection really, which hub method dominates, is that pause
normal.

The Insights view answers those questions from the same bounded log that feeds every other view.
It derives message and payload rates, captured volume, and the distribution of invocations per
hub method — locally, with no timers and no telemetry. The analysis recomputes only when new
data arrives, and "how long has this invocation been waiting" is measured against the last
observed message rather than the wall clock, so the same log always produces the same insights.
An imported session file yields identical numbers to the live capture it came from.

Deriving warnings from observed traffic required more restraint than deriving statistics. A
diagnostic tool that cries wolf trains its users to ignore it, so each of the four situations
that produce a warning is anchored to something the protocol or the server actually promises.
An outgoing payload approaching the server's default 32 KiB message-size limit is worth flagging because the default
is documented and commonly left unchanged [12]. A non-streaming invocation with no completion
after thirty seconds of subsequent traffic is evidence, not speculation. A stream cut off by a
closing connection is a fact of the log. And a keep-alive gap is reported as unusual
relative to the rhythm the connection itself has demonstrated — the baseline is the observed
median rather than a hard-coded ideal, with a conservative 30-second fallback threshold that
applies only until the connection has shown enough of a rhythm to measure.

The same release taught the detector a lesson about its own rules. Azure SignalR Service moves
connections with a standard negotiation redirect: the application's negotiate response points the
client at `*.service.signalr.net`, where the client negotiates again before opening its transport
[13]. Recognizing that host is, strictly speaking, a URL heuristic — the thing this article
argued against. The difference is that this URL is not a deployment choice; it is the documented
shape of a managed service, and the extension treats it as a documented exception rather than a
silent one. The redirect's access token is discarded before anything leaves the network observer;
only the sanitized service endpoint survives, as a badge on the connection and an event on the
timeline. Getting the correlation honest took two attempts: the repeated negotiation against the
service endpoint initially produced a phantom second connection, and merging it into the
redirected one — so a redirect, its follow-up negotiation, and the transport read as one
connection across reconnects — shipped as a follow-up fix.

The honest limitations: custom domains in front of Azure SignalR are not recognized, because the
documented hostname is the only protocol evidence available. Redirect detection also depends on
DevTools being open before negotiation happens — the network observer cannot see a request that
completed before it existed. And the warnings are conservative by construction; a server with a
raised message-size limit will see a warning that its operator knows to be soft.

![Local traffic statistics and protocol warnings in the Insights view](images/signalr-inspector-insights.png)

## The Details That Turn a Prototype into a Tool

The protocol parser was only one part of preparing the extension for public use.

Internal tools inherit context from their authors. Open-source tools have to make that context
explicit.

Several apparently small issues became release-level concerns.

### Message order

Text payloads can be serialized synchronously. Blob payloads require asynchronous conversion.
Without a per-connection serialization queue, a later small message may appear before an earlier
large Blob.

A debugging tool that changes observed ordering damages the evidence it is supposed to preserve.

### Memory limits

A ring buffer limits the number of messages, but one message can still be enormous. The extension
therefore keeps metadata and a preview while omitting payload bodies above 256 KiB. It also caps
the aggregate amount of retained payload text per tab.

Bound the number of objects and the size of each object. Doing only one is not a memory policy.

### IDs

The page originally generated message identifiers. Besides creating duplicates across frames and
reloads, this allowed untrusted code to influence selection state in the panel.

Identifiers are now assigned in the service worker, inside the trusted extension boundary.

### Permissions

The original manifest requested `scripting`, `activeTab`, and `storage`, although the extension did
not use them.

Permissions are not a roadmap. A permission without a current call site is not preparation for a
future feature; it is present-day access without present-day value.

So the first release-preparation step removed the unused permissions. The second step went
further and removed the broad host access itself. Observing SignalR applications on arbitrary
sites does not require standing access to every site — it requires access to the one tab the
developer is currently debugging. The current manifest requests only `activeTab` and `scripting`,
both with real call sites: the toolbar click grants temporary access to the active tab, and the
`scripting` API registers the instrumentation for exactly that host. The same permissions that
were once dead weight came back as the core of the activation model.

### Licensing

The package metadata declared MIT while the license file prohibited redistribution and
modification.

Code can compile with contradictory licensing. An open-source project cannot.

The release work therefore included making the manifest, package metadata, README, privacy
notice, and license describe one coherent product.

## Testing the Whole Path, Not Only the Parser

Unit tests are valuable here. Protocol parsing, SignalR detection, the manifest contract, and the
message boundary are good candidates for fast deterministic tests.

But an extension can pass every unit test and still fail because:

- its MAIN-world script runs too late,
- Chrome did not register the content script before navigation,
- a service worker port connects to the wrong tab,
- an extension page cannot reach the expected state,
- a screenshot generator captures an attractive but fake UI.

So the release process gained a browser E2E suite that runs the complete system:

1. Start a real .NET 10 application.
2. Load the unpacked extension into Chrome.
3. Wait for the extension service worker.
4. Reload the page after extension registration.
5. Assert that MAIN-world instrumentation is installed.
6. Negotiate a real SignalR connection.
7. Invoke the `SendMessage` hub method several times.
8. Connect the real panel UI to the inspected tab.
9. Assert that captured traffic reached the table.

This last point is important. A screenshot can be an attractive mock-up or evidence from a running
system. I wanted the second.

The sample application earns its place in this loop. It exposes four explicit scenario buttons —
WebSockets with JSON, Long Polling with JSON, Server-Sent Events with JSON, and MessagePack over
WebSockets — so every supported transport-and-encoding pair can be exercised deliberately, both
by a human clicking through the demo and by the E2E harness. The SSE scenario is served by a
hand-rolled, protocol-faithful EventSource transport in the sample rather than the official
client, precisely so the demo exercises the same wire shapes a real deployment produces.

Separately, the checked-in deterministic asset generator opens the shipped panel, sends fixed
fictional records through its normal port handler, asserts the states it is about to capture, and
produces:

- four 1280×800 product screenshots, including the Insights view,
- one 1280×800 README GIF.

The 440×280 small promotional tile and 1400×560 marquee image are maintained as separate store
assets.

These dimensions map directly to the screenshot and promotional-image slots documented for the
Chrome Web Store [7].

The E2E suite began as a local release check and became exactly what a release check should
become: a maintained Playwright job in CI that every tagged release must pass. It builds a
temporary copy of the extension from the same file allowlist as the store package, drives live
JSON, MessagePack, and Server-Sent Events traffic through the real .NET sample, and asserts the
invocation flow, Insights, stream grouping, and the export–clear–import round trip against the
real panel code.

Two honest asymmetries remain between the suite and a human. Headless Chromium cannot click a
toolbar icon, so the test copy of the manifest receives a host permission scoped to `127.0.0.1`
and activates the tab programmatically — the shipped manifest keeps no host permissions at all,
and a unit test asserts that the mutation never leaks into it. And Playwright cannot open a real
DevTools panel, so the suite loads the panel page directly against the inspected tab; that also
means the network observer — Long Polling and the outgoing half of Server-Sent Events — cannot
run under Playwright at all, and stays covered by unit tests against recorded request shapes.
The DevTools registration itself, like the toolbar gesture, remains part of a manual smoke test
in branded Chrome and Edge before each store submission.

## Similar Tools and the Actual Differentiator

There are several good WebSocket inspection extensions for Chrome. Wirepeek can capture and decode
page-level WebSocket traffic, including nested JSON used by SignalR [5]. Socket Inspector adds
traffic filtering, message simulation, and disconnect testing [6]. These are useful tools, and
their broader WebSocket scope is a strength.

Competing with them on “we also show frames” would not be a meaningful product strategy.

The useful distinction is protocol awareness.

SignalR Inspector should answer questions expressed in the developer’s language:

- Which hub method was invoked?
- What arguments were sent?
- Was the invocation completed?
- Which error belongs to which invocation ID?
- Is this frame a ping, close, stream item, or application message?
- Which transport and endpoint carry the conversation?

These are no longer aspirations. The Flow column and the Timeline view answer them directly:
completion status and duration sit next to each invocation, and the connection's life story is a
view of its own.

This is a familiar pattern in developer tooling. The most useful debugger is rarely the one that
shows the largest amount of raw data. It is the one that restores the abstractions we use when
reasoning about the system.

## What Does This Change in Practice?

The extension changes the debugging loop in five ways.

First, it reduces translation work. The developer sees hub methods and protocol concepts instead
of repeatedly decoding numeric message types.

Second, it separates SignalR traffic from unrelated WebSocket noise without relying on deployment-
specific URLs.

Third, it answers correlation questions directly — which completion belongs to which invocation,
how long the call took, why the connection ended — instead of leaving the developer to trace
invocation IDs across hundreds of rows by hand.

Fourth, it makes the evidence portable. A captured session can be exported to a bounded,
sanitized JSON file and imported later, which turns "it happened on my machine" into an artifact
a teammate can open in their own DevTools.

Fifth, it turns a private debugging trick into a repeatable tool: documented permissions,
bounded memory, an explicit privacy model, verified product screenshots, tests, CI/CD, a packaged
release, and a sample application.

And this leads to the most important lesson I took from returning to this repository.

The distance between an internal prototype and an open-source tool is not measured mainly in lines
of code. It is measured in how much hidden context has been converted into architecture.

The prototype knew that `/grpc` meant “the connection I care about” because I knew the
application. The tool has to recognize SignalR.

The prototype could keep arbitrary messages because I controlled the environment. The tool needs
trust boundaries and limits.

The prototype needed only to work once. The tool needs to explain itself, test itself, package
itself, and produce evidence that what appears in the README came from what actually ran in
Chrome.

This is why developer tooling is such an interesting architectural exercise. We are not only
observing a system. We are designing a second system that decides what the first one means.

The source, sample application, tests, and packaged
[SignalR Inspector 1.0.0 release](https://github.com/jakubgrzywaczewski/signalr-devtools/releases/tag/v1.0.0)
are available in the [repository](https://github.com/jakubgrzywaczewski/signalr-devtools) [8].
The extension installs directly from the
[Chrome Web Store](https://chromewebstore.google.com/detail/signalr-inspector/lgaffhilcepfgfiealbdadfedpdfnfla)
and
[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/signalr-inspector/hlohgfgkniolajoidmnmahelkejeimnh).

### Bibliography

- [1] .NET / ASP.NET Core, *SignalR Hub Protocol*. Available at:
  [github.com/dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/HubProtocol.md)
  (accessed 27 July 2026).
- [2] Chrome for Developers, *Content scripts*. Available at:
  [developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
  (accessed 27 July 2026).
- [3] Chrome for Developers, *The extension service worker lifecycle*. Available at:
  [developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
  (accessed 27 July 2026).
- [4] Mozilla, *Inspecting web sockets*. Available at:
  [firefox-source-docs.mozilla.org](https://firefox-source-docs.mozilla.org/devtools-user/network_monitor/inspecting_web_sockets/)
  (accessed 27 July 2026).
- [5] Chrome Web Store, *Wirepeek*. Available at:
  [chromewebstore.google.com](https://chromewebstore.google.com/detail/wirepeek/ojoojkjcpibfddgcljlfbjobkcpcbejn)
  (accessed 27 July 2026).
- [6] Chrome Web Store, *Socket Inspector — WebSocket Debugging Tools*. Available at:
  [chromewebstore.google.com](https://chromewebstore.google.com/detail/socket-inspector-websocke/kecipkncnnofappfmapgmfailmnbaoaf)
  (accessed 27 July 2026).
- [7] Chrome for Developers, *Supplying Images*. Available at:
  [developer.chrome.com](https://developer.chrome.com/docs/webstore/images)
  (accessed 27 July 2026).
- [8] Jakub Grzywaczewski, *SignalR Inspector source code and releases*. Available at:
  [github.com/jakubgrzywaczewski/signalr-devtools](https://github.com/jakubgrzywaczewski/signalr-devtools)
  (accessed 27 July 2026).
- [9] Microsoft Learn, *Use MessagePack Hub Protocol in SignalR for ASP.NET Core*. Available at:
  [learn.microsoft.com](https://learn.microsoft.com/aspnet/core/signalr/messagepackhubprotocol)
  (accessed 31 July 2026).
- [10] Chrome for Developers, *chrome.devtools.network*. Available at:
  [developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)
  (accessed 31 July 2026).
- [11] Jan Odvárko, *HAR 1.2 Spec*. Available at:
  [softwareishard.com](http://www.softwareishard.com/blog/har-12-spec/)
  (accessed 3 August 2026).
- [12] Microsoft Learn, *ASP.NET Core SignalR configuration* (`MaximumReceiveMessageSize`).
  Available at:
  [learn.microsoft.com](https://learn.microsoft.com/aspnet/core/signalr/configuration)
  (accessed 7 August 2026).
- [13] Microsoft Learn, *Azure SignalR Service internals*. Available at:
  [learn.microsoft.com](https://learn.microsoft.com/azure/azure-signalr/signalr-concept-internals)
  (accessed 7 August 2026).
- [14] .NET / ASP.NET Core, *SignalR Transport Protocols*. Available at:
  [github.com/dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/TransportProtocols.md)
  (accessed 8 August 2026).
