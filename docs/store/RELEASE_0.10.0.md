# SignalR Inspector 0.10.0 release handoff

This file is the source of truth for the GitHub release and manual browser-store submissions.

## Release identity

- Version: `0.10.0`
- Expected tag: `v0.10.0`
- Release title: `SignalR Inspector 0.10.0`
- Package: `dist/signalr-inspector.zip`
- Package SHA-256: `73c472371faf2949de3a63de44cf012b7b8912486428d38a64dc98a1b692cb4a`
- Chrome listing kit: [`CHROME_WEB_STORE.md`](CHROME_WEB_STORE.md)
- Edge listing kit: [`MICROSOFT_EDGE_ADDONS.md`](MICROSOFT_EDGE_ADDONS.md)

## GitHub release notes

```text
SignalR Inspector 0.10.0 makes busy SignalR traces easier to demonstrate and navigate before the public browser-store launch.

Highlights

- Filter Messages by direction, SignalR message type, and transport alongside endpoint and payload search.
- Keep routine protocol pings hidden by default while preserving them for optional inspection and Timeline analysis.
- Exercise real StreamInvocation, StreamItem, and Completion traffic from the included .NET sample.
- Drop and replace the sample transport to demonstrate an ordinary reconnect in Timeline.
- Reproduce the README GIF and three 1280×800 store screenshots with a checked-in browser-driven generator and fixed fictional data.
- Install the current build from a prominent README section for Chrome or Edge; public store links remain intentionally absent until valid listing URLs exist.

No new permissions, host access, remote code, analytics, telemetry, persistence, or external data transmission were added.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

## Publication checklist

1. Confirm the release commit is on `main` and the public privacy URLs resolve.
2. Confirm `package.json`, `package-lock.json`, and `manifest.json` all report `0.10.0`.
3. Confirm `npm run check`, `npm test`, `npm run test:coverage`, `npm audit --audit-level=high`,
   both .NET Release builds, manifest validation, store asset validation, demo generation, and
   browser smoke checks pass.
4. Confirm the ZIP SHA-256 matches the value above and the archive contains `manifest.json` at its
   root with no tests, `node_modules`, nested ZIPs, generator scripts, or local notes.
5. Obtain the real public Chrome Web Store and Microsoft Edge Add-ons URLs, replace the README
   launch-status text with direct install badges, and verify both links. Do not publish placeholder
   item IDs.
6. Create signed tag `v0.10.0` from the verified commit and push it only when publication is
   authorized. Confirm CI publishes the same ZIP to the GitHub release.
7. Upload the ZIP and listing fields from `CHROME_WEB_STORE.md` to Chrome Web Store, then submit it
   for review.
8. Upload the same ZIP plus the listing, Privacy page, and certification notes from
   `MICROSOFT_EDGE_ADDONS.md` to Microsoft Edge Partner Center, then submit it for certification.
9. After approval, verify the public version, screenshots, description, privacy URL, website, and
   support URL in both marketplaces.
