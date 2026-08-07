# Microsoft Edge Add-ons — Partner Center field map (0.12.3)

This file maps every Microsoft Edge Partner Center field to the exact value it should contain.
Partner Center: <https://partner.microsoft.com/dashboard> → **Microsoft Edge** program → your
extension (or **Create new extension** for the first submission). Sections below follow the
pages in the submission's left-hand navigation; headings name the field as Partner Center labels
it. Paste only the content inside code blocks. Fields not listed here stay empty or at their
defaults. Partner Center occasionally renames fields — when a label differs slightly, match by
meaning; when a privacy question has no dedicated field, its answer is already covered by the
Notes for certification block on the Submit page.

Package to upload: `dist/signalr-inspector.zip`, version `0.12.3`, free,
English (United States).

---

## Page: Packages

**Action:** upload `dist/signalr-inspector.zip`.

The following values come from `manifest.json` inside the ZIP and are shown read-only — there is
nothing to paste for them (changing them requires uploading a new package):

- **Extension name:** `SignalR Inspector`
- **Short description:**
  `Inspect ASP.NET Core SignalR messages, invocation flows, and connection timelines in DevTools.`

---

## Page: Availability

- **Field: Visibility** → `Public`
- **Field: Markets** → select all supported markets

---

## Page: Properties

### Field: Category

Select: `Developer tools`

### Field: Privacy policy URL

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/docs/store/EDGE_PRIVACY.md
```

Note: this is the Edge-specific policy — do not paste the Chrome policy URL here.

### Field: Website

```text
https://github.com/jakubgrzywaczewski/signalr-devtools
```

### Field: Support contact details / Support URL

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/issues
```

### Field: Mature content

Select: `No`

### Field: Third-party content

Answer `Yes` only if Partner Center treats decoded application traffic or the independent
references to ASP.NET Core SignalR as third-party content; otherwise use the answer already
accepted for the existing listing.

### Privacy declarations (labels vary by Partner Center revision)

**Single purpose description:**

```text
Provide a Microsoft Edge DevTools panel that locally captures, decodes, filters, correlates, and explicitly exports or imports ASP.NET Core SignalR traffic for the developer inspecting the active tab.
```

**Permission justification — activeTab:**

```text
SignalR Inspector uses activeTab only after the developer clicks its toolbar icon. The temporary grant lets the extension activate SignalR WebSocket and Server-Sent Events instrumentation for the current HTTP or HTTPS tab and reload that tab so the initial handshake can be observed. The grant does not provide persistent access to every website.
```

**Permission justification — scripting:**

```text
SignalR Inspector uses scripting to dynamically register its packaged isolated-world bridge and MAIN-world SignalR instrumentation for the explicitly activated tab. The scripts observe SignalR WebSocket and Server-Sent Events traffic and are removed when inspection is disabled. No code is downloaded or executed remotely.
```

**Are you using remote code?**

```text
No, I am not using remote code.
```

**Data usage selections** — check exactly these:

- `Website content` — SignalR payloads and response bodies are inspected locally.
- `Web history` **or** `Web browsing activity` (whichever label Partner Center presents) —
  SignalR endpoint URLs are processed locally before sensitive query parameters are removed.
- `Personal communications` — application-defined SignalR payloads can contain chat or
  collaboration messages.
- `Authentication information` — connection and access-token parameters can be encountered
  transiently while URLs are sanitized, even though they are not retained or shown.

Leave unchecked: unrelated categories such as health, financial, location, or form data — unless
Partner Center instructs publishers to disclose every possible value an inspected application
could place inside an arbitrary payload. Check all limited-use certifications whose text states
that data is not sold, is used only for the extension's single purpose, is not used for
advertising, and is not used for credit or lending decisions. Do not claim that no user data is
handled merely because all processing is local.

---

## Page: Store listings → English (United States)

### Field: Description

