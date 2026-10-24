import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createMapDatabase } from '../fixtures/map-database';
let db: Awaited<ReturnType<typeof createMapDatabase>>;
let author: string, member: string, thought: string;
beforeAll(async () => {
  db = await createMapDatabase();
  const users = await db.operator.query(
    `INSERT INTO "user"(name,email) VALUES('Internal','category-author@test.invalid'),('Internal','category-member@test.invalid') RETURNING id`,
  );
  [author, member] = users.rows.map((r) => r.id);
  thought = (
    await db.operator.query(
      `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label) VALUES('t_abcdefghijklmnopqrstuv',$1,'Synthetic category fixture','hope',ST_SetSRID(ST_MakePoint(120.98,14.6),4326),'87752a30dffffff',7,1,'Metro Manila') RETURNING id`,
      [author],
    )
  ).rows[0].id;
}, 60000);
afterAll(async () => {
  await db?.close();
});
it('retains original member and guest categories after reporter deletion and forbids recategorization', async () => {
  await db.pool.query(
    `INSERT INTO reports(thought_id,reporter_user_id,reporter_category,reason) VALUES($1,$2,'member','other'),($1,NULL,'guest','other')`,
    [thought, member],
  );
  await db.operator.query('DELETE FROM "user" WHERE id=$1', [member]);
  expect(
    (
      await db.pool.query(
        'SELECT reporter_user_id,reporter_category FROM reports ORDER BY reporter_category',
      )
    ).rows,
  ).toEqual([
    { reporter_user_id: null, reporter_category: 'guest' },
    { reporter_user_id: null, reporter_category: 'member' },
  ]);
  await expect(
    db.pool.query(
      "UPDATE reports SET reporter_category='guest' WHERE reporter_category='member'",
    ),
  ).rejects.toThrow('Original reporter category is immutable');
});
it('refuses ambiguous legacy NULL reporters atomically and only backfills linked legacy members', async () => {
  const sql = await readFile(
    'src/server/db/migrations/0007_reporter_category.sql',
    'utf8',
  );
  for (const linked of [false, true]) {
    await db.operator.query('BEGIN');
    try {
      await db.operator.query('DELETE FROM reports');
      await db.operator.query(
        'DROP TRIGGER reports_category_immutable ON reports',
      );
      await db.operator.query('DROP FUNCTION preserve_reporter_category()');
      await db.operator.query(
        'ALTER TABLE reports DROP COLUMN reporter_category',
      );
      await db.operator.query(
        "INSERT INTO reports(thought_id,reporter_user_id,reason) VALUES($1,$2,'other')",
        [thought, linked ? author : null],
      );
      if (linked) {
        await db.operator.query(sql);
        expect(
          (await db.operator.query('SELECT reporter_category FROM reports'))
            .rows[0].reporter_category,
        ).toBe('member');
      } else
        await expect(db.operator.query(sql)).rejects.toThrow(
          'Legacy report category is ambiguous',
        );
    } finally {
      await db.operator.query('ROLLBACK');
    }
  }
});
