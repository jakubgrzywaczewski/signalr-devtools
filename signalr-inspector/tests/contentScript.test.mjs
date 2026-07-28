import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptUrl = pathToFileURL(path.resolve(process.cwd(), 'contentScript.js'));

async function loadContentScript() {
  await import(`${contentScriptUrl.href}?cacheBust=${Date.now()}-${Math.random()}`);
}

function validMessage(overrides = {}) {
  return {
    source: 'signalr-inspector',
    type: 'signalr-message',
    payload: {
      transport: 'websocket',
      direction: 'outgoing',
      endpoint: 'https://localhost/chatHub',
      timestamp: Date.now(),
      size: 5,
      encoding: 'text',
      preview: 'hello',
      textPayload: 'hello',
      ...overrides,
    },
  };
}

describe('contentScript', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://localhost/',
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.MessageEvent = dom.window.MessageEvent;
    globalThis.chrome = { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } };
  });

  it('forwards valid inspector messages', async () => {
    await loadContentScript();
    const message = validMessage();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: message,
      }),
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(message);
  });

  it('accepts Long Polling as a supported transport', async () => {
    await loadContentScript();
    const message = validMessage({ transport: 'long polling' });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: message,
      }),
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(message);
  });

  it('drops unexpected fields at the page boundary', async () => {
    await loadContentScript();
    const message = validMessage({ injectedField: { large: 'object' } });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: message,
      }),
    );

    expect(chrome.runtime.sendMessage.mock.calls[0][0].payload.injectedField).toBeUndefined();
  });

  it('installs only one bridge when multiple registrations execute the script', async () => {
    await loadContentScript();
    await loadContentScript();
    const message = validMessage();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: message,
      }),
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it('silences delivery failures after the extension context is invalidated', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('Extension context invalidated'));
    await loadContentScript();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: validMessage(),
      }),
    );

    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    validMessage({ transport: 'fetch' }),
    validMessage({ direction: 'sideways' }),
    validMessage({ timestamp: 'now' }),
    validMessage({ endpoint: 'x'.repeat(4097) }),
    validMessage({ textPayload: 'x'.repeat(350_001) }),
    validMessage({ truncated: 'yes' }),
    { source: 'another-extension', type: 'signalr-message', payload: {} },
  ])('rejects malformed or unrelated messages', async (message) => {
    await loadContentScript();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: message,
      }),
    );

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
