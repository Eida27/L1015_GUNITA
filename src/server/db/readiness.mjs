import pg from 'pg';

export async function checkDatabase(connectionString) {
  if (!connectionString) return false;
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
