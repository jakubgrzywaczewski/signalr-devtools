# Privacy Policy — SignalR Inspector for Google Chrome

Last updated: August 1, 2026

SignalR Inspector is a developer tool that displays ASP.NET Core SignalR traffic from the browser
tab being inspected in Chrome DevTools. It runs entirely inside the browser and has no analytics,
advertising, telemetry, remote APIs, data synchronization, or developer-operated backend.

## Data handled

To provide its inspection features, the extension handles SignalR messages, payloads, endpoint
URLs, directions, sizes, protocol metadata, and connection lifecycle events from the inspected
tab. Application-defined payloads can contain website content, personal communications, or other
data selected by the application developer. SignalR connection and access-token parameters can be
encountered transiently while endpoint URLs are sanitized.

The extension assigns an opaque browser-generated document ID and a local connection sequence to
captured entries only to distinguish simultaneous connections. These values are not supplied by a
remote service and are not used to identify or track a person.

## Purpose and use

Captured data is used only to render the user-requested SignalR message log, payload details,
filters, invocation and stream analysis, connection timeline, and user-directed session
export/import. It is not used for advertising, profiling, credit or lending decisions, or any
purpose unrelated to SignalR inspection.

The use of information received from browser APIs adheres to the Chrome Web Store User Data
Policy, including the Limited Use requirements.

## Storage and retention

Captured information remains in a bounded, per-tab in-memory log in the extension service worker.
The log is limited to 500 entries and a bounded aggregate payload budget. Payload bodies larger
than 256 KiB are omitted. Data disappears when the inspected tab closes, the service worker
restarts, or the developer clears the log. No captured traffic is written to persistent browser
storage or synchronized between devices.

The developer can explicitly export the current bounded log to a local, versioned JSON file.
Exported files contain captured application payloads, sanitized endpoint metadata, and
session-local pseudonyms instead of browser-generated document IDs. They remain under the
developer's control. The extension does not upload, synchronize, or reopen them
automatically. Import reads only a file selected by the developer, validates it locally, and
atomically replaces the current bounded in-memory log.

## Sharing and transfer

SignalR Inspector does not send captured data to the extension developer, external servers, or
third parties. It does not sell data, permit humans to read captured data remotely, or use data for
personalized advertising. The extension reads traffic between the inspected application and the
application's own servers but does not create an additional transmission destination.

## Permissions

- `activeTab` grants temporary access only after the developer clicks the toolbar icon for the tab
  they want to inspect.
- `scripting` registers the extension's packaged SignalR instrumentation for that activated tab.

The extension declares no host permissions and downloads or executes no remote code. Opening
DevTools starts passive Long Polling observation for the inspected tab through the Chrome DevTools
Network API. WebSocket and Server-Sent Events instrumentation remains disabled until the toolbar
icon is clicked.

## Security and sanitization

Connection IDs, connection tokens, and common access-token query parameters are removed from
WebSocket, Server-Sent Events, and Long Polling endpoint URLs before captured entries are stored or
displayed. Long Polling tokens are used temporarily in DevTools memory only to correlate requests.
Endpoint tokens are removed again during session export/import. Application payload contents are
preserved in exported files for debugging. The extension is read-only and does not modify or block
application traffic.

## Developer controls

The developer can remove captured data with the panel's Clear button, disable WebSocket and
Server-Sent Events instrumentation by clicking the toolbar icon again, close the inspected tab, or
uninstall the extension. Locally exported session files must be deleted separately with normal
operating-system controls.

## Contact

For privacy questions, open an issue at:
https://github.com/jakubgrzywaczewski/signalr-devtools/issues
