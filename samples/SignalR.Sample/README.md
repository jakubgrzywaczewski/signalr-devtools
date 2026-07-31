# SignalR sample

This .NET 10 application provides a small `/chatHub` endpoint and dependency-free browser clients
for WebSockets with JSON, HTTP Long Polling with JSON, and WebSockets with MessagePack. The clients
deliberately expose the SignalR handshake and protocol frames, making the sample useful when
developing or demonstrating SignalR Inspector.

Run it from the repository root:

```bash
dotnet run --project samples/SignalR.Sample
```

Open the URL printed by ASP.NET Core, open Chrome or Edge DevTools, and select **SignalR
Inspector**. Then click the SignalR Inspector toolbar icon to activate it for that tab. The
activation reloads the page once so the extension can capture the SignalR handshake.

Use the separate **WebSockets (JSON)**, **Long Polling (JSON)**, and **MessagePack (WebSockets)**
buttons to reconnect the page with a specific test scenario. For Long Polling, keep DevTools open
before selecting the button or reloading so the DevTools Network observer sees the negotiation
response.
