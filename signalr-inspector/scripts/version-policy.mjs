import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.resolve(extensionDirectory, '..');
const biomeLauncher = path.join(extensionDirectory, 'node_modules/@biomejs/biome/bin/biome');
const versionFiles = {
  package: 'signalr-inspector/package.json',
  lock: 'signalr-inspector/package-lock.json',
  manifest: 'signalr-inspector/manifest.json',
};
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) {
    throw new Error(`Expected a stable x.y.z version, received "${version}".`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function assertConsistentVersions(documents, source) {
  const versions = {
    package: documents.package.version,
    lock: documents.lock.version,
    lockRoot: documents.lock.packages?.['']?.version,
    manifest: documents.manifest.version,
  };
  const uniqueVersions = new Set(Object.values(versions));
  if (uniqueVersions.size !== 1) {
    throw new Error(`${source} versions differ: ${JSON.stringify(versions)}`);
  }
  parseVersion(versions.package);
  return versions.package;
}

function readWorkingDocuments() {
  return Object.fromEntries(
    Object.entries(versionFiles).map(([key, relativePath]) => [
      key,
      JSON.parse(readFileSync(path.join(repositoryDirectory, relativePath), 'utf8')),
    ]),
  );
}

function readGitDocuments(revision) {
  return Object.fromEntries(
    Object.entries(versionFiles).map(([key, relativePath]) => [
      key,
      JSON.parse(
        execFileSync(
          'git',
          ['show', revision === ':' ? `:${relativePath}` : `${revision}:${relativePath}`],
          {
            cwd: repositoryDirectory,
            encoding: 'utf8',
          },
        ),
      ),
    ]),
  );
}

function writeJson(relativePath, document) {
  writeFileSync(
    path.join(repositoryDirectory, relativePath),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}

function bumpVersion(kind) {
  if (!['patch', 'minor', 'major'].includes(kind)) {
    throw new Error('Choose one bump: patch, minor, or major.');
  }

  const documents = readWorkingDocuments();
  const currentVersion = assertConsistentVersions(documents, 'Working tree');
  const next = parseVersion(currentVersion);
  const index = { major: 0, minor: 1, patch: 2 }[kind];
  next[index] += 1;
  for (let resetIndex = index + 1; resetIndex < next.length; resetIndex += 1) {
    next[resetIndex] = 0;
  }
  const nextVersion = next.join('.');

  documents.package.version = nextVersion;
  documents.lock.version = nextVersion;
  documents.lock.packages[''].version = nextVersion;
  documents.manifest.version = nextVersion;
  writeJson(versionFiles.package, documents.package);
  writeJson(versionFiles.lock, documents.lock);
  writeJson(versionFiles.manifest, documents.manifest);
  execFileSync(
    process.execPath,
    [
      biomeLauncher,
      'format',
      '--write',
      versionFiles.package,
      versionFiles.lock,
      versionFiles.manifest,
    ],
    {
      cwd: repositoryDirectory,
      stdio: 'inherit',
    },
  );
  console.log(`Bumped SignalR Inspector from ${currentVersion} to ${nextVersion}.`);
}

function checkWorkingTree() {
  const version = assertConsistentVersions(readWorkingDocuments(), 'Working tree');
  console.log(`SignalR Inspector version ${version} is consistent.`);
}

function checkStagedCommit() {
  const stagedVersion = assertConsistentVersions(readGitDocuments(':'), 'Staged');
  const headVersion = assertConsistentVersions(readGitDocuments('HEAD'), 'HEAD');
  if (compareVersions(stagedVersion, headVersion) <= 0) {
    throw new Error(
      `Every commit must bump the version: staged ${stagedVersion}, HEAD ${headVersion}.`,
    );
  }
  console.log(`Staged version bump is valid: ${headVersion} -> ${stagedVersion}.`);
}

const [command, value] = process.argv.slice(2);
if (command === '--bump') {
  bumpVersion(value);
} else if (command === '--check') {
  checkWorkingTree();
} else if (command === '--check-staged') {
  checkStagedCommit();
} else {
  throw new Error('Use --bump <patch|minor|major>, --check, or --check-staged.');
}
