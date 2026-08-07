'use strict';

(function exposeSignalRAnalysis(root) {
  const INVOCATION_TYPES = new Set([1, 4]);
  const DEFAULT_MAX_RECEIVE_MESSAGE_SIZE = 32 * 1024;
  const LARGE_PAYLOAD_WARNING_SIZE = Math.floor(DEFAULT_MAX_RECEIVE_MESSAGE_SIZE * 0.8);
  const PENDING_INVOCATION_GRACE_MS = 30_000;
  const DEFAULT_KEEP_ALIVE_GAP_WARNING_MS = 30_000;

  function oppositeDirection(direction) {
    return direction === 'incoming' ? 'outgoing' : 'incoming';
  }

  function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs)) {
      return '';
    }
    const normalizedDuration = Math.max(0, durationMs);
    if (normalizedDuration < 1_000) {
      return `${Math.round(normalizedDuration)} ms`;
    }
    return `${(normalizedDuration / 1_000).toFixed(2)} s`;
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
      'azure-signalr-redirect': 'Azure SignalR redirect',
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

  function observedConnectionKey(message) {
    if (
      Number.isSafeInteger(message.connectionSeq) &&
      message.connectionSeq > 0 &&
      typeof message.documentId === 'string' &&
      message.documentId
    ) {
      return `captured\n${message.documentId}\n${message.connectionSeq}`;
    }
    return `heuristic\n${endpointKey(message.endpoint)}\n${message.transport}`;
  }

  function median(values) {
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
  }

  function createConnection(id, message) {
    return {
      id,
      endpoint: message.endpoint,
      transport: message.transport === 'negotiation' ? '' : message.transport,
      startedAt: message.timestamp,
      endedAt: null,
      status: 'observed',
      azureEndpoint: null,
      serviceNegotiated: false,
      handshakeRequested: false,
      handshakeAccepted: false,
      closed: false,
      inbound: { acknowledgedThrough: null, resumesAt: null },
      outbound: { acknowledgedThrough: null, resumesAt: null },
    };
  }

  function analyzeConnections(messages, parsedByMessage, messageInfo) {
    const connections = [];
    const connectionByMessage = new Map();
    const currentByConnection = new Map();
    const pendingNegotiationByEndpoint = new Map();
    const pingStatsByConnection = new Map();
    const timeline = [];

    function pushEvent(connection, message, { kind, label, detail = '' }) {
      const event = {
        id: `${message.id}:${kind}:${timeline.length}`,
        connectionId: connection.id,
        messageId: message.id,
        timestamp: message.timestamp,
        kind,
        label,
        detail,
      };
      timeline.push(event);
      return event;
    }

    function queueNegotiation(endpoint, connection) {
      const queue = pendingNegotiationByEndpoint.get(endpoint) ?? [];
      queue.push(connection);
      pendingNegotiationByEndpoint.set(endpoint, queue);
    }

    function takeNegotiation(endpoint) {
      const queue = pendingNegotiationByEndpoint.get(endpoint);
      const connection = queue?.shift() ?? null;
      if (queue?.length === 0) {
        pendingNegotiationByEndpoint.delete(endpoint);
      }
      return connection;
    }

    function startConnection(message, reuseNegotiation = true) {
      const normalizedEndpoint = endpointKey(message.endpoint);
      let connection = reuseNegotiation ? takeNegotiation(normalizedEndpoint) : null;
      if (connection) {
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
      currentByConnection.set(observedConnectionKey(message), connection);
      return connection;
    }

    for (const message of messages) {
      const parsed = parsedByMessage.get(message);
      const normalizedEndpoint = endpointKey(message.endpoint);
      const connectionKey = observedConnectionKey(message);
      const isNegotiation = ['negotiate', 'azure-signalr-redirect'].includes(
        message.lifecycleEvent,
      );
      const startsTransport = message.lifecycleEvent === 'transport-open';
      const endsTransport =
        message.lifecycleEvent === 'transport-close' ||
        message.lifecycleEvent === 'transport-error';
      const startsHandshake = parsed?.records?.some((record) => record.kind === 'Handshake');
      let connection = currentByConnection.get(connectionKey);

      if (isNegotiation) {
        // An Azure SignalR redirect is followed by a second negotiation against the service
        // endpoint for the same logical connection — merge it instead of opening a new card.
        const redirected =
          message.lifecycleEvent === 'negotiate'
            ? pendingNegotiationByEndpoint
                .get(normalizedEndpoint)
                ?.find((candidate) => candidate.azureEndpoint && !candidate.serviceNegotiated)
            : null;
        if (redirected) {
          redirected.serviceNegotiated = true;
          connection = redirected;
        } else {
          connection = createConnection(`connection-${connections.length + 1}`, message);
          if (message.lifecycleEvent === 'azure-signalr-redirect') {
            connection.azureEndpoint = message.lifecycleDetail;
          }
          connections.push(connection);
          queueNegotiation(endpointKey(connection.azureEndpoint || message.endpoint), connection);
        }
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
          previous?.closed &&
          previous.id !== connection.id &&
          previous.transport !== message.transport &&
          message.timestamp - (previous.endedAt ?? previous.startedAt) <= 30_000
        ) {
          pushEvent(connection, message, {
            kind: 'transport-fallback',
            label: 'Transport fallback',
            detail: `${previous.transport} → ${message.transport}`,
          });
        } else if (previous?.closed && previous.id !== connection.id) {
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
          let stats = pingStatsByConnection.get(connection.id);
          if (!stats) {
            stats = {
              count: 0,
              gaps: [],
              lastAt: null,
              event: pushEvent(connection, message, {
                kind: 'ping',
                label: 'Keep-alive pings',
              }),
            };
            pingStatsByConnection.set(connection.id, stats);
          }
          if (stats.lastAt !== null) {
            stats.gaps.push(Math.max(0, message.timestamp - stats.lastAt));
          }
          stats.lastAt = message.timestamp;
          stats.count += 1;
          stats.event.detail =
            stats.count === 1
              ? '1 ping observed'
              : `${stats.count} pings · median gap ${formatDuration(median(stats.gaps))}`;
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
            connectionId,
            direction: message.direction,
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
    return [...pending.values()];
  }

  function analyzeInsights({ messages, parsedByMessage, connections, flows, messageInfo }) {
    const methodCounts = new Map();
    const hubMessages = [];
    let capturedBytes = 0;

    for (const message of messages) {
      const values = recordValues(parsedByMessage.get(message)).filter((value) =>
        Number.isInteger(value.type),
      );
      if (values.length === 0) {
        continue;
      }
      hubMessages.push(...values.map((value) => ({ message, value })));
      if (Number.isFinite(message.size)) {
        capturedBytes += Math.max(0, message.size);
      }
      for (const value of values) {
        if (INVOCATION_TYPES.has(value.type) && typeof value.target === 'string' && value.target) {
          methodCounts.set(value.target, (methodCounts.get(value.target) ?? 0) + 1);
        }
      }
    }

    const firstTimestamp = hubMessages[0]?.message.timestamp ?? null;
    const lastTimestamp = hubMessages.at(-1)?.message.timestamp ?? null;
    const durationMs =
      firstTimestamp === null || lastTimestamp === null
        ? 0
        : Math.max(0, lastTimestamp - firstTimestamp);
    const durationSeconds = durationMs / 1_000;
    const methods = [...methodCounts]
      .map(([target, count]) => ({
        target,
        count,
        percentage: hubMessages.length === 0 ? 0 : (count / hubMessages.length) * 100,
      }))
      .sort((left, right) => right.count - left.count || left.target.localeCompare(right.target));
    const warnings = [];

    for (const message of messages) {
      const hubRecords = recordValues(parsedByMessage.get(message)).filter((value) =>
        Number.isInteger(value.type),
      );
      if (
        message.direction === 'outgoing' &&
        Number.isFinite(message.size) &&
        message.size >= LARGE_PAYLOAD_WARNING_SIZE &&
        hubRecords.length === 1
      ) {
        warnings.push({
          id: `large-payload:${message.id}`,
          kind: 'large-payload',
          severity: message.size > DEFAULT_MAX_RECEIVE_MESSAGE_SIZE ? 'high' : 'warning',
          messageId: message.id,
          timestamp: message.timestamp,
          title: 'Large outbound payload',
          detail: `${message.size} bytes is ${message.size > DEFAULT_MAX_RECEIVE_MESSAGE_SIZE ? 'above' : 'close to'} ASP.NET Core SignalR's default 32 KiB receive limit.`,
        });
      }
    }

    const observationEnd = messages.at(-1)?.timestamp ?? 0;
    const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
    for (const flow of flows) {
      if (flow.completion) {
        continue;
      }
      const connection = connectionsById.get(flow.connectionId);
      const connectionEnded = connection?.endedAt !== null && connection?.endedAt !== undefined;
      const age = Math.max(
        0,
        (connectionEnded ? connection.endedAt : observationEnd) - flow.startedAt,
      );
      if (!connectionEnded && (flow.type === 4 || age < PENDING_INVOCATION_GRACE_MS)) {
        continue;
      }
      warnings.push({
        id: `pending-invocation:${flow.messageId}`,
        kind: 'pending-invocation',
        severity: 'warning',
        messageId: flow.messageId,
        timestamp: flow.startedAt,
        title: 'Invocation without Completion',
        detail: `${flow.target || 'Invocation'} #${flow.invocationId} remained pending for ${formatDuration(age)}${connectionEnded ? ' before the connection ended' : ''}.`,
      });
    }

    const pingHistory = new Map();
    for (const message of messages) {
      const connectionId = messageInfo.get(message.id)?.connectionId;
      if (!connectionId) {
        continue;
      }
      for (const value of recordValues(parsedByMessage.get(message))) {
        if (value.type !== 6) {
          continue;
        }
        const history = pingHistory.get(connectionId) ?? { lastAt: null, gaps: [] };
        if (history.lastAt !== null) {
          const gap = Math.max(0, message.timestamp - history.lastAt);
          const baseline = history.gaps.length >= 2 ? median(history.gaps) : null;
          const warningThreshold =
            baseline === null
              ? DEFAULT_KEEP_ALIVE_GAP_WARNING_MS
              : Math.max(20_000, baseline * 1.75);
          if (gap > warningThreshold) {
            warnings.push({
              id: `keep-alive-gap:${message.id}`,
              kind: 'keep-alive-gap',
              severity: 'warning',
              messageId: message.id,
              timestamp: message.timestamp,
              title: 'Long keep-alive gap',
              detail:
                baseline === null
                  ? `${formatDuration(gap)} elapsed between pings; this exceeds the 30 s fallback threshold.`
                  : `${formatDuration(gap)} elapsed between pings; the observed median was ${formatDuration(baseline)}.`,
            });
          }
          history.gaps.push(gap);
        }
        history.lastAt = message.timestamp;
        pingHistory.set(connectionId, history);
      }
    }

    warnings.sort(
      (left, right) => left.timestamp - right.timestamp || left.messageId - right.messageId,
    );
    return {
      summary: {
        hubMessages: hubMessages.length,
        capturedBytes,
        durationMs,
        messagesPerSecond: durationSeconds > 0 ? hubMessages.length / durationSeconds : null,
        bytesPerSecond: durationSeconds > 0 ? capturedBytes / durationSeconds : null,
        azureConnections: connections.filter((connection) => connection.azureEndpoint).length,
      },
      methods,
      warnings,
    };
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
    const flows = analyzeFlows(
      ordered,
      parsedByMessage,
      connectionAnalysis.connectionByMessage,
      messageInfo,
    );
    const insights = analyzeInsights({
      messages: ordered,
      parsedByMessage,
      connections: connectionAnalysis.connections,
      flows,
      messageInfo,
    });

    return {
      connections: connectionAnalysis.connections,
      insights,
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
