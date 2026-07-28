# SignalR sample

This .NET 10 application provides a small `/chatHub` endpoint and dependency-free WebSocket and
Long Polling browser clients. The clients deliberately expose the SignalR handshake and JSON
protocol frames, making the sample useful when developing or demonstrating SignalR Inspector.

Run it from the repository root:

```bash
dotnet run --project samples/SignalR.Sample
```

Open the URL printed by ASP.NET Core, open Chrome or Edge DevTools, and select **SignalR
Inspector**. Then click the SignalR Inspector toolbar icon to activate it for that tab. The
activation reloads the page once so the extension can capture the SignalR handshake.

The default page uses WebSockets. Open `/?transport=long-polling` or select the Long Polling link
on the page to force the HTTP Long Polling transport. For Long Polling, keep DevTools open before
the navigation or reload so the DevTools Network observer sees the negotiation response.
