import { EventEmitter } from 'node:events';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  analysisModules,
  analysisNpmStdioMode,
  assertAnalysisSourceDigest,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  assertPureJavaScript,
  bumpAnalysisPackageVersion,
  prepareAnalysisPackage,
  runAnalysisNpmCommand,
  writeAnalysisSourceDigest,
} from '../scripts/analysis-package.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sha256Pattern = /^[a-f0-9]{64}$/;
const analysisPackageMaintenanceFiles = [
  'LICENSE',
  'README.md',
  'package.json',
  'source-digest.json',
];

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

async function addPackageMetadata(fixture, name) {
  await Promise.all([
    writeFile(path.join(fixture.packagedDirectory, 'LICENSE'), 'fixture license\n'),
    writeFile(path.join(fixture.packagedDirectory, 'README.md'), '# Fixture package\n'),
    writeFile(
      path.join(fixture.packagedDirectory, 'package.json'),
      `${JSON.stringify({ name, version: '1.0.0', files: analysisModules })}\n`,
    ),
  ]);
  await writeAnalysisSourceDigest('1.0.0', fixture.sourceDirectory, fixture.packagedDirectory);
}

function stubSpawnResult(code, signal = null) {
  return vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', code, signal));
    return child;
  });
}

describe('public analysis package gates', () => {
  it('keeps the extension private and the analysis package independently publishable', async () => {
    const extensionManifest = JSON.parse(
      await readFile(path.join(testDirectory, '../package.json'), 'utf8'),
    );
    const analysisManifest = JSON.parse(
      await readFile(path.join(testDirectory, '../../packages/analysis/package.json'), 'utf8'),
    );
    const analysisSourceDigest = JSON.parse(
      await readFile(
        path.join(testDirectory, '../../packages/analysis/source-digest.json'),
        'utf8',
      ),
    );

    expect(extensionManifest.private).toBe(true);
    expect(analysisManifest).toMatchObject({
      name: '@signalr-devtools/analysis',
      type: 'commonjs',
      main: './signalrAnalysis.js',
      publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      },
    });
    expect(analysisManifest.version).toBe(analysisSourceDigest.version);
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
    await addPackageMetadata(fixture, 'analysis-pack-failure');
    try {
      await expect(
        runAnalysisNpmCommand(
          'pack',
          ['--pack-destination', path.join(fixture.temporaryDirectory, 'missing/directory')],
          {
            sourceDirectory: fixture.sourceDirectory,
            packagedDirectory: fixture.packagedDirectory,
          },
        ),
      ).rejects.toThrow();
      expect((await readdir(fixture.packagedDirectory)).toSorted()).toEqual(
        analysisPackageMaintenanceFiles,
      );
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('keeps machine-readable pack output available to parsing callers', async () => {
    const fixture = await createModuleDirectories();
    await addPackageMetadata(fixture, 'analysis-pack-json');
    try {
      const result = await runAnalysisNpmCommand('pack', ['--dry-run', '--json'], {
        sourceDirectory: fixture.sourceDirectory,
        packagedDirectory: fixture.packagedDirectory,
        stdioMode: 'capture',
      });
      const packResult = JSON.parse(result.stdout);

      expect(packResult).toHaveLength(1);
      expect(packResult[0].name).toBe('analysis-pack-json');
      expect((await readdir(fixture.packagedDirectory)).toSorted()).toEqual(
        analysisPackageMaintenanceFiles,
      );
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('inherits stdio for a real publish without returning captured output', async () => {
    const fixture = await createModuleDirectories();
    await addPackageMetadata(fixture, 'analysis-interactive-publish');
    const spawnProcess = stubSpawnResult(0);
    const stdioMode = analysisNpmStdioMode('publish', []);
    try {
      const result = await runAnalysisNpmCommand('publish', [], {
        sourceDirectory: fixture.sourceDirectory,
        packagedDirectory: fixture.packagedDirectory,
        spawnProcess,
        stdioMode,
      });

      expect(stdioMode).toBe('inherit');
      expect(analysisNpmStdioMode('publish', ['--dry-run', '--json'])).toBe('capture');
      expect(result).toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledWith('npm', ['publish', '--ignore-scripts'], {
        cwd: fixture.packagedDirectory,
        stdio: 'inherit',
      });
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('rejects a failed interactive publish and still removes generated modules', async () => {
    const fixture = await createModuleDirectories();
    await addPackageMetadata(fixture, 'analysis-interactive-failure');
    const spawnProcess = stubSpawnResult(7);
    try {
      await expect(
        runAnalysisNpmCommand('publish', [], {
          sourceDirectory: fixture.sourceDirectory,
          packagedDirectory: fixture.packagedDirectory,
          spawnProcess,
          stdioMode: 'inherit',
        }),
      ).rejects.toMatchObject({
        code: 7,
        message: 'npm publish failed with exit code 7.',
      });
      expect((await readdir(fixture.packagedDirectory)).toSorted()).toEqual(
        analysisPackageMaintenanceFiles,
      );
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('requires a library version bump when a published module changes', async () => {
    const fixture = await createModuleDirectories();
    const manifestPath = path.join(fixture.packagedDirectory, 'package.json');
    const sourcePath = path.join(fixture.sourceDirectory, 'signalrAnalysis.js');
    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: '@example/analysis', version: '0.1.0' })}\n`,
    );
    await writeAnalysisSourceDigest('0.1.0', fixture.sourceDirectory, fixture.packagedDirectory);

    try {
      await expect(
        assertAnalysisSourceDigest(fixture.sourceDirectory, fixture.packagedDirectory),
      ).resolves.toBeUndefined();

      await writeFile(sourcePath, 'module.exports = { changed: true };\n');
      await expect(
        assertAnalysisSourceDigest(fixture.sourceDirectory, fixture.packagedDirectory),
      ).rejects.toThrow(
        'Analysis library sources changed without a version bump: signalrAnalysis.js',
      );

      await expect(
        bumpAnalysisPackageVersion('patch', fixture.sourceDirectory, fixture.packagedDirectory),
      ).resolves.toBe('0.1.1');
      await expect(
        assertAnalysisSourceDigest(fixture.sourceDirectory, fixture.packagedDirectory),
      ).resolves.toBeUndefined();

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const digest = JSON.parse(
        await readFile(path.join(fixture.packagedDirectory, 'source-digest.json'), 'utf8'),
      );
      expect(manifest.version).toBe('0.1.1');
      expect(digest.version).toBe('0.1.1');
      expect(digest.files['signalrAnalysis.js']).toMatch(sha256Pattern);
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
