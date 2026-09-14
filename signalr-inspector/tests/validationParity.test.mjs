import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import sessionFormat from '../sessionFormat.js';

const contentScriptSource = readFileSync(path.resolve('contentScript.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('background.js'), 'utf8');
const maximumString = 'x'.repeat(350_000);
const oversizedString = 'x'.repeat(350_001);

function extensionEvent() {
  return { addListener: () => undefined };
}

function loadContentScriptValidator() {
  let messageListener;
  let delivered = false;
  const pageWindow = {
    location: { origin: 'https://localhost' },
    addEventListener(type, listener) {
      if (type === 'message') {
        messageListener = listener;
      }
    },
  };
  const context = {
    chrome: {
      runtime: {
        sendMessage() {
          delivered = true;
        },
      },
    },
    window: pageWindow,
  };
  vm.runInNewContext(contentScriptSource, context);
  return (payload) => {
    delivered = false;
    messageListener({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: { source: 'signalr-inspector', type: 'signalr-message', payload },
    });
    return delivered;
  };
}

function loadBackgroundValidator() {
  const context = {
    chrome: {
      action: { onClicked: extensionEvent() },
      runtime: {
        getURL: (file) => `chrome-extension://extension-id/${file}`,
        id: 'extension-id',
        onConnect: extensionEvent(),
        onMessage: extensionEvent(),
      },
      scripting: {},
      tabs: { onRemoved: extensionEvent(), onUpdated: extensionEvent() },
    },
    console,
    importScripts: () => undefined,
    SignalRInspectorActivation: {},
    SignalRSessionFormat: sessionFormat,
  };
  context.globalThis = context;
  vm.runInNewContext(`${backgroundSource}\nglobalThis.__isValidPayload = isValidPayload;`, context);
  return context.__isValidPayload;
}

function validPayload(overrides = {}) {
  return {
    transport: 'websocket',
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    timestamp: 1,
    size: 5,
    encoding: 'text',
    preview: 'hello',
    textPayload: 'hello',
    ...overrides,
  };
}

function lifecyclePayload(overrides = {}) {
  return validPayload({
    encoding: 'lifecycle',
    lifecycleEvent: 'transport-open',
    lifecycleDetail: 'WebSocket connected',
    size: 0,
    textPayload: undefined,
    ...overrides,
  });
}

function throwingPayload() {
  const payload = validPayload();
  Object.defineProperty(payload, 'transport', {
    get() {
      throw new Error('payload getter failed');
    },
  });
  return payload;
}

const validationCases = [
  ['null', () => null, 'rejected'],
  ['undefined', () => undefined, 'rejected'],
  ['number', () => 42, 'rejected'],
  ['string', () => 'payload', 'rejected'],
  ['array', () => [], 'rejected'],
  ['object without a prototype', () => Object.create(null), 'rejected'],
  ['transport absent', () => validPayload({ transport: undefined }), 'rejected'],
  ['transport valid', () => validPayload({ transport: 'long polling' }), 'accepted'],
  ['transport invalid', () => validPayload({ transport: 'fetch' }), 'rejected'],
  ['direction absent', () => validPayload({ direction: undefined }), 'rejected'],
  ['direction valid', () => validPayload({ direction: 'outgoing' }), 'accepted'],
  ['direction invalid', () => validPayload({ direction: 'sideways' }), 'rejected'],
  ['lifecycle event absent', () => validPayload({ lifecycleEvent: undefined }), 'accepted'],
  ['lifecycle event valid', () => lifecyclePayload(), 'accepted'],
  ['lifecycle event invalid', () => lifecyclePayload({ lifecycleEvent: 'unknown' }), 'rejected'],
  ['timestamp NaN', () => validPayload({ timestamp: Number.NaN }), 'rejected'],
  ['timestamp Infinity', () => validPayload({ timestamp: Number.POSITIVE_INFINITY }), 'rejected'],
  ['timestamp string', () => validPayload({ timestamp: 'now' }), 'rejected'],
  ['size negative', () => validPayload({ size: -1 }), 'rejected'],
  ['size null', () => validPayload({ size: null }), 'accepted'],
  ['size non-numeric', () => validPayload({ size: '5' }), 'rejected'],
  [
    'lifecycle encoding without event',
    () => validPayload({ encoding: 'lifecycle', textPayload: undefined }),
    'rejected',
  ],
  [
    'lifecycle event without lifecycle encoding',
    () => validPayload({ lifecycleEvent: 'transport-open', lifecycleDetail: '' }),
    'rejected',
  ],
  ['lifecycle detail orphaned', () => validPayload({ lifecycleDetail: 'orphaned' }), 'rejected'],
  ['lifecycle detail paired', () => lifecyclePayload({ lifecycleDetail: '' }), 'accepted'],
  [
    'lifecycle detail at its limit',
    () => lifecyclePayload({ lifecycleDetail: 'x'.repeat(4096) }),
    'accepted',
  ],
  [
    'lifecycle detail over its limit',
    () => lifecyclePayload({ lifecycleDetail: 'x'.repeat(4097) }),
    'rejected',
  ],
  ['unknown extra field', () => validPayload({ unknown: { nested: true } }), 'accepted'],
  ['preview at string limit', () => validPayload({ preview: maximumString }), 'accepted'],
  ['preview over string limit', () => validPayload({ preview: oversizedString }), 'rejected'],
  ['text payload at string limit', () => validPayload({ textPayload: maximumString }), 'accepted'],
  [
    'text payload over string limit',
    () => validPayload({ textPayload: oversizedString }),
    'rejected',
  ],
  [
    'base64 payload at string limit',
    () => validPayload({ base64Payload: maximumString }),
    'accepted',
  ],
  [
    'base64 payload over string limit',
    () => validPayload({ base64Payload: oversizedString }),
    'rejected',
  ],
  ['encoding at string limit', () => validPayload({ encoding: maximumString }), 'accepted'],
  ['encoding over string limit', () => validPayload({ encoding: oversizedString }), 'rejected'],
  ['error at string limit', () => validPayload({ error: maximumString }), 'accepted'],
  ['error over string limit', () => validPayload({ error: oversizedString }), 'rejected'],
  [
    'lifecycle detail at general string limit',
    () => lifecyclePayload({ lifecycleDetail: maximumString }),
    'rejected',
  ],
  [
    'lifecycle detail over general string limit',
    () => lifecyclePayload({ lifecycleDetail: oversizedString }),
    'rejected',
  ],
  ['throwing getter', throwingPayload, 'throws:payload getter failed'],
];

function validatorOutcome(validate, payload) {
  try {
    return validate(payload) ? 'accepted' : 'rejected';
  } catch (error) {
    return `throws:${error instanceof Error ? error.message : String(error)}`;
  }
}

function sessionFormatOutcome(payload) {
  try {
    sessionFormat.create([payload], '2026-09-14T00:00:00.000Z');
    return 'accepted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith('Invalid SignalR Inspector session:')
      ? 'rejected'
      : `throws:${message}`;
  }
}

describe('captured-message validation parity', () => {
  it.each(validationCases)('%s', (_name, createPayload, expected) => {
    const contentScriptOutcome = validatorOutcome(loadContentScriptValidator(), createPayload());
    const backgroundOutcome = validatorOutcome(loadBackgroundValidator(), createPayload());
    const importedSessionOutcome = sessionFormatOutcome(createPayload());

    expect(backgroundOutcome).toBe(contentScriptOutcome);
    expect(importedSessionOutcome).toBe(contentScriptOutcome);
    expect(contentScriptOutcome).toBe(expected);
  });
});
