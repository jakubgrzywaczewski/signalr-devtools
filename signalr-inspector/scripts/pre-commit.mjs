import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.resolve(extensionDirectory, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dotnetCommand = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';

const checks = [
  {
    label: 'staged version policy',
    command: process.execPath,
    args: [path.join(extensionDirectory, 'scripts/version-policy.mjs'), '--check-staged'],
    cwd: repositoryDirectory,
  },
  {
    label: 'Biome',
    command: npmCommand,
    args: ['run', 'check'],
    cwd: extensionDirectory,
  },
  {
    label: 'Vitest',
    command: npmCommand,
    args: ['test'],
    cwd: extensionDirectory,
  },
  {
    label: '.NET sample Release build',
    command: dotnetCommand,
    args: ['build', 'samples/SignalR.Sample', '--configuration', 'Release'],
    cwd: repositoryDirectory,
  },
  {
    label: '.NET MessagePack fixture generator Release build',
    command: dotnetCommand,
    args: ['build', 'tools/msgpack-fixtures', '--configuration', 'Release'],
    cwd: repositoryDirectory,
  },
];

for (const check of checks) {
  console.log(`\n[pre-commit] ${check.label}`);
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
