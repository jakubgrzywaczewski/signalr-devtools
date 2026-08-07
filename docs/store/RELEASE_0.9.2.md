# SignalR Inspector 0.9.2 release handoff

> Superseded — this version was never tagged or published. The first public release is v0.11.1;
> store submissions use the newest `RELEASE_*.md`. Kept for the historical record only.

This file is the source of truth for the GitHub release and manual browser-store submissions.

## Release identity

- Version: `0.9.2`
- Expected tag: `v0.9.2`
- Release title: `SignalR Inspector 0.9.2`
- Package: `dist/signalr-inspector.zip`
- Package SHA-256: `1f9ef1a94c7bc2c9e38d774f869ddda4c99eb7c15072458ecb0bce0513b4b3d8`
- Chrome listing kit: [`CHROME_WEB_STORE.md`](CHROME_WEB_STORE.md)
- Edge listing kit: [`MICROSOFT_EDGE_ADDONS.md`](MICROSOFT_EDGE_ADDONS.md)

## GitHub release notes

```text
SignalR Inspector 0.9.2 completes the 0.9 release line with store-ready metadata and the reliability improvements from 0.9.1.

Highlights

- Pair SignalR invocations with completions, errors, cancellations, and observed duration.
- Group streaming results with item counts, delivery rates, and collapse controls.
- Follow negotiation, transports, handshake, keep-alives, reconnects, closes, Ack, and Sequence messages on a connection timeline.
- Decode JSON and MessagePack traffic over WebSockets, incoming Server-Sent Events, and incoming/outgoing Long Polling.
- Keep simultaneous connections separate and navigate reliably to related messages even when filters or collapsed groups hide them.
- Batch live panel rendering and aggregate keep-alive pings for clearer high-traffic diagnostics.

Release preparation

- Updated the browser-neutral manifest summary.
- Added complete Chrome Web Store and Microsoft Edge Add-ons listing, privacy, permission, certification, and asset-upload instructions.
- No new permissions, host access, remote code, analytics, telemetry, persistence, or external data transmission.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

## Publication checklist

1. Confirm the release commit is on `main` and the public privacy URLs resolve.
2. Confirm `package.json`, `package-lock.json`, and `manifest.json` all report `0.9.2`.
3. Confirm `npm run check`, `npm test`, `npm run test:coverage`, `npm audit --audit-level=high`,
   the .NET Release builds, store asset validation, and browser E2E checks pass.
4. Confirm the ZIP contains `manifest.json` at its root and no tests, `node_modules`, nested ZIPs,
   source-only configuration, or local notes.
5. Create signed tag `v0.9.2` from the verified commit and push it only when publication is
   authorized. Confirm CI publishes the same ZIP to the GitHub release.
6. In Chrome Web Store, upload the ZIP and replace the listing fields using
   `CHROME_WEB_STORE.md`. Submit for review.
7. In Microsoft Edge Partner Center, upload the same ZIP and replace the listing, Privacy page,
   and Notes for certification using `MICROSOFT_EDGE_ADDONS.md`. Submit for certification.
8. After approval, verify the public version, screenshots, description, privacy URL, website, and
   support URL in both marketplaces.
