# Changelog

All notable changes to SignalR Inspector are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions.

Version entries record changes committed to the extension package. A version is publicly
distributed only after its own store submission or a tagged GitHub release; a changelog entry
alone does not publish anything.

## [0.13.2] - 2026-08-11

### Fixed

- Update the transitive `nanoid` development dependency to 3.3.17 to resolve the high-severity
  audit advisory GHSA-2v37-7h3g-55p8 that failed the CI dependency audit. No shipped extension
  code changes.

## [0.13.1] - 2026-08-11

### Changed

- Move the browser-store submission kits (dashboard field maps and per-version release handoff
  checklists) out of the public repository into local-only internal docs. The repository keeps the
  public marketplace privacy policies in `docs/store` and the store assets in `docs/images`.

## [0.13.0] - 2026-08-07

### Added

- Capture outgoing Server-Sent Events HTTP posts through the DevTools network observer, closing
  the documented transport-matrix gap. SSE connections are told apart from Long Polling
  deterministically: a repeated SignalR POST with no completed poll proves the handshake response
  arrived through an event stream, and a finished `text/event-stream` GET yields the stream-end
  close event.
- Merge the page-world and network-observer views of one Server-Sent Events connection into a
  single conversation, so incoming stream events and outgoing posts share a connection card,
  flow pairing, and Insights statistics.
- Add a Server-Sent Events (JSON) scenario to the .NET sample with a protocol-faithful
  hand-rolled EventSource transport, covered by unit tests and a browser end-to-end scenario.

### Changed

- Label network-observed transports per connection (`server-sent events` vs `long polling`) in
  lifecycle events, captured messages, and DELETE cleanup.

## [0.12.3] - 2026-08-07

### Fixed

- Merge the repeated Azure SignalR service negotiation into the redirected connection, so a full
  redirect → negotiate → transport sequence yields a single connection card and reconnect cycles
  keep the Azure badge with fresh start times.
- Synchronize end-to-end activation with the real tab reload instead of asserting against the
  pre-reload document, and clean up the temporary extension copy even when the browser context
  fails to launch.

### Changed

- Build the end-to-end test extension from the same file allowlist as the store package, so a
  file missing from the package list now fails CI instead of only breaking the store zip.
- Cache Playwright browsers in CI, prebuild the .NET sample before the Playwright web-server
  window, and grant the secret-scan job pull-request read access so Dependabot runs stop failing.
- Document Azure SignalR detection limits (custom domains are not recognized; DevTools must be
  open before negotiation) and refresh store bookkeeping: the Insights screenshot in the asset
  table and superseded-release notes on historical handoffs.

## [0.12.2] - 2026-08-05

### Changed

- Restructure the Chrome Web Store and Microsoft Edge Add-ons release kits as exact dashboard
  field maps for the current submission flow.
- Refresh marketplace descriptions, visual-asset ordering, privacy declarations, certification
  steps, and release handoff for the 0.12 Insights and browser end-to-end coverage release.

## [0.12.1] - 2026-08-03

### Added

- Add Playwright end-to-end coverage that loads the unpacked Manifest V3 extension in bundled
  Chromium and captures live JSON and MessagePack traffic from the real .NET sample.
- Verify invocation flows, Insights, MessagePack stream grouping, and the session
  export-clear-import round-trip across the page, service worker, and panel boundaries.

### Changed

- Gate tagged releases on a dedicated browser end-to-end CI job and retain Playwright traces and
  screenshots when that job fails.

## [0.12.0] - 2026-08-03

### Added

- Add an Insights view with observed SignalR message rate, payload throughput, captured volume,
  Azure SignalR connection count, and a hub-method invocation distribution.
- Warn about outbound payloads near ASP.NET Core SignalR's default 32 KiB receive limit,
  non-streaming invocations still missing Completion after a 30-second grace period, streams left
  open when their connection closes, and anomalous keep-alive gaps relative to the observed ping
  cadence.
- Detect standard Azure SignalR Service negotiation redirects, discard their access tokens, and
  show the sanitized service endpoint as a connection badge and lifecycle event.

