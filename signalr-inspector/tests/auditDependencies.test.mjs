import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { evaluateAudit } from '../scripts/audit-dependencies.mjs';

const now = Date.parse('2026-11-17T20:00:00Z');
const advisory = {
  name: 'picomatch',
  dependency: 'picomatch',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high',
  range: '<=4.0.7',
};

function fixture() {
  const edges = {
    '@vitest/coverage-v8': ['vitest'],
    fdir: ['picomatch'],
    picomatch: [structuredClone(advisory)],
    tinyglobby: ['fdir', 'picomatch'],
    vite: ['tinyglobby', 'picomatch'],
    vitest: ['@vitest/coverage-v8', 'vite', 'tinyglobby', 'picomatch'],
  };
  const vulnerabilities = Object.fromEntries(
    Object.entries(edges).map(([name, via]) => [
      name,
      { name, severity: 'high', via, nodes: [`node_modules/${name}`], fixAvailable: false },
    ]),
  );
  const packages = Object.fromEntries(
    Object.keys(edges).map((name) => [
      `node_modules/${name}`,
      { dev: true, version: name === 'picomatch' ? '4.0.7' : '1.0.0' },
    ]),
  );
  return {
    report: {
      auditReportVersion: 2,
      vulnerabilities,
      metadata: { vulnerabilities: { high: 6, critical: 0 } },
    },
    lockfile: { packages },
  };
}

describe('dependency audit policy', () => {
  it('accepts only the documented development advisory, including propagated cycles', () => {
    const { report, lockfile } = fixture();
    const result = evaluateAudit(report, lockfile, now);
    expect(result.blocked).toEqual([]);
    expect(result.excepted).toHaveLength(6);
    expect(evaluateAudit(report, lockfile, Date.parse('2026-11-30T23:59:59Z')).blocked).toEqual([]);
  });

  it('expires at the start of December 1 UTC', () => {
    const { report, lockfile } = fixture();
    expect(
      evaluateAudit(report, lockfile, Date.parse('2026-12-01T00:00:00Z')).blocked,
    ).toHaveLength(6);
  });

  it('accepts a clean report even after the exception expires', () => {
    const report = {
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    };
    expect(evaluateAudit(report, { packages: {} }, Date.parse('2027-01-01'))).toEqual({
      blocked: [],
      excepted: [],
    });
  });

  it.each([
    ['picomatch', false],
    ['vitest', false],
    ['fdir', undefined],
  ])('blocks the advisory when %s is outside development scope (%s)', (name, dev) => {
    const { report, lockfile } = fixture();
    lockfile.packages[`node_modules/${name}`].dev = dev;
    expect(evaluateAudit(report, lockfile, now).blocked).toContain(name);
  });

  it('blocks an additional production occurrence of picomatch', () => {
    const { report, lockfile } = fixture();
    const productionNode = 'node_modules/production-app/node_modules/picomatch';
    report.vulnerabilities.picomatch.nodes.push(productionNode);
    lockfile.packages[productionNode] = { version: '4.0.7' };
    expect(evaluateAudit(report, lockfile, now).blocked).toHaveLength(6);
  });

  it('requires a new review when the excepted picomatch version changes', () => {
    const { report, lockfile } = fixture();
    lockfile.packages['node_modules/picomatch'].version = '4.0.8';
    expect(evaluateAudit(report, lockfile, now).blocked).toHaveLength(6);
  });

  it.each([true, { name: 'picomatch', version: '4.0.8', isSemVerMajor: false }])(
    'blocks when npm reports a compatible fix: %j',
    (fixAvailable) => {
      const { report, lockfile } = fixture();
      report.vulnerabilities.picomatch.fixAvailable = fixAvailable;
      expect(evaluateAudit(report, lockfile, now).blocked).toHaveLength(6);
    },
  );

  it('blocks a new advisory on the same dependency and all its affected parents', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.picomatch.via.push({
      ...advisory,
      url: 'https://github.com/advisories/GHSA-new-advisory',
    });
    expect(evaluateAudit(report, lockfile, now).blocked).toHaveLength(6);
  });

  it('blocks an unrelated high finding', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.other = {
      name: 'other',
      severity: 'high',
      via: [{ ...advisory, name: 'other' }],
      nodes: ['node_modules/other'],
      fixAvailable: false,
    };
    report.metadata.vulnerabilities.high += 1;
    lockfile.packages['node_modules/other'] = { dev: true };
    expect(evaluateAudit(report, lockfile, now).blocked).toEqual(['other']);
  });

  it('always blocks critical findings', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.picomatch.severity = 'critical';
    report.metadata.vulnerabilities.high -= 1;
    report.metadata.vulnerabilities.critical += 1;
    expect(evaluateAudit(report, lockfile, now).blocked).toContain('picomatch');
  });

  it('blocks cycles that do not reach the excepted advisory', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.vitest.via = ['@vitest/coverage-v8'];
    expect(evaluateAudit(report, lockfile, now).blocked).toContain('vitest');
  });

  it('rejects audit service errors instead of treating them as a clean audit', () => {
    const { report, lockfile } = fixture();
    expect(() => evaluateAudit({ ...report, error: { code: 'ENOAUDIT' } }, lockfile, now)).toThrow(
      'audit must complete successfully',
    );
  });

  it('rejects inconsistent counts and unsupported report formats', () => {
    const { report, lockfile } = fixture();
    report.metadata.vulnerabilities.high = 0;
    expect(() => evaluateAudit(report, lockfile, now)).toThrow('Inconsistent');
    report.auditReportVersion = 3;
    expect(() => evaluateAudit(report, lockfile, now)).toThrow('Invalid npm audit report');
  });

  it('rejects missing graph entries and lockfile data', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.vitest.via.push('missing');
    expect(() => evaluateAudit(report, lockfile, now)).toThrow('Missing npm audit dependency');
    expect(() => evaluateAudit(report, {}, now)).toThrow('package lockfile');
  });
});

