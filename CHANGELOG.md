# Changelog

All notable changes to SignalR Inspector are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions.

Version entries record changes committed to the extension package. A version is publicly
distributed only after its own store submission or a tagged GitHub release; a changelog entry
alone does not publish anything.

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