### Changed

- Extend the captured-message and session validation contract with the bounded
  `azure-signalr-redirect` lifecycle event without adding browser permissions, persistence,
  telemetry, or remote services.

## [0.11.1] - 2026-08-03

### Fixed

- Replace browser-generated document IDs with stable session-local pseudonyms during export while
  preserving per-document connection correlation.
- Keep captured-message validation constants aligned across the content script, service worker,
  and session-file boundary with an explicit regression test.
- Defer Blob URL revocation until the browser has started processing the session download.

## [0.11.0] - 2026-08-01

### Added

- Export the current bounded message log as a versioned SignalR Inspector JSON session for bug
  reports, offline review, and reproducible debugging.
- Import a session atomically into the inspected tab after validating its format, message shapes,
  lifecycle metadata, count, and aggregate text budget.

### Changed

- Remove transient tab and row identifiers from exported files, re-sanitize endpoint tokens, and
  assign fresh trusted tab, row, and document identifiers at the service-worker boundary during
  import.
- Document user-directed session files in the privacy notices, marketplace disclosures, package
  guidance, and release materials without adding permissions, telemetry, remote services, or
  automatic persistence.

## [0.10.0] - 2026-07-31

### Added

- Add direction, SignalR message-type, and transport filters that compose with endpoint and
  payload search in the Messages view.
- Add a bounded `StreamCounter` scenario to the .NET sample, with real StreamInvocation,
  StreamItem, and Completion traffic over JSON and MessagePack.
- Add a controlled sample transport drop and ordinary reconnect flow for demonstrating connection
  replacement in the Timeline.
- Add a checked-in, browser-driven generator for the README GIF and three 1280×800 store
  screenshots using fixed fictional SignalR records.

### Changed

- Hide protocol keep-alive pings from Messages by default while retaining them for optional
  inspection, connection analysis, and Timeline aggregation.
- Put browser support badges and a prominent source-install path near the top of the README, with
  explicit placeholders for public store URLs instead of unpublished item IDs.
- Refresh Chrome Web Store and Microsoft Edge Add-ons copy, certification steps, screenshots, and
  release guidance for the 0.10 feature set.

## [0.9.2] - 2026-07-31

### Added

- Add complete, ready-to-paste Chrome Web Store and Microsoft Edge Add-ons release kits with
  descriptions, privacy disclosures, permission justifications, asset upload maps, certification
  notes, and GitHub release notes.
- Add store-specific public privacy policies so each marketplace can receive a precise policy URL
  without browser-specific wording leaking into the other listing.

### Changed

- Make the manifest summary identify SignalR messages, invocation flows, and connection timelines
  directly in browser extension search and management surfaces.
- Align the shared browser-store guide with the 0.9.2 package and the current 0.9 feature set.

## [0.9.1] - 2026-07-31

### Changed

- Coalesce bursts of live traffic into one panel render per animation frame and rebuild only the
  visible Messages or Timeline view.
- Aggregate keep-alive pings per connection in the Timeline with a count and median observed gap.

### Fixed

- Correlate concurrent WebSocket, Server-Sent Events, and Long Polling connections using a bounded
  per-document connection sequence instead of merging equal endpoint and transport pairs.
- Navigate to related and timeline messages even when the target is filtered or belongs to a
  collapsed stream group.
- Require lifecycle encoding and lifecycle events together at both message boundaries, including
  strict validation of connection sequences.
- Preserve transport lifecycle events when the pre-detection data buffer fills, capture explicit
  Server-Sent Events closes, and suppress repeated SSE errors until the connection reopens.
- Remove stale collapsed-stream state when messages are replaced or trimmed.

## [0.9.0] - 2026-07-31

### Added

- Pair invocations, stream invocations, completions, errors, and cancellations by connection,
  direction, and invocation ID, with observed duration and direct navigation between related rows.
- Group stream items under their stream invocation with collapse controls, item counts, and
  observed delivery rates.
- Add a connection lifecycle timeline for negotiation, transport open/close/error, handshake,
  keep-alive gaps, reconnects, transport fallback, and close reasons.
