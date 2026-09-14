# INSPECTOR-002: Do not use live publication as a test

- Status: Accepted
- Date: 2026-09-14
- Decision owner: Repository owner
- Trace: analysis package introduced in extension 1.2.0, commit `4a3b1f4`

## Context

Publishing a new npm version changes the public registry permanently. A successful upload consumes
that version even if the surrounding release procedure later fails, so a live publication is not a
repeatable or reversible test fixture.

## Decision

Automated checks exercise staging, packing, dry-run publication, installation, CommonJS and ESM
consumers, failure cleanup, and the interactive child-process path without uploading to the live
registry. A real publication remains an explicit owner action after those checks pass.

## Alternatives considered

- Publish a disposable version during CI. Rejected because it creates permanent public artifacts
  and couples CI to registry credentials and availability.
- Treat the first real publication as the final release-gate test. Rejected because the gate could
  only report a defect after the irreversible action.
- Mock the entire packaging path. Rejected because npm pack and dry-run checks can exercise most of
  the real toolchain without changing registry state.

## Consequences

The repository can prove package contents and consumer compatibility before publication, but only
the explicit live action can validate the registry account's current authentication policy.
