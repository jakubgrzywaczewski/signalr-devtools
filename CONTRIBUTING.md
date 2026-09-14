# Contributing

Thanks for helping improve SignalR Inspector.

## Local checks

```bash
cd signalr-inspector
npm ci
npm run version:bump -- patch
npm run check
npm test
npm run test:coverage
npm run analysis:check
cd ..
dotnet build samples/SignalR.Sample
dotnet build tools/msgpack-fixtures
```

Every logical change must be committed with a semantic version bump. Use `patch` for documentation,
tests, compatible fixes, dependencies, CI, and security maintenance; `minor` for backward-compatible
features; and `major` for breaking changes. The bump updates `package.json`, `package-lock.json`,
and `manifest.json` together.

`npm ci` installs the repository's `pre-commit` hook. It rejects a commit without a staged version
bump and runs Biome, Vitest, and Release builds of the .NET sample and MessagePack fixture
generator. CI additionally enforces coverage thresholds for the importable runtime modules. Do not
bypass the hook with `--no-verify`. `npm run analysis:check` also packs the public analysis core,
compares it byte-for-byte with the extension modules, and installs it into isolated CommonJS and
ESM consumers. A version bump and commit do not create a tag or release.

Biome enforces `complexity/noExcessiveCognitiveComplexity` as an error with a maximum of **20**,
and **20 is the destination, not a stop** — there is no further ratchet planned. Ten functions sit
between 16 and 19; refactor one when working on it proves difficult, for that reason, not because
the counter reports 19. The reasoning is in
[`docs/adr/inspector-004-stop-the-complexity-ratchet-at-20.md`](docs/adr/inspector-004-stop-the-complexity-ratchet-at-20.md).
`npm run check` applies the gate. To run that rule alone and show every violation, use:

```bash
npx biome lint --only=complexity/noExcessiveCognitiveComplexity \
  --diagnostic-level=info --max-diagnostics=none .
```

Use the guarded wrappers for maintainer packaging and publication of the analysis library:

```bash
cd signalr-inspector
npm run analysis:pack -- --dry-run
npm run analysis:publish -- --dry-run --access public
```

Changes to `msgpackDecoder.js`, `sessionFormat.js`, `signalrAnalysis.js`, or `signalrProtocol.js`
also change the public library. Bump its independent version and regenerate the committed source
digest together:

```bash
cd signalr-inspector
npm run analysis:version:bump -- patch
```

`analysis:check`, raw npm lifecycle hooks, and the guarded wrappers reject changed module bytes
without the matching library bump. The digest is release metadata only and is excluded from the
published tarball.

The wrappers bypass the package's npm lifecycle only after preparing the canonical modules, then
remove every generated file in a `finally`-equivalent path on success or failure. For a real first
publication, remove `--dry-run` only after the npm scope and owner access have been verified. A real
publish inherits the terminal so npm can request an OTP or browser authorization; dry runs retain
captured output for machine-readable release gates.

The extension must hold the design invariants in
[docs/extension-invariants.md](docs/extension-invariants.md) — trust boundaries,
bounded memory, defensive decoding, privacy redaction, and the rest. A change that
violates one is a defect even if it works; cite invariants by number when reviewing
or describing a change.

Keep pull requests focused and add tests for behavioral changes. Use clear commit messages and
describe any manual Chrome or Edge verification in the pull request.

### What line coverage does and does not measure

`npm run test:coverage` measures `activation.js`, `contentScript.js`, `longPolling.js`,
`msgpackDecoder.js`, `sessionFormat.js`, `signalrAnalysis.js` and `signalrProtocol.js`.

**`background.js` and `panel.js` are covered by behaviour, not by a line-coverage figure**, and this
is deliberate. Their harnesses evaluate the source inside jsdom rather than importing it, so V8 sees
no executed lines: measured 2026-09-14, adding both files to the `include` list reports **0%** for
each and drops the overall statement figure from roughly 91% to 56%, while 12 service-worker tests,
24 panel tests and the Playwright E2E suite exercise them. Adding them would make the numbers lie,
not improve them.

So when a change touches those two files, "coverage did not fall" is not a claim anyone can make.
Say what does cover the change — the behavioural tests that exercise it, and E2E — and do not treat a
missing figure as a passing one.

## Reporting bugs

Include the browser and its version, extension version, SignalR transport and protocol, hub URL
shape, and minimal reproduction steps. Remove credentials and sensitive payload data before
attaching logs or screenshots.
