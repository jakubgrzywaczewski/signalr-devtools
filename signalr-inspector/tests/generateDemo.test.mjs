import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { browserPath, cleanupDemo, combineDemoErrors } from '../scripts/generate-demo.mjs';

describe('demo browser selection', () => {
  it('uses the Playwright-managed executable when there is no override', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'signalr-demo-browser-'));
    const executable = path.join(directory, 'playwright-browser');
    await writeFile(executable, 'fixture');

    try {
      expect(browserPath(null, executable)).toBe(executable);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('explains how to install a missing Playwright browser', () => {
    const executable = path.join(tmpdir(), 'missing-playwright-browser');

    expect(() => browserPath(null, executable)).toThrow('Run npm run test:e2e:install');
  });

  it('permits an explicit existing CHROME_PATH override', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'signalr-demo-browser-'));
    const executable = path.join(directory, 'browser');
    await writeFile(executable, 'fixture');

    try {
      expect(browserPath(executable)).toBe(executable);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects a missing CHROME_PATH override instead of silently falling back', () => {
    const executable = path.join(tmpdir(), 'missing-signalr-demo-browser');

    expect(() => browserPath(executable)).toThrow(`CHROME_PATH does not exist: ${executable}`);
  });
});

describe('demo cleanup', () => {
  it('removes the temporary workspace after the browser and server stop', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-demo-cleanup-'));
    const server = {
      close: vi.fn((callback) => callback()),
      closeAllConnections: vi.fn(),
    };

    await cleanupDemo({
      browser: { exitCode: 0, signalCode: null },
      server,
      temporaryDirectory,
    });

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(existsSync(temporaryDirectory)).toBe(false);
  });

  it('preserves the workspace and reports its path when the browser ignores both signals', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'signalr-demo-cleanup-'));
    const browser = new EventEmitter();
    browser.exitCode = null;
    browser.signalCode = null;
    browser.kill = vi.fn(() => true);
    const server = {
      close: vi.fn((callback) => callback()),
      closeAllConnections: vi.fn(),
    };

    let failure;
    try {
      await cleanupDemo({
        browser,
        browserExitTimeoutMs: 5,
        server,
        temporaryDirectory,
      });
    } catch (error) {
      failure = error;
    }

    expect(browser.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(temporaryDirectory);
    expect(failure.cause.message).toContain('SIGKILL');
    expect(existsSync(temporaryDirectory)).toBe(true);
    expect(server.close).toHaveBeenCalledOnce();
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it('retains generation and cleanup failures in one AggregateError', () => {
    const generationError = new Error('scenario assertion failed');
    const cleanupError = new Error('browser shutdown failed');

    const failure = combineDemoErrors(generationError, cleanupError);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([generationError, cleanupError]);
    expect(failure.cause).toBe(generationError);
  });
});
