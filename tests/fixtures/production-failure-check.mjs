// Owned staging only: no main project, no broad cleanup, no public endpoints.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { readRehearsal } from '../../scripts/rehearsal-lib.mjs';
import { checkBackupRecovery } from './backup-recovery-check.mjs';

const receipt = await readRehearsal();
const args = [
  'compose',
  '--env-file',
  join(receipt.directory, 'compose.env'),
  '-p',
  receipt.project,
  '-f',
  'compose.prod.yml',
  '-f',
  'compose.staging.yml',
];
const env = { ...process.env, FORCE_COLOR: '0' };
delete env.NO_COLOR;
function run(extra, expected = 0) {
  const result = spawnSync('docker', [...args, ...extra], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240000,
  });
  assert.equal(
    result.status,
    expected,
    `Scoped Docker command status mismatch: ${extra[0]}`,
  );
  return result.stdout + result.stderr;
}
const invalid = run(
  ['run', '--rm', '--no-deps', '-e', 'LOCAL_PREVIEW=false', 'web'],
  1,
);
assert.match(invalid, /Invalid environment:/);
for (const value of Object.values(
  parseEnv(await readFile(join(receipt.directory, 'secrets/web.env'), 'utf8')),
))
  assert.equal(invalid.includes(value), false);
console.log(
  'PASS invalid preview/production settings fail startup without exposing dummy secrets',
);
try {
  run(['stop', 'db']);
  run([
    'exec',
    '-T',
    'web',
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/api/ready').then(async r=>{if(r.status!==503||JSON.stringify(await r.json())!==JSON.stringify({status:'unavailable'}))process.exit(1)}).catch(()=>process.exit(2))",
  ]);
  console.log('PASS DB outage returns bounded minimal503 readiness');
} finally {
  run(['up', '-d', '--wait', '--wait-timeout', '120', 'db']);
}
run([
  'exec',
  '-T',
  'web',
  'node',
  '-e',
  "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(2))",
]);
console.log('PASS same owned DB recovery restores readiness200');
await checkBackupRecovery(run);
console.log(
  'PASS backup failure is unhealthy; actual successful retry repairs health',
);
run(['restart', 'maintenance']);
run(['up', '-d', '--wait', '--wait-timeout', '180', 'maintenance']);
run([
  'exec',
  '-T',
  'maintenance',
  'node',
  'scripts/job-health.mjs',
  'maintenance',
]);
console.log('PASS maintenance graceful restart and fresh successful health');
const logs = run([
  'logs',
  '--no-color',
  'maintenance',
  'backup',
  'metrics',
  'web',
]);
for (const file of ['web.env', 'operator.env']) {
  for (const value of Object.values(
    parseEnv(await readFile(join(receipt.directory, 'secrets', file), 'utf8')),
  ))
    assert.equal(logs.includes(value), false);
}
assert.equal(logs.includes('Synthetic operations expiry fixture'), false);
assert.equal(logs.includes('synthetic-rehearsal@example.invalid'), false);
assert.match(logs, /operations_metrics/);
console.log(
  'PASS real logs contain aggregate metrics and no fixture body/email or dummy secret values',
);
