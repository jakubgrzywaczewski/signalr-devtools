# Chrome Web Store — dashboard field map (0.12.3)

This file maps every Chrome Web Store dashboard field to the exact value it should contain.
Dashboard: <https://chrome.google.com/webstore/devconsole> → your item (or **+ New item** for the
first submission). Sections below follow the dashboard's left-hand tabs; headings name the field
as the dashboard labels it. Paste only the content inside code blocks. Fields not listed here
stay empty or at their defaults.

Package to upload everywhere: `dist/signalr-inspector.zip`, version `0.12.3`, free, English.

---

## Tab: Package

**Action:** upload `dist/signalr-inspector.zip`.

The following listing values come from `manifest.json` inside the ZIP and are shown read-only —
there is nothing to paste for them:

- **Item title:** `SignalR Inspector`
- **Summary from package** (under Chrome's 132-character limit):
  `Inspect ASP.NET Core SignalR messages, invocation flows, and connection timelines in DevTools.`

---

## Tab: Store listing

### Field: Description

```text
Debugging SignalR in a busy network log means decoding protocol frames by hand and matching requests across transports. SignalR Inspector adds a focused panel to Chrome DevTools that turns ASP.NET Core SignalR traffic into readable messages, invocation flows, stream groups, and a connection timeline.

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

1. Open Chrome DevTools on the application you want to inspect and select SignalR Inspector. Opening DevTools starts passive Long Polling observation for that tab.
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

### Field: Category

Select: `Developer Tools`

### Field: Language

Select: `English`

### Field: Store icon

Included in the package as `icons/icon128.png` (128×128). If the dashboard asks for a separate
upload, use `signalr-inspector/icons/icon128.png` from the repository.

### Field: Global promo video

Leave empty.

### Field: Screenshots

Upload in this order (all 1280×800):

1. `docs/images/signalr-inspector-live.png`
2. `docs/images/signalr-inspector-timeline.png`
3. `docs/images/signalr-inspector-filtering.png`
4. `docs/images/signalr-inspector-insights.png`

### Field: Small promo tile (440×280)

Upload: `docs/images/chrome-web-store-small-promo.png`

### Field: Marquee promo tile (1400×560)

Upload: `docs/images/chrome-web-store-marquee.png`

### Field: Homepage URL

```text
https://github.com/jakubgrzywaczewski/signalr-devtools
```

### Field: Support URL

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/issues
```

### Field: Mature content

Select: `No`

---

## Tab: Privacy

### Field: Single purpose description

```text
Provide a Chrome DevTools panel that locally captures, decodes, filters, correlates, and explicitly exports or imports ASP.NET Core SignalR traffic for the developer inspecting the active tab.
```

### Field: Permission justification — activeTab

```text
SignalR Inspector uses activeTab only after the developer clicks its toolbar icon. The temporary grant lets the extension activate SignalR WebSocket and Server-Sent Events instrumentation for the current HTTP or HTTPS tab and reload that tab so the initial handshake can be observed. The grant does not provide persistent access to every website.
```

### Field: Permission justification — scripting

```text
SignalR Inspector uses scripting to dynamically register its packaged isolated-world bridge and MAIN-world SignalR instrumentation for the explicitly activated tab. The scripts observe SignalR WebSocket and Server-Sent Events traffic and are removed when inspection is disabled. No code is downloaded or executed remotely.
```

### Field: Are you using remote code?

Select:

```text
No, I am not using remote code.
```

The remote-code justification field then stays empty.

### Checkboxes: What user data do you plan to collect?

Check exactly these:

- `Website content` — SignalR payloads and response bodies are inspected locally.
- `Web history` **or** `Web browsing activity` (whichever label the dashboard presents) — SignalR
  endpoint URLs are processed locally before sensitive query parameters are removed.
- `Personal communications` — application-defined SignalR payloads can contain chat or
  collaboration messages.
- `Authentication information` — connection and access-token parameters can be encountered
  transiently while URLs are sanitized, even though they are not retained or shown.

Leave unchecked: unrelated categories such as health, financial, location, or form data — unless
the dashboard instructs publishers to disclose every possible value an inspected application
could place inside an arbitrary payload. Do not claim that no user data is handled merely because
all processing is local.

### Checkboxes: Certifications / disclosures

Check all limited-use certifications whose text states that data is not sold, is used only for
the extension's single purpose, is not used for advertising, and is not used for credit or
lending decisions. Those statements match the shipped behavior.

### Field: Privacy policy URL

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/docs/store/CHROME_PRIVACY.md
```

---

## Tab: Distribution

- **Field: Payments** → `Free`
- **Field: Visibility** → `Public`
- **Field: Distribution regions** → select all supported regions
