import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analysisModules,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  assertPureJavaScript,
  prepareAnalysisPackage,
  runAnalysisNpmCommand,
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

  it('uses scopes and syntax to avoid false positives for non-global names', () => {
    const source = String.raw`
      function render(document, window, chrome) {
        const payload = { document, window, chrome };
        return payload.document || /document/.test('document');
      }
      function inspect(globalThis) {
        return globalThis.document;
      }
      render(1, 2, 3);
      inspect({ document: 1 });
      void globalThis.TextDecoder;
    `;

    expect(() => assertPureJavaScript(source)).not.toThrow();
  });

  it('rejects direct globals and computed or escaped globalThis access', () => {
    const violations = [
      'void document.body;',
      "void globalThis['document'];",
      "void globalThis['doc' + 'ument'];",
      String.raw`void globalThis.\u0064ocument;`,
      'void window.location;',
      "void globalThis['chrome'];",
      'const browser = globalThis; void browser.document;',
      '(function expose(root) { void root.document; })(globalThis);',
      'void globalThis[unknownProperty];',
    ];

    for (const source of violations) {
      expect(() => assertPureJavaScript(source)).toThrow('Analysis purity gate failed');
    }
  });

  it('turns the purity gate red for a browser global and green after it is removed', async () => {
    const fixture = await createModuleDirectories();
    const sourcePath = path.join(fixture.sourceDirectory, 'signalrAnalysis.js');
    try {
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).resolves.toBeUndefined();

      await writeFile(sourcePath, "module.exports = globalThis['document'].body;\n");
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).rejects.toThrow(
        'signalrAnalysis.js:1:18 accesses forbidden browser global "document" through globalThis',
      );

      await writeFile(sourcePath, 'module.exports = {};\n');
      await expect(assertPureAnalysisSources(fixture.sourceDirectory)).resolves.toBeUndefined();
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('rolls back copied modules when package preparation fails', async () => {
    const fixture = await createModuleDirectories();
    let copyCount = 0;
    const failingCopy = async (sourcePath, packagedPath) => {
      copyCount += 1;
      if (copyCount === 2) {
        throw new Error('controlled copy failure');
      }
      await copyFile(sourcePath, packagedPath);
    };
    try {
      await expect(
        prepareAnalysisPackage(fixture.sourceDirectory, fixture.packagedDirectory, failingCopy),
      ).rejects.toThrow('controlled copy failure');
      expect(await readdir(fixture.packagedDirectory)).toEqual([]);
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('cleans generated modules when the wrapped npm pack fails', async () => {
    const fixture = await createModuleDirectories();
    await writeFile(
      path.join(fixture.packagedDirectory, 'package.json'),
      `${JSON.stringify({ name: 'analysis-pack-failure', version: '1.0.0' })}\n`,
    );
    try {
      await expect(
        runAnalysisNpmCommand(
          'pack',
          ['--pack-destination', path.join(fixture.temporaryDirectory, 'missing/directory')],
          fixture.sourceDirectory,
          fixture.packagedDirectory,
        ),
      ).rejects.toThrow();
      expect(await readdir(fixture.packagedDirectory)).toEqual(['package.json']);
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
