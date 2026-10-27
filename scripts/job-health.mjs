import { readFile } from 'node:fs/promises';
import { jobHealthy } from './job-runner.mjs';
const limits = { maintenance: 3900000, backup: 90000000, metrics: 180000 };
const name = process.argv[2];
try {
  const state = JSON.parse(await readFile(`/state/${name}.json`, 'utf8'));
  if (!limits[name] || !jobHealthy(state, limits[name])) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
