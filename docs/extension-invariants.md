# Extension design invariants

Properties the SignalR Inspector extension must hold. They are stated here, in the
repository, because they describe this project rather than any tool that reviews
it: a violation is a defect even when the code "works".

Cite them by number in a review or pull request. Every one is derivable from the
source in `signalr-inspector/`; this document exists so the reasoning is written
down once instead of being rediscovered per change.

1. **Dual-boundary validation.** Every field crossing page → extension must be allowlist-copied
   and validated identically in `contentScript.js` AND `background.js` ("keep in sync" pair),
   with string length limits. New invariants must hold in both directions (field A present ⇔
   field B present). New string fields must be added to every `countStoredCharacters` copy
   (background + panel).
2. **The page is hostile.** MAIN-world code (`injected.js`) is unprivileged; nothing the page
   can forge may influence trusted identifiers (IDs come from the service worker). Wrappers must
   preserve native behavior and message ordering (per-connection serialization queue).
3. **Bounded everything.** Every collection needs a bound (ring buffer, LRU, reset path) AND
   per-item size caps; check cleanup on trim/replace/tab-close for stale keys (Sets/Maps keyed
   by message or connection IDs).
4. **Defensive decoding.** Parsers of untrusted bytes (MessagePack, VarInt framing, handshake)
   enforce depth/element/length limits and fall back to raw previews — never throw into the
   panel, never lose 64-bit precision silently.
5. **MV3 lifecycle.** Service worker is ephemeral: ports must reconnect, per-tab state must
   survive or degrade explicitly; `activeTab`+`scripting` only — any new permission, host
   access, persistence, telemetry, or remote code is a high-severity finding.
6. **Privacy redaction.** Connection IDs and access-token query parameters (`id`,
   `access_token`, `accessToken`) must be stripped on every path where an endpoint URL is
   captured, stored, or rendered.
7. **Panel performance.** No full DOM rebuild or hidden-view rendering per incoming message;
   parse/analysis caching; renders coalesced. High message rate (streaming) is the design load.
8. **Protocol-first detection.** No app-specific URL heuristics; only protocol evidence
   (allowed exception: `/negotiate` suffix and token correlation in the DevTools network
   observer path).
9. **Tests follow behavior.** Behavior changes need tests; boundary changes need negative tests
   at both boundaries; decoder changes need fixture/fuzz coverage.
