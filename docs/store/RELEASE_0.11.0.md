# SignalR Inspector 0.11.0 release handoff

This file is the source of truth for the GitHub release and manual browser-store submissions.

## Release identity

- Version: `0.11.0`
- Expected tag: `v0.11.0`
- Release title: `SignalR Inspector 0.11.0`
- Package: `dist/signalr-inspector.zip`
- Package SHA-256: `e0a02fc6efabd60bb8a8773cc708d356df9f2bb4ef773cb32a384de1542c25d7`
- Chrome listing kit: [`CHROME_WEB_STORE.md`](CHROME_WEB_STORE.md)
- Edge listing kit: [`MICROSOFT_EDGE_ADDONS.md`](MICROSOFT_EDGE_ADDONS.md)

## GitHub release notes

```text
SignalR Inspector 0.11.0 turns bounded live traces into portable, locally controlled debugging sessions.

Highlights

- Export the current bounded SignalR log to a versioned JSON session for bug reports, offline review, and reproducible debugging.
- Import a previously exported session after local validation and atomically restore its Messages and Timeline views.
- Validate the file in both the DevTools panel and service worker, with the existing 500-message and 10 MiB captured-text limits plus a 64 MiB file cap.
- Remove transient tab and row IDs, re-sanitize endpoint tokens, and assign fresh trusted tab, row, and document identifiers during import.
- Continue bounded live capture after an import without adding permissions, telemetry, remote services, synchronization, or automatic persistence.

Exported files preserve captured application payloads and remain under the developer's control. Treat them like the inspected application's own debug logs.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

## Publication checklist

1. Confirm the release commit is on `main` and the public privacy URLs describe explicit local
   session export/import.
2. Confirm `package.json`, `package-lock.json`, and `manifest.json` all report `0.11.0`.
3. Confirm `npm run check`, `npm test`, `npm run test:coverage`, `npm audit --audit-level=high`,
   both .NET Release builds, manifest validation, store asset validation, demo generation, and
   browser smoke checks pass.
4. Confirm the ZIP SHA-256 matches the value above and the archive contains `sessionFormat.js` at
   its root with no tests, `node_modules`, nested ZIPs, generator scripts, or local notes.
5. Exercise export, clear, and import with JSON and MessagePack traffic; confirm imported rows,
   flows, and Timeline events match the original session.
6. Create signed tag `v0.11.0` from the verified commit and push it only when publication is
   authorized. Confirm CI publishes the same ZIP to the GitHub release.
7. Upload the ZIP and listing fields from `CHROME_WEB_STORE.md` to Chrome Web Store, then submit it
   for review.
8. Upload the same ZIP plus the listing, Privacy page, and certification notes from
   `MICROSOFT_EDGE_ADDONS.md` to Microsoft Edge Partner Center, then submit it for certification.
9. After approval, verify the public version, screenshots, description, privacy URL, website, and
   support URL in both marketplaces.
