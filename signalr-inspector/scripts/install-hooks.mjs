import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.CI === 'true' || process.env.SKIP_INSTALL_SIMPLE_GIT_HOOKS) {
  process.exit(0);
}

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.resolve(extensionDirectory, '..');
const launcher = path.join(extensionDirectory, 'node_modules/simple-git-hooks/cli.js');
const result = spawnSync(process.execPath, [launcher], {
  cwd: repositoryDirectory,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
