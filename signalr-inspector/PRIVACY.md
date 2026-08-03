# Privacy notice

SignalR Inspector runs entirely inside the browser. It does not contain analytics, advertising,
telemetry, remote APIs, or data synchronization.

Captured data is used only to provide the message log, invocation analysis, filtering, payload
details, connection timeline, and user-directed session export/import requested by the developer.
It is not sold, transferred to third parties, used for advertising or credit decisions, or made
available to the extension developer or other humans.

Captured SignalR messages:

- remain in the extension service worker's memory;
- are available only to the DevTools panel for the corresponding tab;
- are limited to 500 entries and a bounded payload budget per tab;
- omit payload bodies larger than 256 KiB;
- disappear when the tab closes, the service worker restarts, or the user clears the log.

The developer can explicitly select **Export session** to write the current bounded log to a local
JSON file. Exported files contain captured application payloads and sanitized endpoint metadata;
they omit transient tab and row IDs and replace browser-generated document IDs with session-local
pseudonyms. The browser saves the file only after this explicit action, and the extension does not
upload, synchronize, or reopen it automatically. **Import session**
reads only a file selected by the developer, validates it locally, and atomically replaces the
current bounded in-memory log. Exported files remain under the developer's control until deleted.

The same bounded in-memory log also contains transport lifecycle metadata used by the Timeline and
Insights views, such as negotiation results, transport open/close/error events, handshake state,
keep-alive gaps, and protocol Ack/Sequence values. It does not add browsing history, durable connection
profiles, or identifiers supplied by a remote service. An opaque browser-generated document ID and
a local connection sequence are retained with captured entries only to keep simultaneous
connections separate; they are transient and subject to the same limits and cleanup.

The extension does not request access to every website. WebSocket and Server-Sent Events
inspection receives temporary access only after the user clicks its toolbar icon on an HTTP or
HTTPS tab. Opening DevTools starts passive Long Polling inspection for that inspected tab: it reads
completed requests and response bodies using the browser's DevTools Network API even before the
SignalR Inspector panel is selected or the toolbar icon is clicked. It does not wrap or alter the
page's `fetch` or `XMLHttpRequest` functions.

Connection IDs, connection tokens, and common access-token query parameters are removed from
WebSocket, Server-Sent Events, and Long Polling endpoint URLs before captured messages are stored
or displayed. Long Polling tokens are used temporarily in DevTools memory to correlate requests.
When a standard Azure SignalR redirect is observed, its response access token is discarded and
only the sanitized service endpoint is retained as lifecycle metadata.
Application payloads may still contain sensitive data chosen by the inspected application. The
extension does not modify, block, automatically persist, or transmit captured traffic. Endpoint
tokens are removed again when sessions are exported or imported, but application payload contents
are preserved for debugging.

The developer can delete the current tab's captured data with the panel's Clear button, disable
WebSocket and Server-Sent Events instrumentation with the toolbar action, close the inspected tab,
or uninstall the extension. Closing the tab or restarting the extension service worker also
removes its in-memory data. Locally exported session files must be deleted separately by the
developer using normal operating-system controls.

For privacy or licensing questions, contact Jakub Grzywaczewski through the repository.
