import pg from 'pg';

export async function checkDatabase(connectionString) {
  if (!connectionString) return false;
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 1500,
    statement_timeout: 1500,
  });
  let timer;
  let closing;
  const close = () => (closing ??= client.end());
  // This disposable client never returns a timed-out socket to a pool. pg.end
  // destroys a client with an active query; the wire-stall test proves cleanup.
  client.on('error', () => {});
  try {
    return await Promise.race([
      (async () => {
        await client.connect();
        await client.query('SELECT 1');
        return true;
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          void close().catch(() => {});
          resolve(false);
        }, 1500);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    await close().catch(() => {});
  }
}
