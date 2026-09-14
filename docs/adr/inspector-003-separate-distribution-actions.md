# INSPECTOR-003: Keep distribution actions separate

- Status: Accepted
- Date: 2026-09-14
- Decision owner: Repository owner
- Trace: analysis package introduced in extension 1.2.0, commit `4a3b1f4`; policy formalized in
  `ARCHITECTURE.md` 1.2.7

## Context

This repository produces multiple artifacts with different audiences and side effects: source
commits, GitHub extension releases, the independently versioned npm analysis package, and Chrome
and Edge marketplace submissions. A `v*` tag triggers the GitHub release workflow, while npm and
browser stores have separate credentials and review processes.

## Decision

A commit, an extension release, npm publication, and each browser-store submission are distinct
owner-controlled actions. Version bumps prepare artifacts; they do not authorize publication.
Pushing a `v*` tag counts as publication because automation creates the GitHub release.

## Alternatives considered

- Publish all artifacts from every version bump. Rejected because unrelated documentation and
  maintenance commits also carry extension versions, and each channel has different readiness.
- Couple npm publication to an extension tag. Rejected because the analysis package has an
  independent version and changes only when one of its canonical modules changes.
- Treat tags as bookkeeping. Rejected because the existing workflow gives them an external side
  effect.

## Consequences

Release handoffs must name the exact action being authorized. The repository may intentionally be
ahead of GitHub, npm, or either browser store without that state being a failed release.
