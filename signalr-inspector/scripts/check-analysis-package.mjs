import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  analysisModules,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  cleanupAnalysisPackage,
  extensionDirectory,
  runAnalysisNpmCommand,
} from './analysis-package.mjs';

const execFileAsync = promisify(execFile);
const expectedPackageFiles = ['LICENSE', 'README.md', ...analysisModules, 'package.json'].sort();

const commonJsConsumer = String.raw`
const assert = require('node:assert/strict');
const analysis = require('@signalr-devtools/analysis');
const msgpack = require('@signalr-devtools/analysis/msgpackDecoder');
const protocol = require('@signalr-devtools/analysis/signalrProtocol');
const session = require('@signalr-devtools/analysis/sessionFormat');

assert.equal(typeof analysis.analyze, 'function');
assert.equal(typeof msgpack.decode, 'function');
assert.equal(typeof protocol.parsePayload, 'function');
assert.equal(typeof session.serialize, 'function');

const separator = '\u001e';
const invocationPayload = JSON.stringify({
  type: 1,
  invocationId: '1',
  target: 'SendMessage',
  arguments: ['Ada', 'Hello'],
}) + separator;
const completionPayload = JSON.stringify({ type: 3, invocationId: '1' }) + separator;
const messages = [
  {
    id: 1,
    direction: 'outgoing',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 100,
    encoding: 'text',
    size: invocationPayload.length,
    preview: invocationPayload,
    textPayload: invocationPayload,
  },
  {
    id: 2,
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 145,
    encoding: 'text',
    size: completionPayload.length,
    preview: completionPayload,
    textPayload: completionPayload,
  },
];

const result = analysis.analyze(messages, protocol.parsePayload);
assert.equal(result.insights.summary.hubMessages, 2);
assert.equal(result.insights.methods.length, 1);
assert.equal(result.connections.length, 1);
`;

const moduleConsumer = String.raw`
import assert from 'node:assert/strict';
import analysis from '@signalr-devtools/analysis';
import msgpack from '@signalr-devtools/analysis/msgpackDecoder';
import protocol from '@signalr-devtools/analysis/signalrProtocol';
import session from '@signalr-devtools/analysis/sessionFormat';

assert.equal(typeof analysis.analyze, 'function');
assert.equal(typeof msgpack.decode, 'function');
assert.equal(typeof protocol.parsePayload, 'function');
assert.equal(typeof session.serialize, 'function');

const separator = '\u001e';
const invocationPayload = JSON.stringify({
  type: 1,
  invocationId: '1',
  target: 'SendMessage',
  arguments: ['Ada', 'Hello'],
}) + separator;
const completionPayload = JSON.stringify({ type: 3, invocationId: '1' }) + separator;
const messages = [
  {
    id: 1,
    direction: 'outgoing',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 100,
    encoding: 'text',
    size: invocationPayload.length,
    preview: invocationPayload,
    textPayload: invocationPayload,
  },
  {
    id: 2,
    direction: 'incoming',
    endpoint: 'https://localhost/chatHub',
    transport: 'websocket',
    timestamp: 145,
    encoding: 'text',
    size: completionPayload.length,
    preview: completionPayload,
    textPayload: completionPayload,
  },
];

const result = analysis.analyze(messages, protocol.parsePayload);
assert.equal(result.insights.summary.hubMessages, 2);
assert.equal(result.insights.methods.length, 1);
assert.equal(result.connections.length, 1);
`;

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function runConsumer(consumerDirectory, filename, source) {
  await writeFile(path.join(consumerDirectory, filename), source);
  await execFileAsync(process.execPath, [filename], { cwd: consumerDirectory });
}

async function verifyAnalysisPackage() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-analysis-package-'));
  try {
    await assertPureAnalysisSources();
    const packDirectory = path.join(temporaryDirectory, 'pack');
    const extractDirectory = path.join(temporaryDirectory, 'extract');
    const consumerDirectory = path.join(temporaryDirectory, 'consumer');
    await Promise.all([mkdir(packDirectory), mkdir(extractDirectory), mkdir(consumerDirectory)]);

    const { stdout } = await runAnalysisNpmCommand('pack', [
      '--silent',
      '--json',
      '--pack-destination',
      packDirectory,
    ]);
    const packResult = JSON.parse(stdout);
    const archivePath = path.join(packDirectory, packResult[0].filename);
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDirectory]);
    const unpackedPackageDirectory = path.join(extractDirectory, 'package');
    const packageFiles = await listFiles(unpackedPackageDirectory);
    if (JSON.stringify(packageFiles) !== JSON.stringify(expectedPackageFiles)) {
      throw new Error(
        `Unexpected analysis tarball files:\n${packageFiles.join('\n')}\nExpected:\n${expectedPackageFiles.join('\n')}`,
      );
    }
    await assertMatchingAnalysisSources(extensionDirectory, unpackedPackageDirectory);

    await writeFile(
      path.join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ name: 'analysis-consumer-check', private: true }, null, 2)}\n`,
    );
    await execFileAsync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', archivePath],
      { cwd: consumerDirectory },
    );
    await runConsumer(consumerDirectory, 'consumer.cjs', commonJsConsumer);
    await runConsumer(consumerDirectory, 'consumer.mjs', moduleConsumer);

    const manifest = JSON.parse(
      await readFile(path.join(unpackedPackageDirectory, 'package.json'), 'utf8'),
    );
    console.log(
      `Verified ${manifest.name}@${manifest.version}: ${packageFiles.join(', ')}; CJS and ESM consumers passed.`,
    );
  } finally {
    await cleanupAnalysisPackage();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await verifyAnalysisPackage();
}

export { expectedPackageFiles, verifyAnalysisPackage };
