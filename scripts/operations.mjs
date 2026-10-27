import pg from 'pg';
import { readFile, statfs } from 'node:fs/promises';
import { runMaintenance } from '../src/server/db/maintenance.mjs';
import { checkDatabase } from '../src/server/db/readiness.mjs';
import { backupDatabase } from './backup-lib.mjs';
import { externalBackupPath } from './backup-paths.mjs';
import { runScheduledJob, writeJobState } from './job-runner.mjs';

const name = process.env.OPERATIONS_JOB;
const controller = new AbortController();
for (const event of ['SIGTERM', 'SIGINT'])
  process.once(event, () => controller.abort());
async function withDatabase(fn) {
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    application_name: `gunita-${name}`,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 35000,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function age(file) {
  try {
    const state = JSON.parse(await readFile(file, 'utf8'));
    return {
      ageSeconds: Number.isFinite(state.lastSuccess)
        ? Math.max(0, Math.floor((Date.now() - state.lastSuccess) / 1000))
        : null,
      ok: state.ok === true,
    };
  } catch {
    return { ageSeconds: null, ok: false };
  }
}
const jobs = {
  maintenance: () => withDatabase(runMaintenance),
  backup: async () =>
    backupDatabase({
      databaseUrl: process.env.BACKUP_DATABASE_URL,
      destination: await externalBackupPath(process.env.BACKUP_DESTINATION),
      keyFile: await externalBackupPath(process.env.BACKUP_KEY_FILE),
      destinationKind: process.env.BACKUP_DESTINATION_KIND,
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 7),
    }),
  metrics: async () => {
    const dbReady = await checkDatabase(process.env.MIGRATION_DATABASE_URL);
    const response = await fetch('http://web:3000/api/ready', {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    const metrics = await withDatabase(
      async (client) =>
        (
          await client.query(`SELECT
      (SELECT count(*)::int FROM thoughts WHERE expires_at<=statement_timestamp()) AS expired_live_rows,
      (SELECT coalesce(extract(epoch FROM statement_timestamp()-min(expires_at)),0)::int FROM thoughts WHERE expires_at<=statement_timestamp()) AS cleanup_lag_seconds,
      (SELECT count(*)::int FROM reports WHERE status IN ('open','reviewing')) AS moderation_queue_size,
      (SELECT coalesce(extract(epoch FROM statement_timestamp()-min(created_at)),0)::int FROM reports WHERE status IN ('open','reviewing')) AS moderation_oldest_seconds`)
        ).rows[0],
    );
    const disk = await statfs('/archives');
    console.log(
      JSON.stringify({
        event: 'operations_metrics',
        uptime_seconds: Math.floor(process.uptime()),
        web_ready: response?.ok === true,
        database_ready: dbReady,
        ...metrics,
        backup: await age('/state/backup.json'),
        maintenance: await age('/state/maintenance.json'),
        archive_disk_free_bytes: disk.bavail * disk.bsize,
      }),
    );
  },
};
if (!jobs[name]) throw new Error('Unknown operation');
const ok = await runScheduledJob({
  name,
  job: jobs[name],
  intervalMs: { maintenance: 3600000, backup: 86400000, metrics: 60000 }[name],
  signal: controller.signal,
  once: process.argv.includes('--once'),
  writeState: (state) => writeJobState(`/state/${name}.json`, state),
});
if (ok === false) process.exitCode = 1;
