# SignalR Inspector 0.12.2 release handoff

This file is the source of truth for the GitHub release and manual browser-store submissions.

## Release identity

- Version: `0.12.2`
- Expected tag: `v0.12.2`
- Release title: `SignalR Inspector v0.12.2`
- Package: `dist/signalr-inspector.zip`
- Locally verified package SHA-256:
  `cc6373497757f9811d1ad0745acad90ed69b08d8340ba1bbb19418805cd96f52`
- Chrome listing kit: [`CHROME_WEB_STORE.md`](CHROME_WEB_STORE.md)
- Edge listing kit: [`MICROSOFT_EDGE_ADDONS.md`](MICROSOFT_EDGE_ADDONS.md)

## GitHub release notes

```text
SignalR Inspector 0.12.2 turns the current bounded trace into a local traffic overview with focused protocol warnings.

Highlights

- Add an Insights view with observed SignalR message and payload rates, captured volume, Azure SignalR connection counts, and a hub-method invocation distribution.
- Warn about large outbound payloads, stale non-streaming invocations, streams interrupted by connection closure, and unusual keep-alive gaps.
- Detect standard Azure SignalR Service negotiation redirects, discard returned access tokens, and show the sanitized service endpoint as a connection badge and lifecycle event.
- Add browser end-to-end coverage that exercises the unpacked Manifest V3 extension against the real .NET sample with live JSON and MessagePack traffic.
- Verify invocation flows, stream grouping, Insights, and the session export-clear-import round-trip across page, service-worker, and DevTools-panel boundaries.
- Keep permissions unchanged with no telemetry, remote services, synchronization, or automatic persistence.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

## Publication checklist

1. Confirm the release commit is on `main` and `package.json`, `package-lock.json`, and
   `manifest.json` all report `0.12.2`.
2. Confirm `npm run check`, `npm test`, `npm run test:coverage`, `npm run test:e2e`,
   `npm audit --audit-level=high`, both .NET Release builds, manifest validation, store-asset
   validation, and demo generation pass.
3. Confirm the local ZIP SHA-256 matches the value above and the archive contains all
   manifest-referenced runtime files with no tests, `node_modules`, nested ZIPs, generator scripts,
   or local notes.
4. Exercise Messages, Timeline, and Insights with JSON, MessagePack, Long Polling, streaming,
   reconnection, export, clear, and import scenarios in a branded Chrome or Edge release candidate.
5. Create signed tag `v0.12.2` from the verified commit and push it only when publication is
   authorized. Confirm tagged CI passes and publishes its verified ZIP to the GitHub release.
6. Verify the GitHub release title, notes, version, ZIP integrity, and published asset SHA-256.
7. Upload the CI-published ZIP and listing fields from `CHROME_WEB_STORE.md` to Chrome Web Store,
   then submit it for review.
8. Upload the same ZIP plus the listing, Privacy page, and certification notes from
   `MICROSOFT_EDGE_ADDONS.md` to Microsoft Edge Partner Center, then submit it for certification.
9. After approval, verify the public version, screenshots, description, privacy URL, website, and
   support URL in both marketplaces.
