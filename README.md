# SignalR DevTools Playground

This workspace contains the Chrome DevTools extension `signalr-inspector/`, which exposes a dedicated panel for SignalR gRPC traffic. Use any existing Blazor/SignalR project (or another SignalR-capable backend) to generate traffic for the extension.

## Quick start

1. Install dependencies for the extension and run the test suite:
   ```bash
   cd signalr-inspector
   npm install
   npm test
   ```
2. Launch your own SignalR-enabled site (e.g. a Blazor Server app exposing `/grpc` endpoints). Ensure it runs over HTTPS and that you have trusted the developer certificate (`dotnet dev-certs https --trust`) to avoid WebSocket failures.
3. Load the extension via `chrome://extensions` (Developer mode → **Load unpacked** → `signalr-inspector`).
4. Open the target site in Chrome, launch DevTools, and switch to the *SignalR Inspector* tab to watch messages.
5. If the UI that emits SignalR messages uses a “Send” button, it will remain disabled until the SignalR connection succeeds. Check the status label or DevTools console for errors such as certificate issues or 404s on `/grpc`.

## Repository structure

| Path | Description |
| --- | --- |
| `signalr-inspector` | DevTools extension code, tests, and build scripts |
| `README.md` | This overview |

For more detailed usage notes of each component refer to the README inside its directory. To keep personal run/debug notes, copy or edit `RUN_DEBUG_LOCAL.md` (ignored by Git) as needed.
