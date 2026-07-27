# SignalR sample

This .NET 10 application provides a small `/chatHub` endpoint and a dependency-free browser
client. The client deliberately exposes the SignalR handshake and JSON protocol frames, making
the sample useful when developing or demonstrating SignalR Inspector.

Run it from the repository root:

```bash
dotnet run --project samples/SignalR.Sample
```

Open the URL printed by ASP.NET Core, click the SignalR Inspector toolbar icon to activate it for
that tab, then open Chrome DevTools and select **SignalR Inspector**. The activation reloads the
page once so the extension can capture the SignalR handshake.
