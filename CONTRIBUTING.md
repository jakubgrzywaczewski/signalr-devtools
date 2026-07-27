# Contributing

Thanks for helping improve SignalR Inspector.

## Local checks

```bash
cd signalr-inspector
npm ci
npm test
cd ..
dotnet build samples/SignalR.Sample
```

Keep pull requests focused and add tests for behavioral changes. Use clear commit messages and
describe any manual Chrome verification in the pull request.

## Reporting bugs

Include the Chrome version, extension version, SignalR transport and protocol, hub URL shape, and
minimal reproduction steps. Remove credentials and sensitive payload data before attaching logs
or screenshots.
