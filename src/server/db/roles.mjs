import pg from 'pg';
const ident = (value) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error('Invalid database role name');
  return pg.escapeIdentifier(value);
};
export async function provisionRoles(
  client,
  { migrationRole, runtimeRole, migrationPassword, runtimePassword },
) {
  const migrate = ident(migrationRole),
    runtime = ident(runtimeRole);
  if (migrationRole === runtimeRole)
    throw new Error('Database roles must be distinct');
  const database = ident(
    (await client.query('SELECT current_database() AS name')).rows[0].name,
  );
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(196742,3)');
    for (const [name, password] of [
      [migrationRole, migrationPassword],
      [runtimeRole, runtimePassword],
    ]) {
      if (typeof password !== 'string' || password.length < 32)
        throw new Error('Database role password too short');
      const current = (
        await client.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
          [name],
        )
      ).rows[0];
      if (!current)
        await client.query(
          `CREATE ROLE ${ident(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`,
        );
      else if (Object.values(current).some(Boolean))
        throw new Error('Existing database role has excessive privilege');
    }
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await client.query(
      `GRANT CONNECT ON DATABASE ${database} TO ${migrate},${runtime}`,
    );
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE,CREATE ON SCHEMA public TO ${migrate}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${runtime}`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
export async function grantRuntime(client, runtimeRole) {
  const runtime = ident(runtimeRole);
  await client.query('BEGIN');
  try {
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification,user_consents,thoughts,reactions,bookmarks,reports,rate_limit_counters TO ${runtime}`,
    );
    await client.query(
      `GRANT SELECT ON profiles,privacy_tiers,geo_datasets,geo_admin_areas,post_quota_events,admin_audit TO ${runtime}`,
    );
    await client.query(
      `GRANT INSERT(user_id,pseudonym,created_at,updated_at),UPDATE(status,suspended_at,updated_at) ON profiles TO ${runtime}`,
    );
    await client.query(`GRANT INSERT ON admin_audit TO ${runtime}`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
