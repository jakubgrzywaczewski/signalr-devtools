# INSPECTOR-004: Stop the cognitive-complexity ratchet at 20

- Status: Accepted
- Date: 2026-09-14
- Decision owner: Repository owner
- Trace: `SRI-002` (50), `SRI-003` (30), `SRI-004` (20); extension 1.2.8, 1.2.10, 1.2.11

## Context

Biome computes cognitive complexity for this codebase and always did, but the rule shipped at
severity `info` while `npm run check` runs `--diagnostic-level=warn`, so every finding was filtered
out before anyone saw it. Twenty-one functions sat above the rule's default maximum of 15 and the
worst was 183 — a 390-line function with 43 branches and ten levels of indentation — and nobody
knew.

Three tasks fixed that. The rule now runs at `error` with an explicit maximum, and the worst
functions came down in stages: 50, then 30, then 20. Ten functions remain above the rule's default
of 15, at `19, 19, 19, 19, 18, 17, 17, 17, 17, 16`.

## Decision

`maxAllowedComplexity` stays at **20**, and 20 is the destination rather than a stop. No further
ratchet is planned. A function between 16 and 19 is refactored when working on it proves difficult,
for that reason — not because the counter reports 19.

## Alternatives considered

- **Continue to 15, the rule's default.** Rejected. The ratchet had begun to re-split its own
  output: four of the ten remaining functions were *created* by the two previous rounds and accepted
  in review as well-shaped, including `readVarIntPrefix`, which was singled out as an improvement
  because it returns a discriminated result instead of interleaving a prefix read with frame
  slicing. Reaching 15 would undo work the same series had just justified.
- **Continue to 15 with exceptions.** Rejected as the same thing with bookkeeping. The exceptions
  would be precisely the cases below.
- **Keep the rule but lower the severity back.** Rejected: severity was the original defect. The
  metric being invisible is what let a function reach 183.

## Consequences

The gate still prevents regression, which was the actual finding: a new function at 183 does not
pass at 20 any more than it would at 15. What 20 does not do is force extraction where the counter
and readability have parted company, and three cases show that they have:

- `readValue` at 17 is the flat `switch` over MessagePack wire types. Nesting depth is the cost, not
  branch count; a flat dispatch reads well at thirty cases and splitting it replaces one readable
  block with five names to chase.
- `parsePayload` is the same shape for the Hub Protocol.
- Two of the ten are not product code at all: `assertPureJavaScript` in
  `scripts/analysis-package.mjs` and `main` in `scripts/generate-demo.mjs`. The first is the release
  gate, where [INSPECTOR-001](inspector-001-preserve-interactive-npm-publication.md) showed that a
  subtle change costs the most and surfaces the latest.

Each round also carried a fixed cost that the remaining distance does not earn: a refactor of shipped
files, a forced library version bump when a published module is touched, an E2E run, a store-ZIP
comparison, and independent differential probes. Those bought a drop from 183 for the first task.
They would buy four counter points for the last.
