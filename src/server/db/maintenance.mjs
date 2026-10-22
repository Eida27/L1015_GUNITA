import { cleanupExpired } from './cleanup.mjs';

// Dedicated connection: a session lock survives cleanup's per-batch commits.
// All replicas/operators use this same key; cleanup must not overlap deploys.
export async function runMaintenance(client, options = {}) {
  const locked = (
    await client.query('SELECT pg_try_advisory_lock(196742,5) AS locked')
  ).rows[0].locked;
  if (!locked) return { skipped: true };
  const totals = {};
  try {
    for (;;) {
      const counts = await cleanupExpired(client, options);
      for (const [key, value] of Object.entries(counts))
        totals[key] = (totals[key] ?? 0) + value;
      if (Object.values(counts).every((value) => value === 0)) break;
    }
    return { skipped: false, totals };
  } finally {
    await client.query('SELECT pg_advisory_unlock(196742,5)');
  }
}
