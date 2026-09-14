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
      keyKind: null,
      documentId: message.documentId ?? null,
      handshakeRequested: false,
      handshakeAccepted: false,
      sawHubFrames: false,
      sawNonPingHubFrame: false,
      closed: false,
      gracefulClose: false,
      inbound: { acknowledgedThrough: null, resumesAt: null },
      outbound: { acknowledgedThrough: null, resumesAt: null },
    };
  }

  function createConnectionAnalysisState(messageInfo) {
    return {
      connections: [],
      connectionByMessage: new Map(),
      currentByConnection: new Map(),
      pendingNegotiationByEndpoint: new Map(),
      pingStatsByConnection: new Map(),
      timeline: [],
      messageInfo,
      connectionCount: 0,
    };
  }

  function pushConnectionEvent(state, connection, message, { kind, label, detail = '' }) {
    const event = {
      id: `${message.id}:${kind}:${state.timeline.length}`,
      connectionId: connection.id,
      messageId: message.id,
      timestamp: message.timestamp,
      kind,
      label,
      detail,
    };
    state.timeline.push(event);
    return event;
  }

  function queueNegotiation(state, endpoint, connection) {
    const queue = state.pendingNegotiationByEndpoint.get(endpoint) ?? [];
    queue.push(connection);
    state.pendingNegotiationByEndpoint.set(endpoint, queue);
  }

  function takeNegotiation(state, endpoint) {
    const queue = state.pendingNegotiationByEndpoint.get(endpoint);
    const connection = queue?.shift() ?? null;
    if (queue?.length === 0) {
      state.pendingNegotiationByEndpoint.delete(endpoint);
    }
    return connection;
  }

  function startConnection(state, message, reuseNegotiation = true) {
    const normalizedEndpoint = endpointKey(message.endpoint);
    let connection = reuseNegotiation ? takeNegotiation(state, normalizedEndpoint) : null;
    if (connection) {
      connection.endpoint = message.endpoint;
      connection.transport = message.transport;
    } else {
      state.connectionCount += 1;
      connection = createConnection(`connection-${state.connectionCount}`, message);
      state.connections.push(connection);
      pushConnectionEvent(state, connection, message, {
        kind: 'connection-observed',
        label: 'Connection observed',
        detail: message.transport,
      });
    }
    state.currentByConnection.set(observedConnectionKey(message), connection);
    return connection;
  }

  function isStatefulResumeCandidate(candidate, connection, message, normalizedEndpoint) {
    return (
      candidate !== connection &&
      candidate.closed &&
      !candidate.gracefulClose &&
      (candidate.status === 'disconnected' || candidate.status === 'error') &&
      (candidate.handshakeAccepted || candidate.sawHubFrames) &&
      candidate.transport === connection.transport &&
      endpointKey(candidate.endpoint) === normalizedEndpoint &&
      (connection.documentId === null ||
        candidate.documentId === null ||
        candidate.documentId === connection.documentId) &&
      message.timestamp - (candidate.endedAt ?? candidate.startedAt) <= 30_000
    );
  }

  function closestResumeCandidate(candidates, message) {
    return candidates.reduce(
      (closest, candidate) =>
        closest === null ||
        Math.abs(message.timestamp - (candidate.endedAt ?? candidate.startedAt)) <
          Math.abs(message.timestamp - (closest.endedAt ?? closest.startedAt))
          ? candidate
          : closest,
      null,
    );
  }

  function reassignConnectionMessages(state, connection, resumed) {
    for (const [messageId, connectionId] of state.connectionByMessage) {
      if (connectionId === connection.id) {
        state.connectionByMessage.set(messageId, resumed.id);
        messageInfoFor(state.messageInfo, messageId).connectionId = resumed.id;
      }
    }
  }

  function reassignConnectionTimeline(state, connection, resumed) {
    for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
      const event = state.timeline[index];
      if (event.connectionId !== connection.id) {
        continue;
      }
      if (event.kind === 'connection-observed') {
        state.timeline.splice(index, 1);
      } else {
        event.connectionId = resumed.id;
      }
    }
  }

  function reassignCurrentConnections(state, connection, resumed) {
    for (const [key, current] of state.currentByConnection) {
      if (current === connection) {
        state.currentByConnection.set(key, resumed);
      }
    }
  }

  function mergeConnectionPingStats(state, connection, resumed) {
    const stats = state.pingStatsByConnection.get(connection.id);
    if (!stats) {
      return;
    }
    const resumedStats = state.pingStatsByConnection.get(resumed.id);
    if (!resumedStats) {
      state.pingStatsByConnection.set(resumed.id, stats);
    } else {
      // Fold the temporary card's pings into the resumed connection's single event; the
      // gap across the drop itself was never observed, so it is not synthesized here.
      resumedStats.count += stats.count;
      resumedStats.gaps.push(...stats.gaps);
      resumedStats.lastAt = Math.max(resumedStats.lastAt ?? stats.lastAt, stats.lastAt);
      resumedStats.event.detail =
        resumedStats.gaps.length === 0
          ? `${resumedStats.count} pings observed`
          : `${resumedStats.count} pings · median gap ${formatDuration(median(resumedStats.gaps))}`;
      const duplicateEventIndex = state.timeline.indexOf(stats.event);
      if (duplicateEventIndex !== -1) {
        state.timeline.splice(duplicateEventIndex, 1);
      }
    }
    state.pingStatsByConnection.delete(connection.id);
  }

  function mergeReconnectChannels(connection, resumed) {
    for (const channelName of ['inbound', 'outbound']) {
      for (const field of ['acknowledgedThrough', 'resumesAt']) {
        if (connection[channelName][field] !== null && resumed[channelName][field] === null) {
          resumed[channelName][field] = connection[channelName][field];
        }
      }
    }
  }

  // A transport whose first hub frame is a Sequence instead of a handshake can only be a
  // stateful reconnect resume: the protocol requires every fresh connection to open with a
  // handshake, and only a resume skips it. Connection tokens are sanitized away before
  // capture, so the split card is folded back into the interrupted connection it continues.
  // The interrupted side may itself lack a captured handshake (log cleared, activation on an
  // already-connected page, oldest entries evicted) — any decoded hub frame is accepted as
  // equivalent proof that the candidate speaks hub protocol.
  function mergeStatefulResume(state, connection, message) {
    if (connection.handshakeRequested || connection.handshakeAccepted) {
      return null;
    }
    const normalizedEndpoint = endpointKey(connection.endpoint);
    const candidates = state.connections.filter((candidate) =>
      isStatefulResumeCandidate(candidate, connection, message, normalizedEndpoint),
    );
    // Prefer the drop closest in time to the resume over mere creation order.
    const resumed = closestResumeCandidate(candidates, message);
    if (!resumed) {
      return null;
    }
    reassignConnectionMessages(state, connection, resumed);
    reassignConnectionTimeline(state, connection, resumed);
    state.connections.splice(state.connections.indexOf(connection), 1);
    reassignCurrentConnections(state, connection, resumed);
    mergeConnectionPingStats(state, connection, resumed);
    mergeReconnectChannels(connection, resumed);
    resumed.closed = false;
    resumed.endedAt = null;
    resumed.status = 'connected';
    resumed.transport = connection.transport;
    resumed.endpoint = connection.endpoint;
    return resumed;
  }

  function processNegotiation(state, message, normalizedEndpoint) {
    // An Azure SignalR redirect is followed by a second negotiation against the service endpoint
    // for the same logical connection — merge it instead of opening a new card.
    const redirected =
      message.lifecycleEvent === 'negotiate'
        ? state.pendingNegotiationByEndpoint
            .get(normalizedEndpoint)
            ?.find((candidate) => candidate.azureEndpoint && !candidate.serviceNegotiated)
        : null;
    if (redirected) {
      redirected.serviceNegotiated = true;
      return redirected;
    }
    state.connectionCount += 1;
    const connection = createConnection(`connection-${state.connectionCount}`, message);
    const negotiationEndpoint =
      message.lifecycleEvent === 'azure-signalr-redirect'
        ? message.lifecycleDetail || message.endpoint
        : message.endpoint;
    if (message.lifecycleEvent === 'azure-signalr-redirect') {
      connection.azureEndpoint = message.lifecycleDetail;
    }
    state.connections.push(connection);
    queueNegotiation(state, endpointKey(negotiationEndpoint), connection);
    return connection;
  }

  function shouldStartConnection(connection, message, parsed) {
    const endsTransport =
      message.lifecycleEvent === 'transport-close' || message.lifecycleEvent === 'transport-error';
    const startsHandshake = parsed?.records?.some((record) => record.kind === 'Handshake');
    const startsTransport = message.lifecycleEvent === 'transport-open';
    return (
      !connection ||
      (connection.closed && !endsTransport) ||
      (startsHandshake && connection.handshakeRequested) ||
      (startsTransport && connection.transport && connection.status === 'connected')
    );
  }

  function findDualObserverConnection(state, message, normalizedEndpoint, messageKeyKind) {
    if (message.lifecycleEvent !== 'transport-open' || message.transport !== 'server-sent events') {
      return null;
    }
    return [...state.connections]
      .reverse()
      .find(
        (candidate) =>
          !candidate.closed &&
          candidate.status === 'connected' &&
          candidate.transport === 'server-sent events' &&
          candidate.keyKind !== null &&
          candidate.keyKind !== messageKeyKind &&
          endpointKey(candidate.endpoint) === normalizedEndpoint,
      );
  }

  function findPreviousTransport(state, normalizedEndpoint) {
    return [...state.connections]
      .reverse()
      .find(
        (candidate) =>
          endpointKey(candidate.endpoint) === normalizedEndpoint && candidate.transport,
      );
  }

  function appendReconnectEvent(state, connection, previous, message) {
    if (
      previous?.closed &&
      previous.id !== connection.id &&
      previous.transport !== message.transport &&
      message.timestamp - (previous.endedAt ?? previous.startedAt) <= 30_000
    ) {
      pushConnectionEvent(state, connection, message, {
        kind: 'transport-fallback',
        label: 'Transport fallback',
        detail: `${previous.transport} → ${message.transport}`,
      });
    } else if (previous?.closed && previous.id !== connection.id) {
      pushConnectionEvent(state, connection, message, {
        kind: 'reconnect',
        label: 'Reconnect observed',
        detail: message.transport,
      });
    }
  }

  function observeNewConnection(state, message, normalizedEndpoint, connectionKey) {
    // A live Server-Sent Events connection can be reported by two observers at once. Attach the
    // second transport-open to the existing connection instead of splitting the conversation.
    const messageKeyKind = connectionKey.startsWith('captured\n') ? 'captured' : 'heuristic';
    const dualObserver = findDualObserverConnection(
      state,
      message,
      normalizedEndpoint,
      messageKeyKind,
    );
    const previous = dualObserver ? null : findPreviousTransport(state, normalizedEndpoint);
    if (dualObserver) {
      state.currentByConnection.set(connectionKey, dualObserver);
      return { connection: dualObserver, mergedDuplicateOpen: true };
    }
    const connection = startConnection(state, message);
    connection.keyKind = messageKeyKind;
    appendReconnectEvent(state, connection, previous, message);
    return { connection, mergedDuplicateOpen: false };
  }

  function resolveMessageConnection(state, message, parsed) {
    const normalizedEndpoint = endpointKey(message.endpoint);
    const connectionKey = observedConnectionKey(message);
    if (['negotiate', 'azure-signalr-redirect'].includes(message.lifecycleEvent)) {
      return {
        connection: processNegotiation(state, message, normalizedEndpoint),
        mergedDuplicateOpen: false,
      };
    }
    const connection = state.currentByConnection.get(connectionKey);
    if (shouldStartConnection(connection, message, parsed)) {
      return observeNewConnection(state, message, normalizedEndpoint, connectionKey);
    }
    return { connection, mergedDuplicateOpen: false };
  }

  function applyConnectionLifecycle(state, connection, message, mergedDuplicateOpen) {
    if (!message.lifecycleEvent) {
      return;
    }
    const label = lifecycleLabel(message.lifecycleEvent);
    if (label && !mergedDuplicateOpen) {
      pushConnectionEvent(state, connection, message, {
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
      connection.status = message.lifecycleEvent === 'transport-error' ? 'error' : 'disconnected';
      connection.endedAt = message.timestamp;
      connection.closed = true;
    }
  }

  function recordHandshake(state, connection, message, record) {
    connection.handshakeRequested = true;
    pushConnectionEvent(state, connection, message, {
      kind: 'handshake',
      label: 'Handshake requested',
      detail: record.summary,
    });
  }

  function recordHandshakeResult(state, connection, message, record) {
    connection.handshakeAccepted = record.kind === 'Handshake response';
    connection.status = connection.handshakeAccepted ? 'connected' : 'error';
    pushConnectionEvent(state, connection, message, {
      kind: connection.handshakeAccepted ? 'handshake-accepted' : 'handshake-error',
      label: connection.handshakeAccepted ? 'Handshake accepted' : 'Handshake failed',
      detail: record.summary,
    });
  }

  function markHubFrame(connection, value) {
    if (!Number.isInteger(value.type) || value.type < 1 || value.type > 9) {
      return;
    }
    connection.sawHubFrames = true;
    if (value.type !== 6) {
      connection.sawNonPingHubFrame = true;
    }
  }

  function recordPing(state, connection, message) {
    let stats = state.pingStatsByConnection.get(connection.id);
    if (!stats) {
      stats = {
        count: 0,
        gaps: [],
        lastAt: null,
        event: pushConnectionEvent(state, connection, message, {
          kind: 'ping',
          label: 'Keep-alive pings',
        }),
      };
      state.pingStatsByConnection.set(connection.id, stats);
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
  }

  function recordClose(state, connection, message, value) {
    connection.status = value.allowReconnect ? 'reconnect allowed' : 'closed';
    connection.endedAt = message.timestamp;
    connection.closed = true;
    // A Close frame ends the logical connection; a later Sequence on this endpoint is a different
    // connection, never a stateful resume of this one.
    connection.gracefulClose = true;
    pushConnectionEvent(state, connection, message, {
      kind: 'close',
      label: value.allowReconnect ? 'Connection closed; reconnect allowed' : 'Connection closed',
      detail: value.error || '',
    });
  }

  function recordAcknowledgement(state, connection, message, value) {
    const validSequenceId = Number.isInteger(value.sequenceId);
    const channel = message.direction === 'incoming' ? connection.outbound : connection.inbound;
    if (validSequenceId) {
      channel.acknowledgedThrough = value.sequenceId;
    }
    pushConnectionEvent(state, connection, message, {
      kind: 'ack',
      label: 'Stateful reconnect acknowledgement',
      detail: `${message.direction === 'incoming' ? 'Outbound' : 'Inbound'} delivered through ${validSequenceId ? `#${value.sequenceId}` : '(invalid sequenceId)'}`,
    });
  }

  function recordSequence({ state, connection, message, value, priorNonPingHubFrame }) {
    let activeConnection = connection;
    // A resume's Sequence must be the first non-ping hub frame on the transport; after any other
    // hub traffic this Sequence cannot open a stateful resume.
    if (!priorNonPingHubFrame) {
      activeConnection = mergeStatefulResume(state, connection, message) ?? connection;
    }
    const validSequenceId = Number.isInteger(value.sequenceId);
    const channel =
      message.direction === 'outgoing' ? activeConnection.outbound : activeConnection.inbound;
    const previous = channel.resumesAt;
    if (validSequenceId) {
      channel.resumesAt = value.sequenceId;
    }
    const detail = `${message.direction === 'outgoing' ? 'Outbound' : 'Inbound'} resumes at ${validSequenceId ? `#${value.sequenceId}` : '(invalid sequenceId)'}${validSequenceId && previous !== null ? ` (previously #${previous})` : ''}`;
    pushConnectionEvent(state, activeConnection, message, {
      kind: 'sequence',
      label: 'Stateful reconnect sequence',
      detail,
    });
    return activeConnection;
  }

  function processConnectionRecord(state, connection, message, record) {
    if (record.kind === 'Handshake') {
      recordHandshake(state, connection, message, record);
      return connection;
    }
    if (record.kind === 'Handshake response' || record.kind === 'Handshake error') {
      recordHandshakeResult(state, connection, message, record);
      return connection;
    }
    // Object() preserves decoded objects and makes every other record a no-op dispatch target.
    const value = Object(record?.value);
    const priorNonPingHubFrame = connection.sawNonPingHubFrame;
    markHubFrame(connection, value);
    if (value.type === 6) {
      recordPing(state, connection, message);
    } else if (value.type === 7) {
      recordClose(state, connection, message, value);
    } else if (value.type === 8) {
      recordAcknowledgement(state, connection, message, value);
    } else if (value.type === 9) {
      return recordSequence({ state, connection, message, value, priorNonPingHubFrame });
    }
    return connection;
  }

  function analyzeConnectionMessage(state, message, parsed) {
    const { connection: initialConnection, mergedDuplicateOpen } = resolveMessageConnection(
      state,
      message,
      parsed,
    );
    let connection = initialConnection;
    state.connectionByMessage.set(message.id, connection.id);
    messageInfoFor(state.messageInfo, message.id).connectionId = connection.id;
    applyConnectionLifecycle(state, connection, message, mergedDuplicateOpen);
    for (const record of parsed?.records ?? []) {
      connection = processConnectionRecord(state, connection, message, record);
    }
  }

  function analyzeConnections(messages, parsedByMessage, messageInfo) {
    const state = createConnectionAnalysisState(messageInfo);
    for (const message of messages) {
      analyzeConnectionMessage(state, message, parsedByMessage.get(message));
    }
    return {
      connectionByMessage: state.connectionByMessage,
      connections: state.connections,
      timeline: state.timeline,
    };
  }

  function flowKey(connectionId, direction, invocationId) {
    return `${connectionId}\n${direction}\n${invocationId}`;
  }

  function startInvocationFlow(pending, connectionId, message, value) {
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
  }

  function recordStreamItem(context, value) {
    const { pending, connectionId, message, info, messageInfo } = context;
    const flow = pending.get(
      flowKey(connectionId, oppositeDirection(message.direction), value.invocationId),
    );
    if (flow?.type !== 4) {
      return;
    }
    flow.items.push({ messageId: message.id, timestamp: message.timestamp });
    info.streamParentId = flow.messageId;
    const parentInfo = messageInfoFor(messageInfo, flow.messageId);
    if (!parentInfo.streamChildren.includes(message.id)) {
      parentInfo.streamChildren.push(message.id);
    }
    addRelated(info, flow.messageId);
  }

  function recordInvocationCompletion(pending, connectionId, message, value) {
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
  }

  function recordFlowValue(context, value) {
    const { pending, connectionId, message } = context;
    if (INVOCATION_TYPES.has(value.type) && value.invocationId !== undefined) {
      startInvocationFlow(pending, connectionId, message, value);
      return;
    }

    if (value.type === 2 && value.invocationId !== undefined) {
      recordStreamItem(context, value);
      return;
    }

    if (value.type === 3 && value.invocationId !== undefined) {
      recordInvocationCompletion(pending, connectionId, message, value);
      return;
    }

    if (value.type === 5 && value.invocationId !== undefined) {
      // A cancellation without a tracked invocation updates only a discarded empty object.
      const flow = Object(
        pending.get(flowKey(connectionId, message.direction, value.invocationId)),
      );
      flow.cancelled = true;
      flow.completion = { messageId: message.id, timestamp: message.timestamp };
    }
  }

  function streamRateLabel(flow) {
    if (flow.items.length <= 1) {
      return '';
    }
    const interval = flow.items.at(-1).timestamp - flow.items[0].timestamp;
    return interval > 0 ? ` · ${((flow.items.length - 1) / (interval / 1_000)).toFixed(1)}/s` : '';
  }

  function streamingFlowLabel(flow, duration) {
    const itemCount = flow.items.length;
    const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    const rateLabel = streamRateLabel(flow);
    if (!flow.completion) {
      return `Streaming · ${itemLabel}${rateLabel}`;
    }
    const status = flow.cancelled ? 'Cancelled' : flow.completion.error ? 'Error' : 'Completed';
    return `${status} · ${itemLabel}${rateLabel} · ${formatDuration(duration)}`;
  }

  function invocationFlowLabel(flow, duration) {
    if (flow.type === 4) {
      return streamingFlowLabel(flow, duration);
    }
    if (!flow.completion) {
      return `Pending #${flow.invocationId}`;
    }
    if (flow.cancelled) {
      return `Cancelled · ${formatDuration(duration)}`;
    }
    if (flow.completion.error) {
      return `Error · ${formatDuration(duration)}`;
    }
    return `Completed · ${formatDuration(duration)}`;
  }

  function decorateInvocationFlow(flow, messageInfo) {
    const invocationInfo = messageInfoFor(messageInfo, flow.messageId);
    const duration = flow.completion ? flow.completion.timestamp - flow.startedAt : null;
    invocationInfo.flowLabels.push(invocationFlowLabel(flow, duration));
    if (!flow.completion) {
      return;
    }
    const completionInfo = messageInfoFor(messageInfo, flow.completion.messageId);
    completionInfo.flowLabels.push(`↩ ${flow.target || 'Invocation'} #${flow.invocationId}`);
    addRelated(invocationInfo, flow.completion.messageId);
    addRelated(completionInfo, flow.messageId);
  }

  function analyzeFlows(messages, parsedByMessage, connectionByMessage, messageInfo) {
    const pending = new Map();
    for (const message of messages) {
      const context = {
        pending,
        connectionId: connectionByMessage.get(message.id),
        message,
        info: messageInfoFor(messageInfo, message.id),
        messageInfo,
      };
      for (const value of recordValues(parsedByMessage.get(message))) {
        recordFlowValue(context, value);
      }
    }
    for (const flow of pending.values()) {
      decorateInvocationFlow(flow, messageInfo);
    }
    return [...pending.values()];
  }

  function collectHubMessageStats(messages, parsedByMessage) {
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
    return { capturedBytes, hubMessages, methodCounts };
  }

  function summarizeMethods(methodCounts, hubMessageCount) {
    return [...methodCounts]
      .map(([target, count]) => ({
        target,
        count,
        percentage: hubMessageCount === 0 ? 0 : (count / hubMessageCount) * 100,
      }))
      .sort((left, right) => right.count - left.count || left.target.localeCompare(right.target));
  }

  function collectLargePayloadWarnings(messages, parsedByMessage, warnings) {
    for (const message of messages) {
      const hubRecords = recordValues(parsedByMessage.get(message)).filter((value) =>
        Number.isInteger(value.type),
      );
      if (
        message.direction !== 'outgoing' ||
        !Number.isFinite(message.size) ||
        message.size < LARGE_PAYLOAD_WARNING_SIZE ||
        hubRecords.length !== 1
      ) {
        continue;
      }
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

  function collectPendingInvocationWarnings(messages, connections, flows, warnings) {
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
  }

  function appendKeepAliveGapWarning(warnings, message, gapDetails) {
    const { gap, baseline, warningThreshold } = gapDetails;
    if (gap <= warningThreshold) {
      return;
    }
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

  function recordKeepAlive(warnings, pingHistory, connectionId, message) {
    const history = pingHistory.get(connectionId) ?? { lastAt: null, gaps: [] };
    if (history.lastAt !== null) {
      const gap = Math.max(0, message.timestamp - history.lastAt);
      const baseline = history.gaps.length >= 2 ? median(history.gaps) : null;
      const warningThreshold =
        baseline === null ? DEFAULT_KEEP_ALIVE_GAP_WARNING_MS : Math.max(20_000, baseline * 1.75);
      appendKeepAliveGapWarning(warnings, message, { gap, baseline, warningThreshold });
      history.gaps.push(gap);
    }
    history.lastAt = message.timestamp;
    pingHistory.set(connectionId, history);
  }

  function collectKeepAliveWarnings(messages, parsedByMessage, messageInfo, warnings) {
    const pingHistory = new Map();
    for (const message of messages) {
      const connectionId = messageInfo.get(message.id)?.connectionId;
      if (!connectionId) {
        continue;
      }
      for (const value of recordValues(parsedByMessage.get(message))) {
        if (value.type === 6) {
          recordKeepAlive(warnings, pingHistory, connectionId, message);
        }
      }
    }
  }

  function analyzeInsights({ messages, parsedByMessage, connections, flows, messageInfo }) {
    const { capturedBytes, hubMessages, methodCounts } = collectHubMessageStats(
      messages,
      parsedByMessage,
    );
    const firstTimestamp = hubMessages[0]?.message.timestamp ?? null;
    const lastTimestamp = hubMessages.at(-1)?.message.timestamp ?? null;
    const durationMs =
      firstTimestamp === null || lastTimestamp === null
        ? 0
        : Math.max(0, lastTimestamp - firstTimestamp);
    const durationSeconds = durationMs / 1_000;
    const warnings = [];
    collectLargePayloadWarnings(messages, parsedByMessage, warnings);
    collectPendingInvocationWarnings(messages, connections, flows, warnings);
    collectKeepAliveWarnings(messages, parsedByMessage, messageInfo, warnings);
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
      methods: summarizeMethods(methodCounts, hubMessages.length),
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
    // Keep these explicit assignments detectable as synthetic named exports for Node ESM.
    module.exports.analyze = analyze;
    module.exports.formatDuration = formatDuration;
  }
})(globalThis);