const invalidFixValues = [
  undefined,
  null,
  'yes',
  { name: 'picomatch', version: '4.0.8' },
  { name: 'picomatch', version: 'not-semver', isSemVerMajor: true },
];

describe('audit fix availability validation', () => {
  it.each(invalidFixValues)('rejects malformed or missing fix information: %j', (value) => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.picomatch.fixAvailable = value;
    expect(() => evaluateAudit(report, lockfile, now)).toThrow('Invalid npm audit finding');
  });

  it('preserves the exception when npm only offers a reviewed major downgrade', () => {
    const { report, lockfile } = fixture();
    report.vulnerabilities.picomatch.fixAvailable = {
      name: 'vitest',
      version: '3.1.4',
      isSemVerMajor: true,
    };
    expect(evaluateAudit(report, lockfile, now).blocked).toEqual([]);
  });

  it.each(invalidFixValues)('rejects the malformed report in the audit subprocess: %j', (value) => {
    const { report } = fixture();
    report.vulnerabilities.picomatch.fixAvailable = value;
    const result = runFakeAudit(JSON.stringify(report), 1);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid npm audit finding');
  });
});

function runFakeAudit(output, status) {
  const directory = mkdtempSync(path.join(tmpdir(), 'signalr-audit-policy-'));
  try {
    const fakeNpm = path.join(directory, 'npm.mjs');
    writeFileSync(
      fakeNpm,
      `if (!process.argv.includes('--include=dev')) throw new Error('Development audit omitted');
process.stdout.write(${JSON.stringify(output)});
process.exitCode = ${status};`,
    );
    return spawnSync(process.execPath, [path.resolve('scripts/audit-dependencies.mjs')], {
      cwd: process.cwd(),
      env: { ...process.env, npm_execpath: fakeNpm },
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('dependency audit command', () => {
  const cleanReport = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { high: 0, critical: 0 } },
  });

  it('runs a full audit including development dependencies and prints the report', () => {
    const result = runFakeAudit(cleanReport, 0);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(cleanReport);
    expect(result.stdout).toContain('Dependency audit policy passed');
  });

  it.each([
    ['{}', 2, 'npm audit failed with status 2'],
    ['not JSON', 1, 'SyntaxError'],
    ['{"error":{"code":"ENOAUDIT"}}', 1, 'Invalid npm audit report'],
    [cleanReport, 1, 'exit status does not match'],
  ])('fails closed for command errors: %s / %s', (output, status, diagnostic) => {
    const result = runFakeAudit(output, status);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(diagnostic);
  });
});
