import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const advisoryUrl = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expiresAt = '2026-12-01T00:00:00Z';
// See CONTRIBUTING.md: repository-owned test globs, no production npm dependencies.
const developmentPackages = new Set([
  '@vitest/coverage-v8',
  'fdir',
  'picomatch',
  'tinyglobby',
  'vite',
  'vitest',
]);
const severities = new Set(['info', 'low', 'moderate', 'high', 'critical']);

function validateReport(report) {
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new Error('Invalid npm audit report; audit must complete successfully.');
  }
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (
      finding?.name !== name ||
      !severities.has(finding.severity) ||
      !Array.isArray(finding.via) ||
      finding.via.length === 0 ||
      !Array.isArray(finding.nodes) ||
      finding.nodes.length === 0
    ) {
      throw new Error(`Invalid npm audit finding: ${name}.`);
    }
  }
  for (const severity of ['high', 'critical']) {
    const count = report.metadata?.vulnerabilities?.[severity];
    const actual = Object.values(report.vulnerabilities).filter(
      (finding) => finding.severity === severity,
    ).length;
    if (!Number.isSafeInteger(count) || count !== actual) {
      throw new Error(`Inconsistent npm audit ${severity} count.`);
    }
  }
}

function collectEvidence(name, findings, packages = new Set(), advisories = []) {
  if (packages.has(name)) {
    return { packages, advisories };
  }
  const finding = findings[name];
  if (!Object.hasOwn(findings, name)) {
    throw new Error(`Missing npm audit dependency: ${name}.`);
  }
  packages.add(name);
  for (const via of finding.via) {
    if (typeof via === 'string') {
      collectEvidence(via, findings, packages, advisories);
    } else {
      advisories.push(via);
    }
  }
  return { packages, advisories };
}

function isDevelopmentPackage(name, finding, lockfile) {
  return (
    developmentPackages.has(name) &&
    finding.fixAvailable !== true &&
    finding.fixAvailable?.isSemVerMajor !== false &&
    finding.nodes.every((node) => {
      const dependency = lockfile.packages?.[node];
      return (
        typeof node === 'string' &&
        (node === `node_modules/${name}` || node.endsWith(`/node_modules/${name}`)) &&
        dependency?.dev === true &&
        typeof dependency.version === 'string' &&
        !dependency.link &&
        (name !== 'picomatch' || dependency.version === '4.0.7')
      );
    })
  );
}

function canExcept(name, report, lockfile, now) {
  if (report.vulnerabilities[name].severity !== 'high' || now >= Date.parse(expiresAt)) {
    return false;
  }
  const evidence = collectEvidence(name, report.vulnerabilities);
  return (
    evidence.advisories.length > 0 &&
    evidence.advisories.every(
      (advisory) =>
        advisory?.url === advisoryUrl &&
        advisory.name === 'picomatch' &&
        advisory.dependency === 'picomatch' &&
        advisory.severity === 'high' &&
        advisory.range === '<=4.0.7',
    ) &&
    [...evidence.packages].every((dependency) =>
      isDevelopmentPackage(dependency, report.vulnerabilities[dependency], lockfile),
    )
  );
}

function evaluateAudit(report, lockfile, now = Date.now()) {
  validateReport(report);
  if (!(Number.isFinite(now) && lockfile?.packages)) {
    throw new Error('Audit requires a valid clock and package lockfile.');
  }
  const blocked = [];
  const excepted = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (finding.severity === 'high' || finding.severity === 'critical') {
      if (canExcept(name, report, lockfile, now)) {
        excepted.push(name);
      } else {
        blocked.push(name);
      }
    }
  }
  return { blocked, excepted };
}

function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Run the audit with npm run audit:deps.');
  }
  const result = spawnSync(
    process.execPath,
    [npmCli, 'audit', '--include=dev', '--audit-level=high', '--json'],
    { cwd: extensionDirectory, encoding: 'utf8' },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw result.error ?? new Error(`npm audit failed with status ${result.status}.`);
  }
  const report = JSON.parse(result.stdout);
  const lockfile = JSON.parse(
    readFileSync(path.join(extensionDirectory, 'package-lock.json'), 'utf8'),
  );
  const { blocked, excepted } = evaluateAudit(report, lockfile);
  const auditFailed =
    report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical > 0;
  if ((result.status === 1) !== auditFailed) {
    throw new Error('npm audit exit status does not match its report.');
  }
  if (excepted.length > 0) {
    console.warn(
      `Temporary development-only exception: ${advisoryUrl}; expires ${expiresAt}; packages: ${excepted.join(', ')}.`,
    );
  }
  if (blocked.length > 0) {
    throw new Error(`Dependency audit blocked: ${blocked.join(', ')}.`);
  }
  console.log('Dependency audit policy passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { evaluateAudit };
