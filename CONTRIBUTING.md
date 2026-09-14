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

## Reporting bugs

Include the browser and its version, extension version, SignalR transport and protocol, hub URL
shape, and minimal reproduction steps. Remove credentials and sensitive payload data before
attaching logs or screenshots.
