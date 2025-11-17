import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const contentScriptPath = path.resolve(process.cwd(), 'contentScript.js');
const contentScriptUrl = pathToFileURL(contentScriptPath);

async function loadContentScript() {
  await import(`${contentScriptUrl.href}?cacheBust=${Date.now()}`);
}

function bootstrapDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost/'
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.MessageEvent = dom.window.MessageEvent;
  globalThis.CustomEvent = dom.window.CustomEvent;
}

describe('contentScript', () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrapDom();
    globalThis.chrome = {
      runtime: {
        getURL: vi.fn().mockReturnValue('chrome-extension://test/injected.js'),
        sendMessage: vi.fn(),
      },
    };
  });

  it('injects the script only once', async () => {
    await loadContentScript();
    const scripts = document.querySelectorAll('script[data-signalr-inspector="true"]');
    expect(scripts.length).toBe(1);
    expect(scripts[0].src).toContain('chrome-extension://test/injected.js');

    await loadContentScript();
    const scriptsAfterSecondLoad = document.querySelectorAll('script[data-signalr-inspector="true"]');
    expect(scriptsAfterSecondLoad.length).toBe(1);
  });

  it('forwards signalr-inspector messages to the runtime', async () => {
    await loadContentScript();
    const payload = { source: 'signalr-inspector', type: 'signalr-message', payload: { hello: 'world' } };
    const event = new MessageEvent('message', { source: window, data: payload });
    window.dispatchEvent(event);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(payload);

    chrome.runtime.sendMessage.mockClear();
    const ignoredEvent = new MessageEvent('message', { source: window, data: { source: 'other' } });
    window.dispatchEvent(ignoredEvent);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
