import { catalogs, type Locale, type MessageKey } from '@/lib/i18n/catalog';
import type { z } from 'zod';
import type { auditResponseSchema } from '@/lib/moderation-contract';
type Entry = z.infer<typeof auditResponseSchema>['items'][number];
const actions: Record<Entry['action'], MessageKey> = {
  hide: 'Hide thought',
  unhide: 'Unhide thought',
  delete_thought: 'Delete thought',
  suspend: 'Suspend account',
  unsuspend: 'Unsuspend account',
  dismiss_report: 'Dismiss report',
  review_report: 'Mark reviewing',
  bootstrap_admin: 'Grant administrator access',
};
const reasons: Record<string, MessageKey> = {
  HARASSMENT: 'Harassment',
  PRIVATE_INFO: 'Private information',
  THREATS: 'Threats',
  SELF_HARM_ENCOURAGEMENT: 'Encouragement of self-harm',
  SPAM: 'Spam',
  OTHER: 'Other',
  NO_VIOLATION: 'No violation',
  INSPECT: 'Inspect record',
  OPERATOR_CONFIRMED: 'Operator confirmed',
};
const statuses: Record<NonNullable<Entry['changedStatus']>, MessageKey> = {
  published: 'Published',
  hidden: 'Hidden',
  active: 'Active',
  suspended: 'Suspended',
  open: 'Open',
  reviewing: 'Reviewing',
  resolved: 'Resolved',
  member: 'Member',
  admin: 'Administrator',
};
const subjects: Record<Entry['subjectKind'], MessageKey> = {
  thought: 'Thought',
  account: 'Account',
  report: 'Report',
};
export function AuditEntry({ item, locale }: { item: Entry; locale: Locale }) {
  const t = (key: MessageKey) => catalogs[locale][key];
  return (
    <li>
      {t(
        item.reasonCode === 'INSPECT' ? 'Inspect record' : actions[item.action],
      )}{' '}
      · {t(reasons[item.reasonCode] ?? 'Other')} ·{' '}
      {item.changedStatus ? t(statuses[item.changedStatus]) : '—'} ·{' '}
      <time dateTime={item.createdAt}>
        {new Intl.DateTimeFormat(locale === 'fil' ? 'fil-PH' : 'en-PH', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'Asia/Manila',
        }).format(new Date(item.createdAt))}
      </time>
      <p>
        {t('Subject')}: {item.subjectReference ?? t('Unavailable')} ·{' '}
        {t(subjects[item.subjectKind])}
      </p>
      <p>
        {t('Administrator')}: {item.actorId ?? t('Unavailable')}
      </p>
    </li>
  );
}