- Visualize stateful reconnect acknowledgements and sequence resumptions separately for inbound
  and outbound traffic.

### Changed

- Let each browser marketplace supply its own dynamic listing link by removing the hard-coded
  repository `homepage_url` from the manifest.
- Keep lifecycle metadata bounded, transient, sanitized, and subject to the existing per-tab log
  limits without adding permissions, persistence, telemetry, or remote code.

### Fixed

- Recognize the UTF-8 handshake response carried in a binary buffer before MessagePack hub frames,
  so the connection timeline records handshake acceptance for MessagePack sessions.

## [0.8.0] - 2026-07-31

### Added

- Add a dependency-free MessagePack browser client and enable the official ASP.NET Core
  MessagePack hub protocol in the .NET sample.
- Add separate WebSockets (JSON), Long Polling (JSON), and MessagePack (WebSockets) scenario
  buttons with a visible active state to the sample page.

## [0.7.2] - 2026-07-31

### Fixed

- Make the browser toolbar action a true per-tab toggle: clicking it again unregisters page
  instrumentation, clears the active badge, and reloads the page without the wrappers.

## [0.7.1] - 2026-07-28

### Added

- Enforce aggregate V8 coverage thresholds for importable runtime modules, with stricter branch
  thresholds for the page-message trust boundary and the MessagePack decoder.
- Cover activation failures and cleanup, defensive MessagePack and SignalR protocol branches,
  invalid Long Polling requests, and connection deletion behavior.

### Changed

- Run the extension test suite with coverage enforcement in CI while keeping local `npm test`
  fast.
- Pin Vitest and its V8 coverage provider to the same compatible version.

## [0.7.0] - 2026-07-28

### Added

- Decode standard ASP.NET Core SignalR MessagePack messages, including VarInt framing, hub message
  types 1–9, safe 64-bit integer display, binary previews, and timestamp extensions.
- Add defensive nesting and element limits, corruption fallback, deterministic fuzz coverage, and
  golden fixtures generated by the official ASP.NET Core SignalR MessagePack implementation.
- Document MessagePack application setup, browser-store release copy, and the reproducible .NET
  fixture generator.

### Fixed

- Preserve the panel scroll position while a developer is reading older traffic.
- Ignore stale initialization data until an in-flight log clear is acknowledged.

### Changed

- Include the dependency-free MessagePack decoder in the extension package without adding browser
  permissions, runtime dependencies, remote code, persistence, or network access.
- Build the fixture generator in local pre-commit verification and CI, with high-severity NuGet
  audit findings treated as errors.

## [0.6.3] - 2026-07-28

### Fixed

- Remove connection IDs and common access-token parameters from WebSocket and Server-Sent Events
  endpoints, with defense-in-depth redaction at the service-worker boundary.
- Reconnect the DevTools panel after Manifest V3 service-worker restarts and restore the active
  toolbar badge after same-origin reloads.
- Prevent duplicate isolated-world bridges when multiple per-tab registrations match one origin,
  and silence delivery errors from scripts orphaned by extension reloads.
- Bound Long Polling correlation maps and the panel's local message copy, guard service-worker log
  trimming against inconsistent counters, and reject malformed panel port identifiers.

### Changed

- Cache parsed SignalR payloads, append live table rows incrementally, clear expired selections,
  and make message rows keyboard accessible.
- Ship exact 16, 32, 48, and 128 px extension icons.
- Clarify passive Long Polling observation, transport limitations, transient storage, token
  handling, and public HTTPS clone instructions.

## [0.6.2] - 2026-07-28

### Fixed

- Replace Chrome-specific promotional asset filenames and in-image copy with browser-neutral
  equivalents suitable for both Chrome Web Store and Microsoft Edge Add-ons.

## [0.6.1] - 2026-07-28

### Changed

- Expand the changelog with the complete committed version history from 0.3.0 onward.
- Document how to keep repository, GitHub release, Chrome Web Store, and Microsoft Edge Add-ons
  release information aligned without putting a full changelog in the extension UI.
