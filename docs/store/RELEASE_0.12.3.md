# SignalR Inspector 0.12.3 release handoff

This file is the source of truth for the GitHub release and manual browser-store submissions.

## Release identity

- Version: `0.12.3`
- Expected tag: `v0.12.3`
- Release title: `SignalR Inspector v0.12.3`
- Package: `dist/signalr-inspector.zip`
- Locally verified package SHA-256:
  `cae8fa9689409e160219d6541267348eec95c353776ba1029775b16ebc9b61a2`
- Chrome listing kit: [`CHROME_WEB_STORE.md`](CHROME_WEB_STORE.md)
- Edge listing kit: [`MICROSOFT_EDGE_ADDONS.md`](MICROSOFT_EDGE_ADDONS.md)

## GitHub release notes

```text
SignalR Inspector 0.12.3 closes the review debt ahead of the first store submission: Azure SignalR correlation, end-to-end gate hardening, and CI reliability.

Highlights

- Merge the repeated Azure SignalR service negotiation into the redirected connection, so a full redirect → negotiate → transport sequence yields a single connection card and reconnect cycles keep the Azure badge with fresh start times.
- Synchronize end-to-end activation with the real tab reload and clean up the temporary extension copy even when the browser context fails to launch.
- Build the end-to-end test extension from the same file allowlist as the store package, so a file missing from the package list now fails CI instead of only breaking the store zip.
- Cache Playwright browsers in CI, prebuild the .NET sample before the Playwright web-server window, and grant the secret-scan job pull-request read access so Dependabot runs stop failing.
- Document Azure SignalR detection limits: custom domains are not recognized, and DevTools must be open before negotiation.
- Keep permissions unchanged with no telemetry, remote services, synchronization, or automatic persistence.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

## Publication checklist

1. Confirm the release commit is on `main` and `package.json`, `package-lock.json`, and
   `manifest.json` all report `0.12.3`.
2. Confirm `npm run check`, `npm test`, `npm run test:coverage`, `npm run test:e2e`,
   `npm audit --audit-level=high`, both .NET Release builds, manifest validation, store-asset
   validation, and demo generation pass.
3. Confirm the local ZIP SHA-256 matches the value above and the archive contains all
   manifest-referenced runtime files with no tests, `node_modules`, nested ZIPs, generator scripts,
   or local notes.
4. Exercise Messages, Timeline, and Insights with JSON, MessagePack, Long Polling, streaming,
   reconnection, export, clear, and import scenarios in a branded Chrome or Edge release candidate.
5. Create signed tag `v0.12.3` from the verified commit and push it only when publication is
   authorized. Confirm tagged CI passes and publishes its verified ZIP to the GitHub release.
6. Verify the GitHub release title, notes, version, ZIP integrity, and published asset SHA-256.
7. Upload the CI-published ZIP and listing fields from `CHROME_WEB_STORE.md` to Chrome Web Store,
   then submit it for review.
8. Upload the same ZIP plus the listing, Privacy page, and certification notes from
   `MICROSOFT_EDGE_ADDONS.md` to Microsoft Edge Partner Center, then submit it for certification.
9. After approval, verify the public version, screenshots, description, privacy URL, website, and
   support URL in both marketplaces.
