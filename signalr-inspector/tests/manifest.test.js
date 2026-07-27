import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('../manifest.json');

describe('manifest.json', () => {
  it('contains expected metadata', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('SignalR Inspector');
    expect(manifest.author).toBe('Jakub Grzywaczewski');
    expect(manifest.version).toBe('0.3.0');
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(111);
  });

  it('exposes the DevTools panel and scripts', () => {
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts[0].js).toContain('contentScript.js');
    expect(manifest.content_scripts[1]).toMatchObject({
      js: ['injected.js'],
      run_at: 'document_start',
      world: 'MAIN',
    });
  });

  it('requests only the host access required to observe page traffic', () => {
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
});
