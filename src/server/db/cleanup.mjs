// Owns its transaction. Caller must provide a maintenance/migration connection,
// never the web runtime credentials. A batch bounds locks and WAL per invocation.
export async function cleanupExpired(client, { batchSize = 500 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000)
    throw new Error('Invalid cleanup batch size');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    const counts = {};
    const deletions = [
      ['thoughts', 'expires_at <= statement_timestamp()', 'expires_at'],
      [
        'post_quota_events',
        "created_at <= statement_timestamp()-interval '25 hours'",
        'created_at',
      ],
      [
        'rate_limit_counters',
        'expires_at <= statement_timestamp()',
        'expires_at',
      ],
      ['verification', 'expires_at <= statement_timestamp()', 'expires_at'],
      ['session', 'expires_at <= statement_timestamp()', 'expires_at'],
      [
        'admin_audit',
        "created_at <= statement_timestamp()-interval '90 days'",
        'created_at',
      ],
    ];
    // These identifiers/predicates are static code, never request input.
    for (const [table, predicate, order] of deletions) {
      const result = await client.query(
        `WITH batch AS (
        SELECT ctid FROM ${table} WHERE ${predicate} ORDER BY ${order} LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM ${table} t USING batch WHERE t.ctid=batch.ctid`,
        [batchSize],
      );
      counts[table] = result.rowCount;
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
