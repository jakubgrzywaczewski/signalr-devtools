# Changelog

All notable changes will be documented in this file.

## [Unreleased]

### Added

- Capture incoming and outgoing SignalR JSON traffic over HTTP Long Polling through the read-only
  DevTools Network API.
- Correlate negotiation and poll requests without assuming hub paths, redact connection and access
  tokens, and preserve binary payloads as bounded Base64.
- Add a dependency-free Long Polling mode to the .NET sample and cover the observer, DevTools
  bridge, service-worker boundary, and transport validation with automated tests.

### Changed

- Document Google Chrome and Microsoft Edge as supported, end-to-end tested browsers.
- Require a semantic version bump and full local verification for every commit.
- Pin CI actions, scan commits for secrets, and automate dependency update proposals.

### Fixed

- Run version-bump formatting from the nested extension package without conflicting Biome roots.

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
