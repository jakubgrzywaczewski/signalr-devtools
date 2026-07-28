# Privacy notice

SignalR Inspector runs entirely inside the browser. It does not contain analytics, advertising,
telemetry, remote APIs, or data synchronization.

Captured SignalR messages:

- remain in the extension service worker's memory;
- are available only to the DevTools panel for the corresponding tab;
- are limited to 500 entries and a bounded payload budget per tab;
- omit payload bodies larger than 256 KiB;
- disappear when the tab closes, the service worker restarts, or the user clears the log.

The extension does not request access to every website. WebSocket and Server-Sent Events
inspection receives temporary access only after the user clicks its toolbar icon on an HTTP or
HTTPS tab. Opening DevTools starts passive Long Polling inspection for that inspected tab: it reads
completed requests and response bodies using the browser's DevTools Network API even before the
SignalR Inspector panel is selected or the toolbar icon is clicked. It does not wrap or alter the
page's `fetch` or `XMLHttpRequest` functions.

Connection IDs, connection tokens, and common access-token query parameters are removed from
WebSocket, Server-Sent Events, and Long Polling endpoint URLs before captured messages are stored
or displayed. Long Polling tokens are used temporarily in DevTools memory to correlate requests.
Application payloads may still contain sensitive data chosen by the inspected application. The
extension does not modify, block, persist, or transmit captured traffic.

For privacy or licensing questions, contact Jakub Grzywaczewski through the repository.
