import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(testsDirectory, '..');
const repositoryDirectory = path.resolve(extensionDirectory, '..');

export default defineConfig({
  testDir: path.join(testsDirectory, 'e2e'),
  outputDir: path.join(extensionDirectory, 'coverage', 'playwright'),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: [
    {
      // CI builds the sample in a dedicated step so a cold restore cannot eat the server timeout.
      command: `dotnet run --project samples/SignalR.Sample --configuration Release --no-launch-profile${process.env.CI ? ' --no-build' : ''} -- --urls http://127.0.0.1:5187`,
      cwd: repositoryDirectory,
      url: 'http://127.0.0.1:5187',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `dotnet run --project signalr-inspector/tests/e2e/fixtures/stateful-app --configuration Release --no-launch-profile${process.env.CI ? ' --no-build' : ''} -- --urls http://127.0.0.1:5188`,
      cwd: repositoryDirectory,
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
