import { describe, expect, it, vi } from 'vitest';
import activation from '../activation.js';

describe('tab activation', () => {
  it.each([
    ['https://example.com/chat?x=1', 'https://example.com/*'],
    ['http://localhost:5178/', 'http://localhost/*'],
    ['http://127.0.0.1:5178/', 'http://127.0.0.1/*'],
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
        unregisterContentScripts: vi.fn(async () => {
          calls.push('unregister');
        }),
        registerContentScripts: vi.fn(async (registrations) => {
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
        }),
      },
      tabs: {
        reload: vi.fn(async () => {
          calls.push('reload');
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
        unregisterContentScripts: vi.fn(),
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
});
