import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServiceSecret } from '../../scripts/container-secrets.mjs';
import {
  runScheduledJob,
  jobHealthy,
  writeJobState,
} from '../../scripts/job-runner.mjs';

it('rejects operator credentials and process injection in a web secret before modifying the environment', () => {
  const env = {};
  expect(() =>
    loadServiceSecret(
      'web',
      'DATABASE_URL=private\nMIGRATION_DATABASE_URL=operator',
      env,
    ),
  ).toThrow();
  expect(env).toEqual({});
  expect(() =>
    loadServiceSecret('web', 'NODE_OPTIONS=--require=bad', env),
  ).toThrow();
  loadServiceSecret(
    'web',
    'DATABASE_URL=runtime\nBETTER_AUTH_SECRET=secret',
    env,
  );
  expect(env).toEqual({
    DATABASE_URL: 'runtime',
    BETTER_AUTH_SECRET: 'secret',
  });
});

it('keeps failed backups unhealthy and never replaces the last successful timestamp with a failed attempt', async () => {
  const states = [],
    logs = [],
    signal = new AbortController();
  let calls = 0,
    active = 0,
    maximum = 0;
  await runScheduledJob({
    name: 'backup',
    intervalMs: 10,
    retryMs: 10,
    signal: signal.signal,
    job: async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      if (++calls === 2) {
        signal.abort();
        throw new Error('private email body password');
      }
    },
    writeState: async (state) => states.push({ ...state }),
    log: (entry) => logs.push(entry),
  });
  expect(calls).toBe(2);
  expect(maximum).toBe(1);
  const successes = states.filter((state) => state.ok === true);
  expect(successes.length).toBeGreaterThan(0);
  expect(states.at(-1).lastSuccess).toBe(successes[0].lastSuccess);
  expect(jobHealthy(states.at(-1), 1000)).toBe(false);
  expect(JSON.stringify(logs)).not.toMatch(/private|email|password/);
});

it('writes a private atomic status and detects missing, stale and future success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gunita-status-'));
  try {
    const file = join(directory, 'maintenance.json');
    const state = { ok: true, lastSuccess: 1000, lastAttempt: 1000 };
    await writeJobState(file, state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
    expect(jobHealthy(state, 1000, 1500)).toBe(true);
    expect(jobHealthy(state, 1000, 3000)).toBe(false);
    expect(jobHealthy(state, 1000, 999)).toBe(false);
    expect(jobHealthy({}, 1000, 1500)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
