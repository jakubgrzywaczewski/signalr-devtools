import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('../manifest.json');

describe('manifest.json', () => {
  it('contains expected metadata', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('SignalR Inspector');
    expect(manifest.author).toBe('Jakub Grzywaczewski');
  });

  it('exposes the DevTools panel and scripts', () => {
    expect(manifest.devtools_page).toBe('devtools.html');
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts[0].js).toContain('contentScript.js');
    expect(manifest.web_accessible_resources[0].resources).toContain('injected.js');
  });
});
