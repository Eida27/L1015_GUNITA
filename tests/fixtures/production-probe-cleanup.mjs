// Self-contained: rehearse.mjs sends this function and the probe over stdin.
export async function cleanupProductionProbe({
  client,
  bootstrap,
  runtime,
  author,
  restore,
}) {
  let failed = false;
  try {
    await client.query('DELETE FROM "user" WHERE id=$1', [author]);
    const result = await client.query(
      'SELECT count(*)::int AS n FROM "user" WHERE id=$1',
      [author],
    );
    if (result.rows[0]?.n !== 0) throw new Error('Fixture remains');
  } catch {
    failed = true;
  }
  try {
    if (restore) {
      if (!/^gunita_restore_[a-f0-9]{16}$/.test(restore.name))
        throw new Error('Invalid restore ownership');
      await bootstrap.query(`DROP DATABASE "${restore.name}" WITH (FORCE)`);
    }
  } catch {
    failed = true;
  }
  for (const connection of [runtime, client, bootstrap]) {
    try {
      await connection.end();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    console.error(JSON.stringify({ event: 'rehearsal_cleanup_failed' }));
    process.exitCode = 1;
  }
}
