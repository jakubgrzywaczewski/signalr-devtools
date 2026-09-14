import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analysisModules,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  browserGlobalReferences,
} from '../scripts/analysis-package.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function createModuleDirectories() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-analysis-gate-'));
  const sourceDirectory = path.join(temporaryDirectory, 'source');
  const packagedDirectory = path.join(temporaryDirectory, 'packaged');
  await Promise.all([mkdir(sourceDirectory), mkdir(packagedDirectory)]);
  for (const moduleName of analysisModules) {
    const source = `'use strict';\nmodule.exports = { moduleName: '${moduleName}' };\n`;
    await Promise.all([
      writeFile(path.join(sourceDirectory, moduleName), source),
      writeFile(path.join(packagedDirectory, moduleName), source),
    ]);
  }
  return { packagedDirectory, sourceDirectory, temporaryDirectory };
}

describe('public analysis package gates', () => {
  it('keeps the extension private and the analysis package independently publishable', async () => {
    const extensionManifest = JSON.parse(
      await readFile(path.join(testDirectory, '../package.json'), 'utf8'),
    );
    const analysisManifest = JSON.parse(
      await readFile(path.join(testDirectory, '../../packages/analysis/package.json'), 'utf8'),
    );

    expect(extensionManifest.private).toBe(true);
    expect(analysisManifest).toMatchObject({
      name: '@signalr-devtools/analysis',
      version: '0.1.0',
      type: 'commonjs',
      main: './signalrAnalysis.js',
      publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      },
    });
    expect(analysisManifest.version).not.toBe(extensionManifest.version);
    expect(analysisManifest.files.toSorted()).toEqual(analysisModules);
  });

  it('ignores prose and comments but checks code inside template expressions', () => {
    const source = `
      const message = 'invalid document identity';
      // window and chrome are mentioned in documentation.
      const rendered = \`value: \${globalThis.document.title}\`;
    `;

    expect(browserGlobalReferences(source)).toEqual([
      expect.objectContaining({ identifier: 'document' }),
    ]);
  });

  it('turns the purity gate red for a browser global and green after it is removed', async () => {
    const fixture = await createModuleDirectories();
    const sourcePath = path.join(fixture.sourceDirectory, 'signalrAnalysis.js');
    try {
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).resolves.toBeUndefined();

      await writeFile(sourcePath, 'module.exports = globalThis.document.body;\n');
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).rejects.toThrow(
        'signalrAnalysis.js:1:29 references forbidden browser global "document"',
      );

      await writeFile(sourcePath, 'module.exports = {};\n');
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).resolves.toBeUndefined();
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('turns the divergence gate red for stale packaged bytes and green after synchronization', async () => {
    const fixture = await createModuleDirectories();
    const moduleName = 'signalrProtocol.js';
    const sourcePath = path.join(fixture.sourceDirectory, moduleName);
    const packagedPath = path.join(fixture.packagedDirectory, moduleName);
    try {
      await expect(
        assertMatchingAnalysisSources(fixture.sourceDirectory, fixture.packagedDirectory),
      ).resolves.toBeUndefined();

      await writeFile(sourcePath, 'module.exports = { changed: true };\n');
      await expect(
        assertMatchingAnalysisSources(fixture.sourceDirectory, fixture.packagedDirectory),
      ).rejects.toThrow(`${moduleName}: packaged bytes differ from the extension source`);

      await copyFile(sourcePath, packagedPath);
      await expect(
        assertMatchingAnalysisSources(fixture.sourceDirectory, fixture.packagedDirectory),
      ).resolves.toBeUndefined();
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });
});
