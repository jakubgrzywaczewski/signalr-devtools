import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    dispatch(...args) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function loadDevtools() {
  const create = vi.fn();
  const requestFinished = event();
  const navigated = event();
  const observer = { observe: vi.fn(), reset: vi.fn() };
  const createObserver = vi.fn(() => observer);
  const sendMessage = vi.fn(() => Promise.resolve());
  const source = readFileSync(path.resolve('devtools.js'), 'utf8');

  vm.runInNewContext(source, {
    chrome: {
      devtools: {
        inspectedWindow: { tabId: 42 },
        network: { onRequestFinished: requestFinished, onNavigated: navigated },
        panels: { create },
      },
      runtime: { sendMessage },
    },
    console,
    SignalRLongPolling: { createObserver },
  });

  return { create, createObserver, navigated, observer, requestFinished, sendMessage };
}

describe('DevTools panel registration', () => {
  it('loads the Long Polling observer before the DevTools bridge', () => {
    const html = readFileSync(path.resolve('devtools.html'), 'utf8');

    expect(html.indexOf('longPolling.js')).toBeGreaterThan(-1);
    expect(html.indexOf('longPolling.js')).toBeLessThan(html.indexOf('devtools.js'));
  });

  it('registers the panel with an existing icon and page', () => {
    const { create } = loadDevtools();

    expect(create).toHaveBeenCalledWith(
      'SignalR Inspector',
      'icons/icon32.png',
      'panel.html',
      expect.any(Function),
    );
  });

  it('observes finished requests and resets correlation after navigation', () => {
    const { navigated, observer, requestFinished } = loadDevtools();
    const request = { request: { url: 'https://localhost/chatHub' } };

    requestFinished.dispatch(request);
    navigated.dispatch('https://localhost/');

    expect(observer.observe).toHaveBeenCalledWith(request);
    expect(observer.reset).toHaveBeenCalledOnce();
  });

  it('forwards captured messages with the inspected tab identity', () => {
    const { createObserver, sendMessage } = loadDevtools();
    const options = createObserver.mock.calls[0][0];
    const payload = { transport: 'long polling' };

    options.publish(payload);

    expect(sendMessage).toHaveBeenCalledWith({
      source: 'signalr-inspector',
      type: 'devtools-signalr-message',
      tabId: 42,
      payload,
    });
  });
});
