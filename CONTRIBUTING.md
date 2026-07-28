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
bypass the hook with `--no-verify`. A version bump and commit do not create a tag or release.

Keep pull requests focused and add tests for behavioral changes. Use clear commit messages and
describe any manual Chrome or Edge verification in the pull request.

## Reporting bugs

Include the browser and its version, extension version, SignalR transport and protocol, hub URL
shape, and minimal reproduction steps. Remove credentials and sensitive payload data before
attaching logs or screenshots.
