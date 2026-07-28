# SignalR MessagePack fixtures

This tool generates the golden binary fixtures used by the extension tests with the official
ASP.NET Core SignalR MessagePack implementation.

From the repository root:

```sh
dotnet run --project tools/msgpack-fixtures -- \
  signalr-inspector/tests/fixtures/signalr-messagepack.json
```

Commit the generated JSON whenever the fixture definitions or the pinned SignalR protocol package
change. The extension does not package this generator or its NuGet dependencies.
