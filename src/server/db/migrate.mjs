import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('./migrations/', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function relationInventory(client) {
  return (
    await client.query(`SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid) ELSE '' END AS view_definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','S','f')
      AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_class'::regclass AND dep.objid=c.oid AND dep.deptype='e')
    ORDER BY c.relname,c.relkind`)
  ).rows.map((row) => [
    row.name,
    row.kind,
    row.rls,
    row.force_rls,
    row.view_definition,
  ]);
}

// Catalog expressions, rather than the migration ledger alone, detect manual drift.
export async function schemaFingerprint(client) {
  const result = await client.query(`
    SELECT kind, name, definition FROM (
      SELECT 'column' kind, c.relname || '.' || a.attname name,
        format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull || ':' ||
        coalesce(pg_get_expr(d.adbin,d.adrelid),'') definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relname <> 'schema_migrations'
        AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_class'::regclass AND dep.objid=c.oid AND dep.deptype='e')
      UNION ALL SELECT 'constraint', c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname <> 'schema_migrations'
        AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_class'::regclass AND dep.objid=c.oid AND dep.deptype='e')
      UNION ALL SELECT 'index', i.relname, pg_get_indexdef(i.oid)
      FROM pg_class i JOIN pg_index x ON x.indexrelid=i.oid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname <> 'schema_migrations'
        AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_class'::regclass AND dep.objid=c.oid AND dep.deptype='e')
      UNION ALL SELECT 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'
        AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_proc'::regclass AND dep.objid=p.oid AND dep.deptype='e')
      UNION ALL SELECT 'enum', t.typname || ':' || e.enumsortorder, e.enumlabel
      FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
    ) objects ORDER BY kind,name,definition`);
  return hash(JSON.stringify(result.rows));
}

export async function migrate(client, migrationDirectory = directory) {
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  if (!files.length) throw new Error('No versioned migrations found');
  const migrations = await Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(migrationDirectory, name), 'utf8');
      return { name, sql, checksum: hash(sql) };
    }),
  );
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='30s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('SELECT pg_advisory_xact_lock(196742,1)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, schema_checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = (
      await client.query('SELECT * FROM schema_migrations ORDER BY name')
    ).rows;
    for (let index = 0; index < applied.length; index++) {
      if (
        migrations[index]?.name !== applied[index].name ||
        migrations[index]?.checksum !== applied[index].checksum
      )
        throw new Error(
          'Migration history/checksum mismatch; restore the reviewed files before continuing',
        );
    }
    if (
      applied.length &&
      (await schemaFingerprint(client)) !== applied.at(-1).schema_checksum
    )
      throw new Error(
        'Database schema drift; inspect and repair explicitly before migrating',
      );
    if (
      applied.some((row) => row.name === '0004_schema_inventory.sql') &&
      !Array.isArray(applied.at(-1)?.relation_inventory)
    )
      throw new Error(
        'Database schema drift; required relation inventory is missing',
      );
    if (
      applied.at(-1)?.relation_inventory &&
      JSON.stringify(await relationInventory(client)) !==
        JSON.stringify(applied.at(-1).relation_inventory)
    )
      throw new Error(
        'Database schema drift; unexpected relation, view or row-security change',
      );
    if (!applied.length) {
      const { rows } = await client.query(
        "SELECT to_regclass('public.thoughts') AS existing",
      );
      if (rows[0].existing)
        throw new Error('Untracked existing domain schema; migration refused');
    }
    let count = 0;
    for (const migration of migrations.slice(applied.length)) {
      await client.query(migration.sql);
      const inventorySupported =
        (
          await client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' AND column_name='relation_inventory'",
          )
        ).rowCount > 0;
      if (inventorySupported)
        await client.query(
          'INSERT INTO schema_migrations(name,checksum,schema_checksum,relation_inventory) VALUES($1,$2,$3,$4)',
          [
            migration.name,
            migration.checksum,
            await schemaFingerprint(client),
            JSON.stringify(await relationInventory(client)),
          ],
        );
      else
        await client.query(
          'INSERT INTO schema_migrations(name,checksum,schema_checksum) VALUES($1,$2,$3)',
          [migration.name, migration.checksum, await schemaFingerprint(client)],
        );
      count++;
    }
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
