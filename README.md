# SignalR DevTools Playground

This workspace contains:

- `signalr-inspector/` – Chrome DevTools extension that exposes a dedicated panel for SignalR gRPC traffic.
- `blazor-signalr-demo/` – sample Blazor Web App with a `/grpc/chat` SignalR hub used to generate traffic for the extension.

## Quick start

1. Install dependencies for the extension and run the test suite:
   ```bash
   cd signalr-inspector
   npm install
   npm test
   ```
2. Run the demo app:
   ```bash
   cd ../blazor-signalr-demo
   dotnet run
   ```
3. Load the extension via `chrome://extensions` (Developer mode → **Load unpacked** → `signalr-inspector`).
4. Open the demo site in Chrome, launch DevTools, and switch to the *SignalR Inspector* tab to watch messages.

## Repository structure

| Path | Description |
| --- | --- |
| `signalr-inspector` | DevTools extension code, tests, and build scripts |
| `blazor-signalr-demo` | Blazor chat demo with a SignalR hub at `/grpc/chat` |
| `README.md` | This overview |

For more detailed usage notes of each component refer to the README inside its directory. To keep personal run/debug notes, copy or edit `RUN_DEBUG_LOCAL.md` (ignored by Git) as needed.
