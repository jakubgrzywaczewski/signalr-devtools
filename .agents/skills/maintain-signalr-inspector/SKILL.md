---
name: maintain-signalr-inspector
description: Maintain the SignalR Inspector Chrome and Edge extension with mandatory semantic version bumps, local pre-commit verification, focused commits, CI/CD hardening, security review, packaging checks, and optional releases. Use for any code, test, documentation, dependency, workflow, manifest, store, or release-related change in the signalr-devtools repository.
---

# Maintain SignalR Inspector

Work in the `signalr-devtools` repository. Treat a commit and a release as separate operations:
commit every completed logical change, but create a tag or release only when the user requests it.

## Required workflow

1. Inspect `git status --short --branch`, recent commits, and the current versions before editing.
2. Preserve unrelated user changes. If related unfinished changes exist, include them deliberately
   or commit them as their own logical change first.
3. Choose exactly one semantic version bump for the planned commit:
   - `patch`: documentation, tests, refactors, chores, dependency maintenance, compatible fixes,
     CI/security hardening, or other changes without new user-facing capability;
   - `minor`: backward-compatible user-facing functionality;
   - `major`: breaking behavior, incompatible data changes, or materially broader permissions.
4. Run `npm run version:bump -- <patch|minor|major>` from `signalr-inspector`. Never edit only one
   version file. Keep `package.json`, `package-lock.json`, and `manifest.json` identical.
5. Update `CHANGELOG.md` and relevant documentation. Add or update tests for behavior changes.
6. Keep permissions minimal. Do not add host permissions, remote code, unsafe HTML sinks,
   unbounded payload retention, or outbound telemetry without explicit user authorization and a
   security review.
7. Stage only the logical change. Review `git diff --cached` and run `git diff --cached --check`.
8. Commit normally. Do not use `--no-verify`. The installed pre-commit hook must pass:
   - staged version consistency and a bump relative to `HEAD`;
   - strict Biome checks;
   - all Vitest tests;
   - Release build of `samples/SignalR.Sample`.
9. Confirm the commit exists and the worktree contains no uncommitted task changes.
10. Do not tag, push, publish a GitHub release, or submit to a browser marketplace unless the user
    explicitly requests that external action.

## CI and security review

When changing workflows or dependencies:

- retain least-privilege `GITHUB_TOKEN` permissions;
- pin every third-party GitHub Action to a full commit SHA and retain a version comment;
- keep `npm ci --ignore-scripts`, `npm audit`, strict extension-security linting, tests, packaging,
  archive inspection, the .NET Release build, and secret scanning green;
- update `.github/dependabot.yml` when adding a new package ecosystem or action;
- verify tag-to-manifest version matching remains enforced;
- inspect recent GitHub Actions runs and repository security settings when network access exists;
- call out platform controls that cannot be enabled because of repository visibility or plan.

## Release boundary

A version bump does not imply a release. For a requested release, first verify a clean tagged
commit, rerun all checks, inspect the ZIP, ensure the tag is exactly `v<manifest version>`, and only
then follow the repository's publishing workflow.
