import { writeFile, rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export async function writeJobState(file, state) {
  await writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export function jobHealthy(state, maxAgeMs, now = Date.now()) {
  return (
    state.ok === true &&
    Number.isFinite(state.lastSuccess) &&
    now >= state.lastSuccess &&
    now - state.lastSuccess <= maxAgeMs
  );
}
// Await each run, including termination: never overlap work or abandon its DB lock.
export async function runScheduledJob({
  name,
  job,
  intervalMs,
  retryMs = 300000,
  signal,
  writeState = async () => {},
  log = (entry) => console.log(JSON.stringify(entry)),
  once = false,
}) {
  const state = { ok: false, lastAttempt: null, lastSuccess: null };
  while (!signal?.aborted) {
    const started = Date.now();
    state.lastAttempt = started;
    await writeState(state);
    try {
      const result = await job();
      if (result?.skipped) throw new Error('Job already owned');
      state.ok = true;
      state.lastSuccess = Date.now();
      log({ event: `${name}_completed` });
    } catch {
      state.ok = false;
      log({ event: `${name}_failed` });
    }
    await writeState(state);
    if (once) return state.ok;
    const delay = state.ok
      ? Math.max(1, intervalMs - (Date.now() - started))
      : retryMs;
    try {
      await sleep(delay, undefined, { signal });
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  }
}
