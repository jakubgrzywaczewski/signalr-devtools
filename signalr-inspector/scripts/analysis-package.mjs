import { copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const forbiddenBrowserGlobals = new Set(['document', 'window', 'chrome']);
const identifierStartPattern = /[A-Za-z_$]/;
const identifierPartPattern = /[\w$]/;

function isIdentifierStart(character) {
  return typeof character === 'string' && identifierStartPattern.test(character);
}

function isIdentifierPart(character) {
  return typeof character === 'string' && identifierPartPattern.test(character);
}

function browserGlobalReferences(source) {
  const references = [];
  const contexts = [{ kind: 'code', templateBraceDepth: null }];
  let index = 0;

  while (index < source.length) {
    const context = contexts.at(-1);
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (context.kind === 'line-comment') {
      if (character === '\n') {
        contexts.pop();
      }
      index += 1;
    } else if (context.kind === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        contexts.pop();
        index += 2;
      } else {
        index += 1;
      }
    } else if (context.kind === 'string') {
      if (character === '\\') {
        index += 2;
      } else {
        index += 1;
        if (character === context.quote) {
          contexts.pop();
        }
      }
    } else if (context.kind === 'template') {
      if (character === '\\') {
        index += 2;
      } else if (character === '`') {
        contexts.pop();
        index += 1;
      } else if (character === '$' && nextCharacter === '{') {
        contexts.push({ kind: 'code', templateBraceDepth: 1 });
        index += 2;
      } else {
        index += 1;
      }
    } else if (character === '/' && nextCharacter === '/') {
      contexts.push({ kind: 'line-comment' });
      index += 2;
    } else if (character === '/' && nextCharacter === '*') {
      contexts.push({ kind: 'block-comment' });
      index += 2;
    } else if (character === "'" || character === '"') {
      contexts.push({ kind: 'string', quote: character });
      index += 1;
    } else if (character === '`') {
      contexts.push({ kind: 'template' });
      index += 1;
    } else if (context.templateBraceDepth !== null && character === '{') {
      context.templateBraceDepth += 1;
      index += 1;
    } else if (context.templateBraceDepth !== null && character === '}') {
      context.templateBraceDepth -= 1;
      index += 1;
      if (context.templateBraceDepth === 0) {
        contexts.pop();
      }
    } else if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) {
        index += 1;
      }
      const identifier = source.slice(start, index);
      if (forbiddenBrowserGlobals.has(identifier)) {
        references.push({ identifier, index: start });
      }
    } else {
      index += 1;
    }
  }

  return references;
}

function sourceLocation(source, index) {
  const preceding = source.slice(0, index);
  const line = preceding.split('\n').length;
  const lastLineBreak = preceding.lastIndexOf('\n');
  const column = index - lastLineBreak;
  return `${line}:${column}`;
}

async function assertPureAnalysisSources(sourceDirectory = extensionDirectory) {
  const violations = [];
  for (const moduleName of analysisModules) {
    const source = await readFile(path.join(sourceDirectory, moduleName), 'utf8');
    for (const reference of browserGlobalReferences(source)) {
      violations.push(
        `${moduleName}:${sourceLocation(source, reference.index)} references forbidden browser global "${reference.identifier}"`,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(`Analysis purity gate failed:\n${violations.join('\n')}`);
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

async function prepareAnalysisPackage() {
  await assertPureAnalysisSources();
  for (const moduleName of analysisModules) {
    await copyFile(
      path.join(extensionDirectory, moduleName),
      path.join(analysisPackageDirectory, moduleName),
    );
  }
  await assertMatchingAnalysisSources();
}

async function cleanupAnalysisPackage() {
  await Promise.all(
    analysisModules.map((moduleName) =>
      rm(path.join(analysisPackageDirectory, moduleName), { force: true }),
    ),
  );
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
  browserGlobalReferences,
  cleanupAnalysisPackage,
  extensionDirectory,
};
