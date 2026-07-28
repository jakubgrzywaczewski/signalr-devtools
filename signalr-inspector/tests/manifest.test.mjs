import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manifest = require('../manifest.json');
const packageMetadata = require('../package.json');

describe('manifest.json', () => {
  it('contains expected metadata', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('SignalR Inspector');
    expect(manifest.author).toBe('Jakub Grzywaczewski');
    expect(manifest.homepage_url).toBe('https://github.com/jakubgrzywaczewski/signalr-devtools');
    expect(manifest.version).toBe(packageMetadata.version);
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(111);
  });

  it('exposes the DevTools panel and an explicit tab action', () => {
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(manifest.action.default_title).toContain('Enable SignalR Inspector');
  });

  it('uses temporary active-tab access instead of broad host permissions', () => {
    expect(manifest.permissions).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
  });
});
