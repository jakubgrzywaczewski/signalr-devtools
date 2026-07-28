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
HTTPS tab. Long Polling inspection reads completed requests and response bodies only for the tab
whose DevTools window is open, using the browser's DevTools Network API. It does not wrap or alter
the page's `fetch` or `XMLHttpRequest` functions.

Long Polling connection IDs, connection tokens, and common access-token query parameters are used
temporarily to correlate requests, then removed from endpoint URLs before captured messages are
stored or displayed. Application payloads may still contain sensitive data chosen by the
inspected application. The extension does not modify, block, persist, or transmit captured
traffic.

For privacy or licensing questions, contact Jakub Grzywaczewski through the repository.
