import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const biomeLauncher = path.resolve('node_modules/@biomejs/biome/bin/biome');

describe('extension security lint policy', () => {
  it('rejects unsafe extension capabilities', () => {
    const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), 'signalr-biome-policy-'));
    const fixturePath = path.join(fixtureDirectory, 'unsafe-extension.js');
    writeFileSync(
      fixturePath,
      `
const untrustedCode = 'alert(1)';
const element = document.createElement('div');
const untrustedHtml = '<img>';
const remoteUrl = 'https://example.com/collect';
eval(untrustedCode);
element.innerHTML = untrustedHtml;
fetch(remoteUrl);
chrome.permissions.request({ permissions: ['tabs'] });
`,
    );

    try {
      const result = spawnSync(
        process.execPath,
        [biomeLauncher, 'lint', fixturePath, '--diagnostic-level=error', '--max-diagnostics=none'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        },
      );
      const diagnostics = `${result.stdout}${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(diagnostics).toContain('must not evaluate dynamic JavaScript');
      expect(diagnostics).toContain('Unsafe HTML sinks are forbidden');
      expect(diagnostics).toContain('Unexpected outbound networking is forbidden');
      expect(diagnostics).toContain('Do not expand permissions');
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
