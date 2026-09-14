# @signalr-devtools/analysis

Decode and analyze captured ASP.NET Core SignalR traffic in Node using the same protocol and
analysis modules shipped by the SignalR Inspector browser extension.

This package is the headless analysis core. It does not install or expose the Chrome/Edge DevTools
panel, capture browser traffic, connect to Chrome DevTools Protocol, or run an MCP server.

## Install

```bash
npm install @signalr-devtools/analysis
```

The package is CommonJS and can also be imported from an ES module. The root export is the
conversation analysis API; protocol parsing, MessagePack decoding, and session handling are
available through explicit subpaths.

```javascript
const analysis = require('@signalr-devtools/analysis');
const protocol = require('@signalr-devtools/analysis/signalrProtocol');

const separator = '\u001e';
const invocationPayload =
  JSON.stringify({
    type: 1,
    invocationId: '1',
    target: 'SendMessage',
    arguments: ['Ada', 'Hello'],
  }) + separator;
const completionPayload = JSON.stringify({ type: 3, invocationId: '1' }) + separator;
const messages = [
  {
    id: 1,
    direction: 'outgoing',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 100,
    encoding: 'text',
    size: invocationPayload.length,
    textPayload: invocationPayload,
  },
  {
    id: 2,
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 145,
    encoding: 'text',
    size: completionPayload.length,
    textPayload: completionPayload,
  },
];

const result = analysis.analyze(messages, protocol.parsePayload);
console.log(result.insights.summary.hubMessages); // 2
console.log(result.insights.methods[0].target); // SendMessage
```

## Public modules

- `@signalr-devtools/analysis` or `/signalrAnalysis`: `analyze`, `formatDuration`
- `/signalrProtocol`: `parsePayload`, `formatPayload`
- `/msgpackDecoder`: `decode`, `decodeVarIntFrames`
- `/sessionFormat`: `create`, `parse`, `serialize`, `FORMAT`, `VERSION`,
  `MAX_FILE_CHARACTERS`

Load `/msgpackDecoder` before parsing binary payloads with `/signalrProtocol`, matching the script
order used by the extension. Importing it registers the decoder used by the shared protocol module.

The exported SignalR Inspector session format is currently version `1`. Package versions and
session-format versions are independent.

This project is not affiliated with or endorsed by Microsoft.

## License

MIT