```text
Debugging SignalR in a busy network log means decoding protocol frames by hand and matching requests across transports. SignalR Inspector adds a focused panel to Microsoft Edge DevTools that turns ASP.NET Core SignalR traffic into readable messages, invocation flows, stream groups, and a connection timeline.

Use SignalR Inspector to:

• Detect SignalR from the protocol handshake without assuming a hub URL.
• Inspect formatted JSON and MessagePack Hub Protocol messages.
• See WebSocket traffic, incoming Server-Sent Events, and incoming and outgoing HTTP Long Polling messages.
• Pair invocations with completions, errors, cancellations, and observed duration.
• Group stream items with item counts, delivery rates, and collapse controls.
• Follow negotiation, transport changes, handshake state, keep-alives, reconnects, closes, acknowledgements, and sequences on a timeline.
• Filter by endpoint, payload, direction, SignalR message type, and transport.
• Keep routine protocol pings out of the Messages view by default and reveal them on demand.
• Navigate directly between related messages, including filtered rows and collapsed stream groups.
• Export a bounded trace to a versioned JSON file and import it later for offline review or a reproducible bug report.

How to use it:

1. Open Microsoft Edge DevTools on the application you want to inspect and select SignalR Inspector. Opening DevTools starts passive Long Polling observation for that tab.
2. Click the SignalR Inspector toolbar icon to enable WebSocket and Server-Sent Events instrumentation for the current tab. The page reloads so the connection handshake can be captured from the beginning.
3. Use the application normally, then inspect messages in the Messages and Timeline views.

Privacy and permissions:

Captured traffic stays in a bounded, per-tab in-memory log unless the developer explicitly exports it to a local JSON file. SignalR Inspector has no analytics, advertising, telemetry, remote services, data synchronization, or remotely hosted code. It does not sell or transmit captured data. Connection IDs, connection tokens, and common access-token parameters are removed from displayed and exported endpoints. Payload bodies larger than 256 KiB are not retained. Exported files preserve application payloads and remain under the developer's control.

The activeTab permission grants temporary access only after the toolbar icon is clicked. The scripting permission installs the extension's packaged instrumentation in that activated tab. SignalR Inspector declares no host permissions and does not request access to every website.

Current limitations:

• Outgoing Server-Sent Events HTTP posts are not captured.
• WebSocket and Server-Sent Events traffic created inside iframes or Web Workers is not captured.
• Non-SignalR binary payloads and malformed or incomplete MessagePack frames fall back to Base64 and hex previews.
• Page code can detect or bypass page-level instrumentation, so this is a diagnostics tool rather than a security monitor.

SignalR Inspector is an independent, open-source developer tool and is not affiliated with or endorsed by Microsoft.

What's new in 0.12.3:

• Added an Insights view with live message and payload rates, captured volume, Azure SignalR connection counts, and hub-method distribution.
• Added focused warnings for large outbound payloads, stale invocations, interrupted streams, and unusual keep-alive gaps.
• Detect Azure SignalR Service negotiation redirects, remove returned access tokens, and show the sanitized service endpoint.
• Fixed Azure SignalR connection correlation so a full service redirect, repeated negotiation, and transport sequence maps to a single connection across reconnects.
• Added browser end-to-end coverage for live JSON and MessagePack traffic, invocation flows, Insights, and session export/import.
• Kept permissions unchanged and added no telemetry, remote services, synchronization, or automatic persistence.

Source and full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools
```

### Field: Search terms

Enter as seven separate terms:

```text
SignalR
ASP.NET Core
DevTools
WebSocket
MessagePack
Long Polling
SSE
```

### Field: Store logo / Extension logo

Upload: `signalr-inspector/icons/icon128.png` (128×128)

### Field: Screenshots

Upload in this order (all 1280×800):

1. `docs/images/signalr-inspector-live.png`
2. `docs/images/signalr-inspector-timeline.png`
3. `docs/images/signalr-inspector-filtering.png`
4. `docs/images/signalr-inspector-insights.png`

### Field: Small promotional tile (440×280)

Upload: `docs/images/chrome-web-store-small-promo.png`

### Field: Large promotional tile (1400×560)

Upload: `docs/images/chrome-web-store-marquee.png`

### Field: YouTube video URL

Leave empty.

---

## Page: Submit

### Field: Notes for certification

```text
SignalR Inspector 0.12.3 adds a local Insights view derived from the existing bounded in-memory trace. It reports message and payload rates, captured volume, Azure SignalR connection counts, and hub-method distribution; warns about large outbound payloads, stale invocations, interrupted streams, and unusual keep-alive gaps; and identifies standard Azure SignalR Service negotiation redirects after removing returned access tokens. This release also adds automated browser coverage for live JSON and MessagePack traffic, invocation flows, Insights, and session export/import, and fixes Azure SignalR connection correlation for the full redirect sequence. No permissions, telemetry, remote services, synchronization, or automatic persistence were added.

No login or test account is required.

Test steps:
1. Clone https://github.com/jakubgrzywaczewski/signalr-devtools and run `dotnet run --project samples/SignalR.Sample` with the .NET 10 SDK.
2. Open the sample URL in Microsoft Edge, open DevTools, and select SignalR Inspector. Keeping DevTools open before starting a scenario allows passive Long Polling negotiation and HTTP messages to be captured.
3. Click the SignalR Inspector toolbar icon. The extension activates instrumentation for the current tab and reloads the page.
4. Select WebSockets (JSON), send a message, and verify that the Messages view shows the invocation and completion linked in the Flow column with an observed duration.
5. Select Run 3-item stream and verify one Stream invocation, three grouped Stream item rows, and a Completion.
6. Select Drop and reconnect, open Timeline, and verify the closed transport and replacement connection.
7. Verify that pings are hidden by default, then enable Show pings. Exercise the direction, message-type, and transport filters.
8. Select Long Polling (JSON), send a message, and verify incoming and outgoing Long Polling messages.
9. Select MessagePack (WebSockets), send a message, and verify the selected binary SignalR frame is decoded to readable fields while its original Base64 remains available.
10. Select Export session and verify that Edge downloads a JSON file named `signalr-inspector-session-*.json`.
11. Clear the log, select Import session, choose that JSON file, and verify that the messages and Timeline are restored.
12. Open Insights and verify that traffic rates and the hub-method distribution reflect the captured scenarios. The Azure SignalR badge appears only when a standard service redirect is observed.
13. Click the toolbar icon again to disable page instrumentation.

The extension requests only activeTab and scripting. It declares no host permissions and uses no remote code, analytics, advertising, telemetry, synchronization, or external data transmission. Captured traffic remains in a bounded per-tab memory log unless the developer explicitly exports it to a local file.
```
