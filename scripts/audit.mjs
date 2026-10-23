import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const unpatchedDevAdvisory = 'GHSA-vfj7-8cjw-p6xm';

function runAudit(productionOnly) {
  const command = `pnpm audit ${productionOnly ? '--prod ' : ''}--audit-level moderate --json`;
  const result = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Dependency audit did not return JSON: ${result.stderr || result.stdout}`);
  }
  if (!report.advisories || !report.metadata || (result.status !== 0 && !Object.keys(report.advisories).length)) {
    throw new Error(`Dependency audit failed: ${result.stderr || result.stdout}`);
  }
  return Object.values(report.advisories);
}

const productionAdvisories = runAudit(true);
const allAdvisories = runAudit(false);
const unexpected = allAdvisories.filter((advisory) =>
  advisory.github_advisory_id !== unpatchedDevAdvisory ||
  advisory.module_name !== 'braces' ||
  advisory.patched_versions !== '<0.0.0');

if (productionAdvisories.length || unexpected.length) {
  for (const advisory of [...productionAdvisories, ...unexpected]) {
    console.error(`${advisory.severity}: ${advisory.module_name} ${advisory.github_advisory_id}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Dependency audit passed; ${unpatchedDevAdvisory} remains in development tooling without an upstream patch.`);
}
