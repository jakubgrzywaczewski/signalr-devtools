import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(extensionDirectory, '..');
const analysisPackageDirectory = path.join(repositoryRoot, 'packages/analysis');
const sourceDigestFilename = 'source-digest.json';
const analysisModules = [
  'msgpackDecoder.js',
  'sessionFormat.js',
  'signalrAnalysis.js',
  'signalrProtocol.js',
];
const forbiddenBrowserGlobals = new Set(['chrome', 'document', 'window']);
const supportedNpmCommands = new Set(['pack', 'publish']);
const supportedStdioModes = new Set(['capture', 'inherit']);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function parseVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) {
    throw new Error(`Expected an x.y.z analysis package version, received "${version}".`);
  }
  return match.slice(1).map(Number);
}

function nextVersion(version, kind) {
  if (!['patch', 'minor', 'major'].includes(kind)) {
    throw new Error('Choose one analysis package bump: patch, minor, or major.');
  }
  const parts = parseVersion(version);
  const index = { major: 0, minor: 1, patch: 2 }[kind];
  parts[index] += 1;
  for (let resetIndex = index + 1; resetIndex < parts.length; resetIndex += 1) {
    parts[resetIndex] = 0;
  }
  return parts.join('.');
}

async function calculateAnalysisSourceHashes(sourceDirectory = extensionDirectory) {
  const files = {};
  for (const moduleName of analysisModules) {
    const source = await readFile(path.join(sourceDirectory, moduleName));
    files[moduleName] = createHash('sha256').update(source).digest('hex');
  }
  return files;
}

async function writeAnalysisSourceDigest(
  version,
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
) {
  parseVersion(version);
  const digest = {
    version,
    algorithm: 'sha256',
    files: await calculateAnalysisSourceHashes(sourceDirectory),
  };
  await writeFile(
    path.join(packagedDirectory, sourceDigestFilename),
    `${JSON.stringify(digest, null, 2)}\n`,
  );
  return digest;
}

function validateSourceDigest(digest) {
  if (!digest || typeof digest !== 'object' || Array.isArray(digest)) {
    throw new Error('Analysis source digest must be a JSON object.');
  }
  parseVersion(digest.version);
  if (digest.algorithm !== 'sha256') {
    throw new Error('Analysis source digest algorithm must be sha256.');
  }
  const recordedModules = Object.keys(digest.files ?? {}).sort();
  if (JSON.stringify(recordedModules) !== JSON.stringify(analysisModules.toSorted())) {
    throw new Error(`Analysis source digest must contain exactly: ${analysisModules.join(', ')}.`);
  }
  for (const moduleName of analysisModules) {
    if (!sha256Pattern.test(digest.files[moduleName])) {
      throw new Error(`Analysis source digest has an invalid sha256 for ${moduleName}.`);
    }
  }
}

async function assertAnalysisSourceDigest(
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
) {
  const [manifestSource, digestSource, currentFiles] = await Promise.all([
    readFile(path.join(packagedDirectory, 'package.json'), 'utf8'),
    readFile(path.join(packagedDirectory, sourceDigestFilename), 'utf8'),
    calculateAnalysisSourceHashes(sourceDirectory),
  ]);
  const manifest = JSON.parse(manifestSource);
  const digest = JSON.parse(digestSource);
  parseVersion(manifest.version);
  validateSourceDigest(digest);

  if (manifest.version !== digest.version) {
    throw new Error(
      `Analysis package version ${manifest.version} does not match source digest version ${digest.version}. Use npm run analysis:version:bump -- <patch|minor|major>.`,
    );
  }

  const changedModules = analysisModules.filter(
    (moduleName) => currentFiles[moduleName] !== digest.files[moduleName],
  );
  if (changedModules.length > 0) {
    throw new Error(
      `Analysis library sources changed without a version bump: ${changedModules.join(', ')}. Use npm run analysis:version:bump -- <patch|minor|major>.`,
    );
  }
}

async function bumpAnalysisPackageVersion(
  kind,
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
) {
  const manifestPath = path.join(packagedDirectory, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const currentVersion = manifest.version;
  const bumpedVersion = nextVersion(currentVersion, kind);
  manifest.version = bumpedVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeAnalysisSourceDigest(bumpedVersion, sourceDirectory, packagedDirectory);
  console.log(`Bumped analysis package from ${currentVersion} to ${bumpedVersion}.`);
  return bumpedVersion;
}

function recordParents(node, parent, parents) {
  if (Array.isArray(node)) {
    for (const child of node) {
      recordParents(child, parent, parents);
    }
    return;
  }
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    return;
  }
  if (parent) {
    parents.set(node, parent);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value) || (value && typeof value === 'object' && value.type)) {
      recordParents(value, node, parents);
    }
  }
}

function staticStringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    if (left !== undefined && right !== undefined) {
      return left + right;
    }
  }
}