- Link the packaged author metadata and extension homepage to the maintainer's public GitHub
  profile and repository.

## [0.6.0] - 2026-07-28

### Added

- Capture incoming and outgoing SignalR JSON traffic over HTTP Long Polling through the read-only
  DevTools Network API.
- Correlate negotiation and poll requests without assuming hub paths, redact connection and access
  tokens, and preserve binary payloads as bounded Base64.
- Add a dependency-free Long Polling mode to the .NET sample.
- Add automated coverage for the observer, DevTools bridge, service-worker boundary, navigation
  races, Base64 text responses, and transport validation.

### Changed

- Document the required DevTools-first workflow for capturing Long Polling negotiation.
- Bump the extension feature version from 0.5.x to 0.6.0.

## [0.5.3] - 2026-07-28

### Fixed

- Run version-bump formatting from the nested extension package without conflicting Biome roots.

## [0.5.2] - 2026-07-27

### Added

- Add the repository-local SignalR Inspector maintenance skill and package metadata for reuse by
  coding agents.
- Add Dependabot configuration for npm packages and GitHub Actions.
- Add secret scanning to continuous integration and document repository security controls.

### Changed

- Require a semantic version bump and full local verification for every commit.
- Pin CI actions, scan commits for secrets, and automate dependency update proposals.
- Install a local pre-commit hook that runs version policy, Biome, Vitest, and the .NET Release
  build.

## [0.5.1] - 2026-07-27

### Changed

- Document Google Chrome and Microsoft Edge as supported, end-to-end tested browsers.
- Make extension metadata browser-neutral and add store-specific publishing guidance.
- Document browser store assets, permission justification, and the fact that Chrome Web Store and
  Microsoft Edge Add-ons require separate submissions.

## [0.5.0] - 2026-07-27

### Added

- Strict Biome linting, formatting, import organization, and CI validation.
- Extension-specific security rules that reject dynamic code evaluation, unsafe HTML sinks,
  unexpected outbound networking, permission expansion, and ad-hoc script execution.
- Automated tests proving that the extension security rules reject unsafe fixtures.
- Repository code ownership and official ASP.NET Core SignalR references.

### Changed

- Make promise rejection handling explicit for toolbar activation, badge updates, and dynamic
  script cleanup.
- Register the DevTools panel with its packaged icon for compatibility with the current
  `chrome.devtools.panels.create` contract.
- Convert test and Vitest configuration files to explicit ECMAScript modules.
- Document the sole-maintainer governance model and independent relationship to Microsoft.

## [0.4.0] - 2026-07-27

### Added

- Explicit per-tab activation with a toolbar action and visible success or failure badge.
- Tests for activation URL matching, dynamic script registration, and permission minimization.

### Changed

- Replace persistent `<all_urls>` access with explicit per-tab activation using `activeTab` and
  dynamically registered `document_start` instrumentation.
- Reload the activated tab automatically so SignalR handshakes are captured before application
  scripts run.
- Update the usage, privacy, sample, and Chrome Web Store documentation for the new activation
  flow.

### Removed

- Broad host permissions and always-on content scripts for every website.

## [0.3.0] - 2026-07-27

### Added

- A dependency-free .NET 10 SignalR demonstration application.
- Tests for protocol detection and message validation.
- SignalR JSON Hub Protocol parsing for handshakes, invocations, streams, completions, pings,
  closes, acknowledgements, and sequences.
- README and Chrome Web Store images generated from real SignalR traffic.
- Continuous integration for extension tests and the sample build, plus tagged GitHub releases.

### Changed

- Detect SignalR from protocol frames instead of requiring `/grpc` in the URL.
- Execute page instrumentation through Manifest V3's `MAIN` world.
- Limit retained payload bodies to 256 KiB and per-tab logs to 500 messages with a bounded
  aggregate payload budget.
- Align package and manifest versions at 0.3.0.
- Release the project consistently under the MIT License.
- Use English throughout the repository.

### Removed

- Unused `activeTab`, `scripting`, and `storage` permissions.
- Screenshot-only test tooling from the tracked source tree.
