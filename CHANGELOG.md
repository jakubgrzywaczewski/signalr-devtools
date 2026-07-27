# Changelog

All notable changes will be documented in this file.

## [Unreleased]

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
