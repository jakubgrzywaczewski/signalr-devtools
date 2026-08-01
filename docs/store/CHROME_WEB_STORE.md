# Chrome Web Store release kit — 0.11.0

Use the values below for the English Chrome Web Store listing. Copy only the content inside each
code block into the matching dashboard field.

## Package

- ZIP: `dist/signalr-inspector.zip`
- Version: `0.11.0`
- Category: `Developer Tools`
- Language: `English`
- Pricing: `Free`

## Item title

The title comes from `manifest.json`.

```text
SignalR Inspector
```

## Summary

The summary comes from `manifest.json` and is under Chrome's 132-character limit.

```text
Inspect ASP.NET Core SignalR messages, invocation flows, and connection timelines in DevTools.
```

## Detailed description

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

What's new in 0.11.0:

• Added versioned JSON export for the current bounded SignalR trace.
• Added locally validated, atomic session import for offline review and reproducible bug reports.
• Removed transient tab and row IDs from files, re-sanitized endpoint tokens, and assigned fresh local identities during import.
• Kept permissions unchanged and added no telemetry, remote services, synchronization, or automatic persistence.

Source and full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools
```

## Store URLs

Website:

```text
https://github.com/jakubgrzywaczewski/signalr-devtools
```

Support URL:

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/issues
```

Privacy policy URL:

```text
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/docs/store/CHROME_PRIVACY.md
```

## Privacy practices

Single purpose description:

```text
Provide a Chrome DevTools panel that locally captures, decodes, filters, correlates, and explicitly exports or imports ASP.NET Core SignalR traffic for the developer inspecting the active tab.
```

`activeTab` justification:

```text
SignalR Inspector uses activeTab only after the developer clicks its toolbar icon. The temporary grant lets the extension activate SignalR WebSocket and Server-Sent Events instrumentation for the current HTTP or HTTPS tab and reload that tab so the initial handshake can be observed. The grant does not provide persistent access to every website.
```

`scripting` justification:

```text
SignalR Inspector uses scripting to dynamically register its packaged isolated-world bridge and MAIN-world SignalR instrumentation for the explicitly activated tab. The scripts observe SignalR WebSocket and Server-Sent Events traffic and are removed when inspection is disabled. No code is downloaded or executed remotely.
```

Remote code:

```text
No, I am not using remote code.
```

Data usage selections:

- Select `Website content` because SignalR payloads and response bodies are inspected locally.
- Select `Web history` or `Web browsing activity`, whichever label the dashboard presents, because
  SignalR endpoint URLs are processed locally before sensitive query parameters are removed.
- Select `Personal communications` because application-defined SignalR payloads can contain chat
  or collaboration messages.
- Select `Authentication information` because connection and access-token parameters can be
  encountered transiently while URLs are sanitized, even though they are not retained or shown.
- Do not select unrelated categories such as health, financial, location, or form data unless the
  dashboard instructs publishers to disclose every possible value an inspected application could
  place inside an arbitrary payload.
- Select all limited-use certifications whose text states that data is not sold, is used only for
  the extension's single purpose, is not used for advertising, and is not used for credit or
  lending decisions. Those statements match the shipped behavior.
- Do not claim that no user data is handled merely because all processing is local.

## Visual assets

Upload in this order:

1. `docs/images/signalr-inspector-live.png` — 1280×800
2. `docs/images/signalr-inspector-timeline.png` — 1280×800
3. `docs/images/signalr-inspector-filtering.png` — 1280×800

Promotional images:

- Small promo: `docs/images/chrome-web-store-small-promo.png` — 440×280
- Marquee: `docs/images/chrome-web-store-marquee.png` — 1400×560

The 128×128 store icon is included in the package at `icons/icon128.png`.

## Distribution

- Visibility: `Public`
- Regions: all supported regions
- Mature content: `No`