function memberName(member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  return staticStringValue(member.property);
}

function isExposureRootArgument(identifier, parent) {
  return (
    parent?.type === 'CallExpression' &&
    parent.arguments.includes(identifier) &&
    (parent.callee.type === 'FunctionExpression' ||
      parent.callee.type === 'ArrowFunctionExpression')
  );
}

function sourceLocation(node) {
  return `${node.loc.start.line}:${node.loc.start.column + 1}`;
}

function exposureRootViolations({ globalIdentifier, call, parents, scopeManager, moduleName }) {
  const argumentIndex = call.arguments.indexOf(globalIdentifier);
  const parameter = call.callee.params[argumentIndex];
  const functionScope = scopeManager.acquire(call.callee, true);
  const variable = parameter?.type === 'Identifier' ? functionScope?.set.get(parameter.name) : null;
  if (!variable) {
    return [
      `${moduleName}:${sourceLocation(globalIdentifier)} passes globalThis through an unsupported exposure binding`,
    ];
  }

  const violations = [];
  for (const reference of variable.references) {
    const identifier = reference.identifier;
    const parent = parents.get(identifier);
    if (parent?.type === 'MemberExpression' && parent.object === identifier) {
      const property = memberName(parent);
      if (property === undefined) {
        violations.push(
          `${moduleName}:${sourceLocation(identifier)} uses dynamic exposure-root access that cannot be proven browser-independent`,
        );
      } else if (forbiddenBrowserGlobals.has(property)) {
        violations.push(
          `${moduleName}:${sourceLocation(identifier)} accesses forbidden browser global "${property}" through the exposure root`,
        );
      }
    } else {
      violations.push(
        `${moduleName}:${sourceLocation(identifier)} aliases the exposure root, which cannot be proven browser-independent`,
      );
    }
  }
  return violations;
}

function assertPureJavaScript(source, moduleName = 'signalrAnalysis.js') {
  let syntaxTree;
  try {
    syntaxTree = parse(source, {
      ecmaVersion: 'latest',
      locations: true,
      ranges: true,
      sourceType: 'script',
    });
  } catch (error) {
    throw new Error(`Analysis purity gate could not parse ${moduleName}: ${error.message}`, {
      cause: error,
    });
  }

  const parents = new Map();
  recordParents(syntaxTree, null, parents);
  const scopeManager = analyze(syntaxTree, { ecmaVersion: 2024, sourceType: 'script' });
  const violations = [];
  for (const reference of scopeManager.globalScope.through) {
    const identifier = reference.identifier;
    if (forbiddenBrowserGlobals.has(identifier.name)) {
      violations.push(
        `${moduleName}:${sourceLocation(identifier)} references forbidden browser global "${identifier.name}"`,
      );
      continue;
    }
    if (identifier.name !== 'globalThis') {
      continue;
    }

    const parent = parents.get(identifier);
    if (parent?.type === 'MemberExpression' && parent.object === identifier) {
      const property = memberName(parent);
      if (property === undefined) {
        violations.push(
          `${moduleName}:${sourceLocation(identifier)} uses dynamic globalThis access that cannot be proven browser-independent`,
        );
      } else if (forbiddenBrowserGlobals.has(property)) {
        violations.push(
          `${moduleName}:${sourceLocation(identifier)} accesses forbidden browser global "${property}" through globalThis`,
        );
      }
    } else if (isExposureRootArgument(identifier, parent)) {
      violations.push(
        ...exposureRootViolations({
          call: parent,
          globalIdentifier: identifier,
          moduleName,
          parents,
          scopeManager,
        }),
      );
    } else {
      violations.push(
        `${moduleName}:${sourceLocation(identifier)} aliases globalThis, which cannot be proven browser-independent`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(`Analysis purity gate failed:\n${violations.join('\n')}`);
  }
}

async function assertPureAnalysisSources(sourceDirectory = extensionDirectory) {
  for (const moduleName of analysisModules) {
    const source = await readFile(path.join(sourceDirectory, moduleName), 'utf8');
    assertPureJavaScript(source, moduleName);
  }
}

async function assertMatchingAnalysisSources(
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
) {
  const differences = [];
  for (const moduleName of analysisModules) {
    let source;
    let packaged;
    try {
      [source, packaged] = await Promise.all([
        readFile(path.join(sourceDirectory, moduleName)),
        readFile(path.join(packagedDirectory, moduleName)),
      ]);
    } catch (error) {
      differences.push(`${moduleName}: ${error.message}`);
      continue;
    }
    if (!source.equals(packaged)) {
      differences.push(`${moduleName}: packaged bytes differ from the extension source`);
    }
  }
  if (differences.length > 0) {
    throw new Error(`Analysis package divergence gate failed:\n${differences.join('\n')}`);
  }
}

async function removeGeneratedFiles(paths) {
  const results = await Promise.allSettled(paths.map((filePath) => rm(filePath, { force: true })));
  return results.filter((result) => result.status === 'rejected').map((result) => result.reason);
}

async function cleanupAnalysisPackage(packagedDirectory = analysisPackageDirectory) {
  const cleanupErrors = await removeGeneratedFiles(
    analysisModules.map((moduleName) => path.join(packagedDirectory, moduleName)),
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Failed to clean generated analysis package files.');
  }
}

async function prepareAnalysisPackage(
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
  copyModule = copyFile,
) {
  await cleanupAnalysisPackage(packagedDirectory);
  await assertPureAnalysisSources(sourceDirectory);
  const copiedPaths = [];
  try {
    for (const moduleName of analysisModules) {
      const packagedPath = path.join(packagedDirectory, moduleName);
      copiedPaths.push(packagedPath);
      await copyModule(path.join(sourceDirectory, moduleName), packagedPath);
    }
    await assertMatchingAnalysisSources(sourceDirectory, packagedDirectory);
  } catch (error) {
    const cleanupErrors = await removeGeneratedFiles(copiedPaths);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Analysis package preparation and rollback both failed.',
        { cause: error },
      );
    }
    throw error;
  }
}

