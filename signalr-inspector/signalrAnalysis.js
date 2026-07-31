'use strict';

(function exposeSignalRAnalysis(root) {
  const INVOCATION_TYPES = new Set([1, 4]);

  function oppositeDirection(direction) {
    return direction === 'incoming' ? 'outgoing' : 'incoming';
  }

  function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs)) {
      return '';
    }
    if (durationMs < 1_000) {
      return `${Math.max(0, Math.round(durationMs))} ms`;
    }
    return `${(durationMs / 1_000).toFixed(2)} s`;
  }

  function messageInfoFor(map, messageId) {
    if (!map.has(messageId)) {
      map.set(messageId, {
        flowLabels: [],
        relatedMessageIds: [],
        streamChildren: [],
        streamParentId: null,
      });
    }
    return map.get(messageId);
  }

  function addRelated(info, messageId) {
    if (messageId && !info.relatedMessageIds.includes(messageId)) {
      info.relatedMessageIds.push(messageId);
    }
  }

  function recordValues(parsed) {
    return (parsed?.records ?? [])
      .map((record) => record?.value)
      .filter((value) => value && typeof value === 'object');
  }

  function lifecycleLabel(eventType) {
    return {
      negotiate: 'Negotiate',
      'transport-open': 'Transport connected',
      'transport-close': 'Transport disconnected',
      'transport-error': 'Transport error',
    }[eventType];
  }

  function endpointKey(endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol === 'ws:') {
        url.protocol = 'http:';
      } else if (url.protocol === 'wss:') {
        url.protocol = 'https:';
      }
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return endpoint;
    }
  }

  function createConnection(id, message) {
    return {
      id,
      endpoint: message.endpoint,
      transport: message.transport === 'negotiation' ? '' : message.transport,
      startedAt: message.timestamp,
      endedAt: null,
      status: 'observed',
      handshakeRequested: false,
      handshakeAccepted: false,
      closed: false,
      lastPingAt: null,
      inbound: { acknowledgedThrough: null, resumesAt: null },
      outbound: { acknowledgedThrough: null, resumesAt: null },
    };
  }

  function analyzeConnections(messages, parsedByMessage, messageInfo) {
    const connections = [];
    const connectionByMessage = new Map();
    const currentByTransport = new Map();
    const pendingNegotiationByEndpoint = new Map();
    const timeline = [];

    function pushEvent(connection, message, { kind, label, detail = '' }) {
      timeline.push({
        id: `${message.id}:${kind}:${timeline.length}`,
        connectionId: connection.id,
        messageId: message.id,
        timestamp: message.timestamp,
        kind,
        label,
        detail,
      });
    }

    function startConnection(message, reuseNegotiation = true) {
      const normalizedEndpoint = endpointKey(message.endpoint);
      let connection = reuseNegotiation
        ? pendingNegotiationByEndpoint.get(normalizedEndpoint)
        : null;
      if (connection) {
        pendingNegotiationByEndpoint.delete(normalizedEndpoint);
        connection.endpoint = message.endpoint;
        connection.transport = message.transport;
      } else {
        connection = createConnection(`connection-${connections.length + 1}`, message);
        connections.push(connection);
        pushEvent(connection, message, {
          kind: 'connection-observed',
          label: 'Connection observed',
          detail: message.transport,
        });
      }
      currentByTransport.set(`${normalizedEndpoint}\n${message.transport}`, connection);
      return connection;
    }

    for (const message of messages) {
      const parsed = parsedByMessage.get(message);
      const normalizedEndpoint = endpointKey(message.endpoint);
      const transportKey = `${normalizedEndpoint}\n${message.transport}`;
      const isNegotiation = message.lifecycleEvent === 'negotiate';
      const startsTransport = message.lifecycleEvent === 'transport-open';
      const endsTransport =
        message.lifecycleEvent === 'transport-close' ||
        message.lifecycleEvent === 'transport-error';
      const startsHandshake = parsed?.records?.some((record) => record.kind === 'Handshake');
      let connection = currentByTransport.get(transportKey);

      if (isNegotiation) {
        connection = createConnection(`connection-${connections.length + 1}`, message);
        connections.push(connection);
        pendingNegotiationByEndpoint.set(normalizedEndpoint, connection);
      } else if (
        !connection ||
        (connection.closed && !endsTransport) ||
        (startsHandshake && connection.handshakeRequested) ||
        (startsTransport && connection.transport && connection.status === 'connected')
      ) {
        const previous = [...connections]
          .reverse()
          .find(
            (candidate) =>
              endpointKey(candidate.endpoint) === normalizedEndpoint && candidate.transport,
          );
        connection = startConnection(message);
        if (
          previous &&
          previous.id !== connection.id &&
          previous.transport !== message.transport &&
          message.timestamp - (previous.endedAt ?? previous.startedAt) <= 30_000
        ) {
          pushEvent(connection, message, {
            kind: 'transport-fallback',
            label: 'Transport fallback',
            detail: `${previous.transport} → ${message.transport}`,
          });
        } else if (previous && previous.id !== connection.id) {
          pushEvent(connection, message, {
            kind: 'reconnect',
            label: 'Reconnect observed',
            detail: message.transport,
          });
        }
      }

      connectionByMessage.set(message.id, connection.id);
      messageInfoFor(messageInfo, message.id).connectionId = connection.id;

      if (message.lifecycleEvent) {
        const label = lifecycleLabel(message.lifecycleEvent);
        if (label) {
          pushEvent(connection, message, {
            kind: message.lifecycleEvent,
            label,
            detail: message.lifecycleDetail || message.preview || '',
          });
        }
        if (message.lifecycleEvent === 'transport-open') {
          connection.status = 'connected';
          connection.transport = message.transport;
        }
        if (
          message.lifecycleEvent === 'transport-close' ||
          message.lifecycleEvent === 'transport-error'
        ) {
          connection.status =
            message.lifecycleEvent === 'transport-error' ? 'error' : 'disconnected';
          connection.endedAt = message.timestamp;
          connection.closed = true;
        }
      }

      for (const record of parsed?.records ?? []) {
        const value = record?.value;
        if (record.kind === 'Handshake') {
          connection.handshakeRequested = true;
          pushEvent(connection, message, {
            kind: 'handshake',
            label: 'Handshake requested',
            detail: record.summary,
          });
          continue;
        }
        if (record.kind === 'Handshake response' || record.kind === 'Handshake error') {
          connection.handshakeAccepted = record.kind === 'Handshake response';
          connection.status = connection.handshakeAccepted ? 'connected' : 'error';
          pushEvent(connection, message, {
            kind: connection.handshakeAccepted ? 'handshake-accepted' : 'handshake-error',
            label: connection.handshakeAccepted ? 'Handshake accepted' : 'Handshake failed',
            detail: record.summary,
          });
          continue;
        }
        if (!value || typeof value !== 'object') {
          continue;
        }
        if (value.type === 6) {
          const gap =
            connection.lastPingAt === null
              ? ''
              : `${formatDuration(message.timestamp - connection.lastPingAt)} since previous ping`;
          connection.lastPingAt = message.timestamp;
          pushEvent(connection, message, { kind: 'ping', label: 'Keep-alive ping', detail: gap });
        } else if (value.type === 7) {
          connection.status = value.allowReconnect ? 'reconnect allowed' : 'closed';
          connection.endedAt = message.timestamp;
          connection.closed = true;
          pushEvent(connection, message, {
            kind: 'close',
            label: value.allowReconnect
              ? 'Connection closed; reconnect allowed'
              : 'Connection closed',
            detail: value.error || '',
          });
        } else if (value.type === 8) {
          const channel =
            message.direction === 'incoming' ? connection.outbound : connection.inbound;
          channel.acknowledgedThrough = value.sequenceId;
          pushEvent(connection, message, {
            kind: 'ack',
            label: 'Stateful reconnect acknowledgement',
            detail: `${message.direction === 'incoming' ? 'Outbound' : 'Inbound'} delivered through #${value.sequenceId}`,
          });
        } else if (value.type === 9) {
          const channel =
            message.direction === 'outgoing' ? connection.outbound : connection.inbound;
          const previous = channel.resumesAt;
          channel.resumesAt = value.sequenceId;
          const detail = `${message.direction === 'outgoing' ? 'Outbound' : 'Inbound'} resumes at #${value.sequenceId}${previous === null ? '' : ` (previously #${previous})`}`;
          pushEvent(connection, message, {
            kind: 'sequence',
            label: 'Stateful reconnect sequence',
            detail,
          });
        }
      }
    }

    return { connectionByMessage, connections, timeline };
  }

  function analyzeFlows(messages, parsedByMessage, connectionByMessage, messageInfo) {
    const pending = new Map();

    function flowKey(connectionId, direction, invocationId) {
      return `${connectionId}\n${direction}\n${invocationId}`;
    }

    for (const message of messages) {
      const connectionId = connectionByMessage.get(message.id);
      const info = messageInfoFor(messageInfo, message.id);
      for (const value of recordValues(parsedByMessage.get(message))) {
        if (INVOCATION_TYPES.has(value.type) && value.invocationId !== undefined) {
          pending.set(flowKey(connectionId, message.direction, value.invocationId), {
            invocationId: value.invocationId,
            messageId: message.id,
            startedAt: message.timestamp,
            target: value.target,
            type: value.type,
            items: [],
            completion: null,
            cancelled: false,
          });
          continue;
        }

        if (value.type === 2 && value.invocationId !== undefined) {
          const flow = pending.get(
            flowKey(connectionId, oppositeDirection(message.direction), value.invocationId),
          );
          if (flow?.type === 4) {
            flow.items.push({ messageId: message.id, timestamp: message.timestamp });
            info.streamParentId = flow.messageId;
            const parentInfo = messageInfoFor(messageInfo, flow.messageId);
            if (!parentInfo.streamChildren.includes(message.id)) {
              parentInfo.streamChildren.push(message.id);
            }
            addRelated(info, flow.messageId);
          }
          continue;
        }

        if (value.type === 3 && value.invocationId !== undefined) {
          const flow = pending.get(
            flowKey(connectionId, oppositeDirection(message.direction), value.invocationId),
          );
          if (flow) {
            flow.completion = {
              messageId: message.id,
              timestamp: message.timestamp,
              error: value.error,
            };
          }
          continue;
        }

        if (value.type === 5 && value.invocationId !== undefined) {
          const flow = pending.get(flowKey(connectionId, message.direction, value.invocationId));
          if (flow) {
            flow.cancelled = true;
            flow.completion = { messageId: message.id, timestamp: message.timestamp };
          }
        }
      }
    }

    for (const flow of pending.values()) {
      const invocationInfo = messageInfoFor(messageInfo, flow.messageId);
      const completion = flow.completion;
      const duration = completion ? completion.timestamp - flow.startedAt : null;
      let label;

      if (flow.type === 4) {
        const itemCount = flow.items.length;
        const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
        let rateLabel = '';
        if (itemCount > 1) {
          const interval = flow.items.at(-1).timestamp - flow.items[0].timestamp;
          if (interval > 0) {
            rateLabel = ` · ${((itemCount - 1) / (interval / 1_000)).toFixed(1)}/s`;
          }
        }
        label = completion
          ? `${flow.cancelled ? 'Cancelled' : completion.error ? 'Error' : 'Completed'} · ${itemLabel}${rateLabel} · ${formatDuration(duration)}`
          : `Streaming · ${itemLabel}${rateLabel}`;
      } else if (!completion) {
        label = `Pending #${flow.invocationId}`;
      } else if (flow.cancelled) {
        label = `Cancelled · ${formatDuration(duration)}`;
      } else if (completion.error) {
        label = `Error · ${formatDuration(duration)}`;
      } else {
        label = `Completed · ${formatDuration(duration)}`;
      }

      invocationInfo.flowLabels.push(label);
      if (completion) {
        const completionInfo = messageInfoFor(messageInfo, completion.messageId);
        completionInfo.flowLabels.push(`↩ ${flow.target || 'Invocation'} #${flow.invocationId}`);
        addRelated(invocationInfo, completion.messageId);
        addRelated(completionInfo, flow.messageId);
      }
    }
  }

  function analyze(messages, parsePayload) {
    const ordered = [...messages].sort(
      (left, right) => left.timestamp - right.timestamp || left.id - right.id,
    );
    const parsedByMessage = new Map(ordered.map((message) => [message, parsePayload(message)]));
    const messageInfo = new Map();
    for (const message of ordered) {
      messageInfoFor(messageInfo, message.id);
    }

    const connectionAnalysis = analyzeConnections(ordered, parsedByMessage, messageInfo);
    analyzeFlows(ordered, parsedByMessage, connectionAnalysis.connectionByMessage, messageInfo);

    return {
      connections: connectionAnalysis.connections,
      messageInfo,
      timeline: connectionAnalysis.timeline.sort(
        (left, right) => left.timestamp - right.timestamp || left.messageId - right.messageId,
      ),
    };
  }

  const api = { analyze, formatDuration };
  root.SignalRAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
