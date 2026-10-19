// Explicit SQL migrations are authoritative for triggers/permissions/PostGIS checks.
// Never apply drizzle-kit push; additions require a reviewed versioned migration.
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  smallint,
  integer,
  primaryKey,
  index,
  check,
  geometry,
  customType,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
export * from './auth-schema';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const profileRole = pgEnum('profile_role', ['member', 'admin']);
export const profileStatus = pgEnum('profile_status', ['active', 'suspended']);
export const emotion = pgEnum('emotion', [
  'love',
  'heartbreak',
  'regret',
  'loneliness',
  'gratitude',
  'hope',
  'happiness',
  'confession',
  'other',
]);
export const thoughtStatus = pgEnum('thought_status', ['published', 'hidden']);
export const reactionType = pgEnum('reaction_type', [
  'love',
  'sad',
  'care',
  'happy',
]);
export const reportReason = pgEnum('report_reason', [
  'harassment',
  'private_info',
  'threats',
  'self_harm_encouragement',
  'spam',
  'other',
]);
export const reportStatus = pgEnum('report_status', [
  'open',
  'reviewing',
  'resolved',
]);
export const auditAction = pgEnum('audit_action', [
  'hide',
  'unhide',
  'delete_thought',
  'suspend',
  'unsuspend',
  'dismiss_report',
  'review_report',
  'bootstrap_admin',
]);
export const auditSubject = pgEnum('audit_subject', [
  'thought',
  'account',
  'report',
]);
const userFk = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: 'cascade' });
export const profiles = pgTable(
  'profiles',
  {
    userId: userFk('user_id').primaryKey(),
    pseudonym: text('pseudonym').notNull().unique(),
    role: profileRole('role').notNull().default('member'),
    status: profileStatus('status').notNull().default('active'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    suspendedAt: time('suspended_at'),
  },
  (t) => [
    check(
      'profiles_pseudonym_check',
      sql`${t.pseudonym} ~ '^[A-Za-z][A-Za-z0-9-]{7,63}$'`,
    ),
  ],
);
export const userConsents = pgTable(
  'user_consents',
  {
    userId: userFk('user_id').notNull(),
    guidelinesVersion: text('guidelines_version').notNull(),
    acceptedAt: time('accepted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.guidelinesVersion] }),
    check(
      'user_consents_guidelines_version_check',
      sql`length(${t.guidelinesVersion}) BETWEEN 1 AND 64`,
    ),
  ],
);
export const geoDatasets = pgTable(
  'geo_datasets',
  {
    version: integer('version').primaryKey(),
    sourceId: text('source_id').notNull().unique(),
    sourceUrl: text('source_url').notNull(),
    attribution: text('attribution').notNull(),
    license: text('license').notNull(),
    sha256: text('sha256').notNull(),
    importedAt: time('imported_at').notNull().defaultNow(),
  },
  (t) => [
    check('geo_datasets_version_check', sql`${t.version}>0`),
    check('geo_datasets_sha256_check', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);
export const privacyTiers = pgTable(
  'privacy_tiers',
  {
    tier: smallint('tier').primaryKey(),
    label: text('label').notNull().unique(),
    algorithmVersion: integer('algorithm_version').notNull(),
  },
  (t) => [
    check('privacy_tiers_tier_check', sql`${t.tier} IN(5,6,7)`),
    check(
      'privacy_tiers_algorithm_version_check',
      sql`${t.algorithmVersion}>0`,
    ),
  ],
);
const multiPolygon = customType<{ data: string }>({
  dataType: () => 'geometry(MultiPolygon,4326)',
});
export const geoAdminAreas = pgTable(
  'geo_admin_areas',
  {
    datasetVersion: integer('dataset_version')
      .notNull()
      .references(() => geoDatasets.version),
    sourceFeatureId: text('source_feature_id').notNull(),
    sourceLabel: text('source_label').notNull(),
    publicLabel: text('public_label').notNull(),
    privacyTier: smallint('privacy_tier')
      .notNull()
      .references(() => privacyTiers.tier),
    geom: multiPolygon('geom').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.datasetVersion, t.sourceFeatureId] }),
    index('geo_admin_areas_geom_gist').using('gist', t.geom),
    check(
      'geo_admin_areas_public_label_check',
      sql`length(${t.publicLabel}) BETWEEN 1 AND 100`,
    ),
    check(
      'geo_admin_areas_geom_check',
      sql`NOT ST_IsEmpty(${t.geom}) AND ST_IsValid(${t.geom})`,
    ),
  ],
);
export const thoughts = pgTable(
  'thoughts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull().unique(),
    authorId: userFk('author_id').notNull(),
    body: text('body').notNull(),
    emotion: emotion('emotion').notNull(),
    publicPoint: geometry('public_point', {
      type: 'point',
      mode: 'tuple',
      srid: 4326,
    }).notNull(),
    privacyCell: text('privacy_cell').notNull(),
    privacyTier: smallint('privacy_tier')
      .notNull()
      .references(() => privacyTiers.tier),
    privacyAlgorithmVersion: integer('privacy_algorithm_version').notNull(),
    locationLabel: text('location_label').notNull(),
    locationRegionCode: text('location_region_code'),
    status: thoughtStatus('status').notNull().default('published'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    expiresAt: time('expires_at').notNull(),
  },
  (t) => [
    index('thoughts_public_point_gist').using('gist', t.publicPoint),
    index('thoughts_status_expiry_created').on(
      t.status,
      t.expiresAt,
      t.createdAt.desc(),
    ),
    index('thoughts_author_expiry').on(t.authorId, t.expiresAt.desc()),
    check(
      'thoughts_expiry',
      sql`${t.expiresAt}=${t.createdAt}+interval '720 hours'`,
    ),
    check(
      'thoughts_public_id_check',
      sql`${t.publicId} ~ '^t_[A-Za-z0-9_-]{22,64}$'`,
    ),
    check(
      'thoughts_body_check',
      sql`length(${t.body})>0 AND octet_length(${t.body})<=16384`,
    ),
    check(
      'thoughts_privacy_cell_check',
      sql`${t.privacyCell} ~ '^[0-9a-f]{15}$'`,
    ),
    check(
      'thoughts_privacy_algorithm_version_check',
      sql`${t.privacyAlgorithmVersion}>0`,
    ),
    check(
      'thoughts_location_label_check',
      sql`length(${t.locationLabel}) BETWEEN 1 AND 100`,
    ),
    check(
      'thoughts_public_point_check',
      sql`NOT ST_IsEmpty(${t.publicPoint}) AND ST_IsValid(${t.publicPoint}) AND ST_X(${t.publicPoint}) BETWEEN -180 AND 180 AND ST_Y(${t.publicPoint}) BETWEEN -90 AND 90`,
    ),
  ],
);
export const postQuotaEvents = pgTable(
  'post_quota_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: userFk('author_id').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('post_quota_events_author_time').on(t.authorId, t.createdAt),
    index('post_quota_events_cleanup').on(t.createdAt),
  ],
);
export const reactions = pgTable(
  'reactions',
  {
    userId: userFk('user_id').notNull(),
    thoughtId: uuid('thought_id')
      .notNull()
      .references(() => thoughts.id, { onDelete: 'cascade' }),
    type: reactionType('type').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.thoughtId] }),
    index('reactions_thought').on(t.thoughtId),
  ],
);
export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: userFk('user_id').notNull(),
    thoughtId: uuid('thought_id')
      .notNull()
      .references(() => thoughts.id, { onDelete: 'cascade' }),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.thoughtId] }),
    index('bookmarks_thought').on(t.thoughtId),
  ],
);
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thoughtId: uuid('thought_id')
      .notNull()
      .references(() => thoughts.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reason: reportReason('reason').notNull(),
    details: text('details'),
    status: reportStatus('status').notNull().default('open'),
    createdAt: time('created_at').notNull().defaultNow(),
    resolvedAt: time('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('reports_queue').on(t.status, t.createdAt),
    index('reports_thought').on(t.thoughtId),
    index('reports_reporter').on(t.reporterUserId),
    index('reports_resolved_by').on(t.resolvedBy),
    check('reports_details_check', sql`length(${t.details})<=500`),
  ],
);
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    action: auditAction('action').notNull(),
    subjectKind: auditSubject('subject_kind').notNull(),
    subjectUserId: uuid('subject_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    subjectThoughtId: uuid('subject_thought_id').references(() => thoughts.id, {
      onDelete: 'set null',
    }),
    subjectReportId: uuid('subject_report_id').references(() => reports.id, {
      onDelete: 'set null',
    }),
    reasonCode: text('reason_code').notNull(),
    changedStatus: text('changed_status'),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_retention').on(t.createdAt),
    index('admin_audit_admin').on(t.adminUserId),
    index('admin_audit_subject_user').on(t.subjectUserId),
    index('admin_audit_subject_thought').on(t.subjectThoughtId),
    index('admin_audit_subject_report').on(t.subjectReportId),
    check(
      'admin_audit_reason_code_check',
      sql`${t.reasonCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      'admin_audit_changed_status_check',
      sql`${t.changedStatus} IN('published','hidden','active','suspended','open','reviewing','resolved','member','admin')`,
    ),
    check(
      'admin_audit_check',
      sql`num_nonnulls(${t.subjectUserId},${t.subjectThoughtId},${t.subjectReportId})<=1`,
    ),
  ],
);
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    bucketHmac: text('bucket_hmac').notNull(),
    routeGroup: text('route_group').notNull(),
    windowStart: time('window_start').notNull(),
    count: integer('count').notNull(),
    expiresAt: time('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucketHmac, t.routeGroup, t.windowStart] }),
    index('rate_limit_expiry').on(t.expiresAt),
    check(
      'rate_limit_counters_bucket_hmac_check',
      sql`${t.bucketHmac} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'rate_limit_counters_route_group_check',
      sql`length(${t.routeGroup}) BETWEEN 1 AND 64`,
    ),
    check('rate_limit_counters_count_check', sql`${t.count}>=0`),
    check(
      'rate_limit_counters_check',
      sql`${t.expiresAt}>${t.windowStart} AND ${t.expiresAt}<=${t.windowStart}+interval '24 hours'`,
    ),
  ],
);
