# INSPECTOR-001: Preserve interactive npm publication

- Status: Accepted
- Date: 2026-09-14
- Decision owner: Repository owner
- Trace: extension 1.2.4, commit `abea926`

## Context

The analysis-package release gate needs machine-readable npm output for pack and dry-run commands.
A real npm publication can instead require an OTP or browser authorization. Capturing its streams
through the same `execFile` path can hide that prompt and leave the command waiting without a
useful error.

## Decision

The guarded npm wrapper uses two process modes:

- pack and machine-readable dry runs use `execFile` with captured streams;
- real publication uses `spawn` with inherited terminal streams.

Both modes run the same source and digest checks before npm and the same cleanup afterward.

## Alternatives considered

- Use captured `execFile` streams for every operation. Rejected because an interactive challenge
  is not visible to the publisher.
- Inherit streams for every operation. Rejected because release gates must parse npm's JSON output.
- Pass an OTP in the command line. Rejected because credentials and one-time codes must not appear
  in shell history or process arguments.

## Consequences

The wrapper keeps two deliberate execution paths and tests both. A future refactor must preserve
the interactive terminal for a real publication and captured output for machine-readable gates.
