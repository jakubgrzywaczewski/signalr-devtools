import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manifest = require('../manifest.json');
const packageMetadata = require('../package.json');

function pngDimensions(relativePath) {
  const data = readFileSync(path.resolve(relativePath));
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

describe('manifest.json', () => {
  it('contains expected metadata', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('SignalR Inspector');
    expect(manifest.author).toBe('Jakub Grzywaczewski');
    expect(manifest.homepage_url).toBeUndefined();
    expect(manifest.version).toBe(packageMetadata.version);
    expect(manifest.description).toBe(packageMetadata.description);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(111);
  });

  it('exposes the DevTools panel and an explicit tab action', () => {
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(manifest.action.default_title).toContain('Enable SignalR Inspector');
  });

  it('ships exact icon sizes used by Chromium surfaces', () => {
    expect(manifest.icons).toEqual({
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    });
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      expect(pngDimensions(iconPath)).toEqual({
        width: Number(size),
        height: Number(size),
      });
    }
  });

  it('uses temporary active-tab access instead of broad host permissions', () => {
    expect(manifest.permissions).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
  });
});
