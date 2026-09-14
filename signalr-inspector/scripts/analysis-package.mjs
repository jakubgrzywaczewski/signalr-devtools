import { execFile } from 'node:child_process';
import { copyFile, readFile, rm } from 'node:fs/promises';
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
const analysisModules = [
  'msgpackDecoder.js',
  'sessionFormat.js',
  'signalrAnalysis.js',
  'signalrProtocol.js',
];
const forbiddenBrowserGlobals = new Set(['chrome', 'document', 'window']);
const supportedNpmCommands = new Set(['pack', 'publish']);

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

async function runAnalysisNpmCommand(
  command,
  arguments_ = [],
  sourceDirectory = extensionDirectory,
  packagedDirectory = analysisPackageDirectory,
) {
  if (!supportedNpmCommands.has(command)) {
    throw new Error(`Unsupported analysis npm command: ${command}`);
  }

  await prepareAnalysisPackage(sourceDirectory, packagedDirectory);
  let commandResult;
  let commandError;
  try {
    commandResult = await execFileAsync('npm', [command, '--ignore-scripts', ...arguments_], {
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
  if (command === 'npm') {
    const result = await runAnalysisNpmCommand(process.argv[3], process.argv.slice(4));
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
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
  analysisPackageDirectory,
  assertMatchingAnalysisSources,
  assertPureAnalysisSources,
  assertPureJavaScript,
  cleanupAnalysisPackage,
  extensionDirectory,
  prepareAnalysisPackage,
  runAnalysisNpmCommand,
};
