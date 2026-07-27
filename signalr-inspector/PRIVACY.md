# Privacy notice

SignalR Inspector runs entirely inside Chrome. It does not contain analytics, advertising,
telemetry, remote APIs, or data synchronization.

Captured SignalR messages:

- remain in the extension service worker's memory;
- are available only to the DevTools panel for the corresponding tab;
- are limited to 500 entries and a bounded payload budget per tab;
- omit payload bodies larger than 256 KiB;
- disappear when the tab closes, the service worker restarts, or the user clears the log.

The extension needs access to page execution contexts to observe SignalR traffic. It does not
modify, block, persist, or transmit that traffic.

For privacy or licensing questions, contact Jakub Grzywaczewski through the repository.