function analysisNpmStdioMode(command, arguments_) {
  return command === 'publish' &&
    !arguments_.includes('--dry-run') &&
    !arguments_.includes('--json')
    ? 'inherit'
    : 'capture';
}

function runInteractiveNpmCommand(command, arguments_, packagedDirectory, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('npm', [command, '--ignore-scripts', ...arguments_], {
      cwd: packagedDirectory,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const exitReason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      const error = new Error(`npm ${command} failed with ${exitReason}.`);
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

async function runAnalysisNpmCommand(
  command,
  arguments_ = [],
  {
    sourceDirectory = extensionDirectory,
    packagedDirectory = analysisPackageDirectory,
    stdioMode = 'capture',
    spawnProcess = spawn,
  } = {},
) {
  if (!supportedNpmCommands.has(command)) {
    throw new Error(`Unsupported analysis npm command: ${command}`);
  }
  if (!supportedStdioModes.has(stdioMode)) {
    throw new Error(`Unsupported analysis npm stdio mode: ${stdioMode}`);
  }

  await assertAnalysisSourceDigest(sourceDirectory, packagedDirectory);
  await prepareAnalysisPackage(sourceDirectory, packagedDirectory);
  let commandResult;
  let commandError;
  try {
    commandResult =
      stdioMode === 'inherit'
        ? await runInteractiveNpmCommand(command, arguments_, packagedDirectory, spawnProcess)
        : await execFileAsync('npm', [command, '--ignore-scripts', ...arguments_], {
            cwd: packagedDirectory,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
          });
  } catch (error) {
    commandError = error;
  }

  let cleanupError;
  try {
    await cleanupAnalysisPackage(packagedDirectory);
  } catch (error) {
    cleanupError = error;
  }

  if (commandError && cleanupError) {
    throw new AggregateError(
      [commandError, cleanupError],
      `npm ${command} and analysis package cleanup both failed.`,
      { cause: commandError },
    );
  }
  if (commandError) {
    throw commandError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  return commandResult;
}

async function runCommand(command) {
  if (command === 'prepare') {
    await assertAnalysisSourceDigest();
    await prepareAnalysisPackage();
    return;
  }
  if (command === 'cleanup') {
    await cleanupAnalysisPackage();
    return;
  }
  if (command === 'verify-purity') {
    await assertPureAnalysisSources();
    return;
  }
  if (command === 'verify-sources') {
    await assertMatchingAnalysisSources();
    return;
  }
  if (command === 'verify-source-digest') {
    await assertAnalysisSourceDigest();
    return;
  }
  if (command === 'version:bump') {
    await bumpAnalysisPackageVersion(process.argv[3]);
    return;
  }
  if (command === 'npm') {
    const npmCommand = process.argv[3];
    const npmArguments = process.argv.slice(4);
    const result = await runAnalysisNpmCommand(npmCommand, npmArguments, {
      stdioMode: analysisNpmStdioMode(npmCommand, npmArguments),
    });
    if (result?.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result?.stderr) {
      process.stderr.write(result.stderr);
    }
    return;
  }
  throw new Error(`Unknown analysis package command: ${command ?? '(missing)'}`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await runCommand(process.argv[2]);
}

export {
  analysisModules,
  analysisNpmStdioMode,
  analysisPackageDirectory,
  assertAnalysisSourceDigest,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  assertPureJavaScript,
  bumpAnalysisPackageVersion,
  cleanupAnalysisPackage,
  extensionDirectory,
  prepareAnalysisPackage,
  runAnalysisNpmCommand,
  writeAnalysisSourceDigest,
};
