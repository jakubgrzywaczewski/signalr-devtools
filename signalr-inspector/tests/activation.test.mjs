import { describe, expect, it, vi } from 'vitest';
import activation from '../activation.js';

describe('tab activation', () => {
  it.each([
    ['https://example.com/chat?x=1', 'https://example.com/*'],
    ['http://localhost:5178/', 'http://localhost/*'],
    ['http://127.0.0.1:5178/', 'http://127.0.0.1/*'],
    ['http://[::1]:5178/', 'http://[::1]/*'],
  ])('creates a host-only match pattern for %s', (url, expected) => {
    expect(activation.matchPatternForUrl(url)).toBe(expected);
  });

  it.each(['chrome://extensions', 'file:///tmp/index.html', 'not a URL'])(
    'rejects unsupported page URL %s',
    (url) => {
      expect(activation.matchPatternForUrl(url)).toBeNull();
    },
  );

  it('registers isolated and MAIN-world scripts before reloading the tab', async () => {
    const calls = [];
    const chromeApi = {
      scripting: {
        unregisterContentScripts: vi.fn(() => {
          calls.push('unregister');
          return Promise.resolve();
        }),
        registerContentScripts: vi.fn((registrations) => {
          calls.push('register');
          expect(registrations).toEqual([
            expect.objectContaining({
              id: 'signalr-bridge-42',
              js: ['contentScript.js'],
              matches: ['https://example.com/*'],
              persistAcrossSessions: false,
              runAt: 'document_start',
              world: 'ISOLATED',
            }),
            expect.objectContaining({
              id: 'signalr-main-42',
              js: ['injected.js'],
              matches: ['https://example.com/*'],
              persistAcrossSessions: false,
              runAt: 'document_start',
              world: 'MAIN',
            }),
          ]);
          return Promise.resolve();
        }),
      },
      tabs: {
        reload: vi.fn(() => {
          calls.push('reload');
          return Promise.resolve();
        }),
      },
    };

    await expect(
      activation.activateTab(chromeApi, { id: 42, url: 'https://example.com/chat' }),
    ).resolves.toBe('https://example.com/*');

    expect(calls).toEqual(['unregister', 'register', 'reload']);
    expect(chromeApi.tabs.reload).toHaveBeenCalledWith(42);
  });

  it('does not reload unsupported pages', async () => {
    const chromeApi = {
      scripting: {
        unregisterContentScripts: vi.fn(() => Promise.resolve()),
        registerContentScripts: vi.fn(),
      },
      tabs: { reload: vi.fn() },
    };

    await expect(
      activation.activateTab(chromeApi, { id: 7, url: 'chrome://extensions' }),
    ).rejects.toThrow('HTTP and HTTPS');
    expect(chromeApi.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(chromeApi.tabs.reload).not.toHaveBeenCalled();
  });

  it('deactivates and reloads an active tab when toggled', async () => {
    const chromeApi = {
      scripting: {
        getRegisteredContentScripts: vi.fn(() =>
          Promise.resolve([
            {
              id: 'signalr-bridge-42',
              matches: ['https://example.com/*'],
            },
            {
              id: 'signalr-main-42',
              matches: ['https://example.com/*'],
            },
          ]),
        ),
        unregisterContentScripts: vi.fn(() => Promise.resolve()),
      },
      tabs: { reload: vi.fn(() => Promise.resolve()) },
    };

    await expect(
      activation.toggleTab(chromeApi, { id: 42, url: 'https://example.com/chat' }),
    ).resolves.toBe('inactive');

    expect(chromeApi.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['signalr-bridge-42', 'signalr-main-42'],
    });
    expect(chromeApi.tabs.reload).toHaveBeenCalledWith(42);
  });

  it('activates an inactive tab when toggled', async () => {
    const chromeApi = {
      scripting: {
        getRegisteredContentScripts: vi.fn(() => Promise.resolve([])),
        unregisterContentScripts: vi.fn(() => Promise.resolve()),
        registerContentScripts: vi.fn(() => Promise.resolve()),
      },
      tabs: { reload: vi.fn(() => Promise.resolve()) },
    };

    await expect(
      activation.toggleTab(chromeApi, { id: 42, url: 'https://example.com/chat' }),
    ).resolves.toBe('active');

    expect(chromeApi.scripting.registerContentScripts).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.reload).toHaveBeenCalledWith(42);
  });

  it('rejects activation when the browser does not provide a valid tab ID', async () => {
    const chromeApi = {
      scripting: {
        unregisterContentScripts: vi.fn(),
        registerContentScripts: vi.fn(),
      },
      tabs: { reload: vi.fn() },
    };

    await expect(
      activation.activateTab(chromeApi, { url: 'https://example.com/chat' }),
    ).rejects.toThrow('could not be identified');
    expect(chromeApi.scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('deactivates valid tabs and tolerates stale or invalid registrations', async () => {
    const unregisterContentScripts = vi
      .fn()
      .mockRejectedValueOnce(new Error('registration already removed'))
      .mockResolvedValueOnce();
    const chromeApi = { scripting: { unregisterContentScripts } };

    await expect(activation.deactivateTab(chromeApi, 42)).resolves.toBeUndefined();
    await expect(activation.deactivateTab(chromeApi, -1)).resolves.toBeUndefined();
    await expect(activation.deactivateTab(chromeApi, 43)).resolves.toBeUndefined();

    expect(unregisterContentScripts).toHaveBeenCalledTimes(2);
    expect(unregisterContentScripts).toHaveBeenNthCalledWith(1, {
      ids: ['signalr-bridge-42', 'signalr-main-42'],
    });
    expect(unregisterContentScripts).toHaveBeenNthCalledWith(2, {
      ids: ['signalr-bridge-43', 'signalr-main-43'],
    });
  });
});
