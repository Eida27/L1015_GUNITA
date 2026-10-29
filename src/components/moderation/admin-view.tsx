'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, useRef } from 'react';
import { z } from 'zod';
import { AuthShell } from '@/components/auth/auth-shell';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '@/components/ui/public-content-gate';
import { usePreferences } from '@/components/ui/preferences';
import {
  reportsResponseSchema,
  auditResponseSchema,
  accountsResponseSchema,
  reasonCodes,
  type AdminReport,
  type AdminAccount,
  reportViews,
  type ReportView,
} from '@/lib/moderation-contract';
import { mutationReceiptSchema } from '@/lib/thought-contract';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
import { reasonLabels } from './report-form';
import { AuditEntry } from './audit-entry';
const reasonText = {
  HARASSMENT: 'Harassment',
  PRIVATE_INFO: 'Private information',
  THREATS: 'Threats',
  SELF_HARM_ENCOURAGEMENT: 'Encouragement of self-harm',
  SPAM: 'Spam',
  OTHER: 'Other',
  NO_VIOLATION: 'No violation',
} as const;
const statusText = {
  open: 'Open',
  reviewing: 'Reviewing',
  resolved: 'Resolved',
  published: 'Published',
  hidden: 'Hidden',
  active: 'Active',
  suspended: 'Suspended',
} as const;
function AccountCard({
  account,
  onChange,
}: {
  account: AdminAccount;
  onChange: () => void;
}) {
  const { t } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  return (
    <article className="account-card">
      <h2>{account.pseudonym}</h2>
      <p>
        {t('Account reference')}: {account.id}
      </p>
      <p>
        {t('Account status')}: {t(statusText[account.status])}
      </p>
      <form
        className="account-form"
        method="post"
        onSubmit={async (event) => {
          event.preventDefault();
          const reasonCode = new FormData(event.currentTarget).get(
            'reasonCode',
          );
          setBusy(true);
          setError('');
          try {
            const response = await fetch(
              `/api/admin/accounts/${account.id}/suspension`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                  suspended: account.status !== 'suspended',
                  reasonCode,
                }),
              },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.code);
            mutationReceiptSchema.parse(result);
            onChange();
          } catch (error) {
            setError(
              errorKey(error instanceof Error ? error.message : undefined),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t('Justification')}
          <select name="reasonCode" required defaultValue="">
            <option value="">{t('Choose a reason')}</option>
            {reasonCodes.map((reason) => (
              <option key={reason} value={reason}>
                {t(reasonText[reason])}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>
          {t(
            account.status === 'suspended'
              ? 'Unsuspend account'
              : 'Suspend account',
          )}
        </button>
        {error ? <p role="alert">{t(error)}</p> : null}
      </form>
    </article>
  );
}
function ReportCard({
  report,
  onChange,
}: {
  report: AdminReport;
  onChange: () => void;
}) {
  const { t, locale } = usePreferences();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | ''>(''),
    [action, setAction] = useState('reviewing');
  return (
    <article className="account-card">
      <h2>
        {t(reasonLabels[report.reason])} · {t(statusText[report.status])}
      </h2>
      <p>
        {new Date(report.createdAt).toLocaleString(
          locale === 'fil' ? 'fil-PH' : 'en-PH',
          { timeZone: 'Asia/Manila' },
        )}{' '}
        ·{' '}
        {t(
          report.reporterCategory === 'guest'
            ? 'Guest report'
            : 'Member report',
        )}
      </p>
      {report.details ? <p className="thought-body">{report.details}</p> : null}
      {report.thought ? (
        <>
          <blockquote className="thought-body">
            {report.thought.body}
          </blockquote>
          <p>
            {report.thought.pseudonym} · {report.thought.location.label} ·{' '}
            {t(statusText[report.thoughtStatus!])}
          </p>
        </>
      ) : (
        <p>{t('This thought is unavailable.')}</p>
      )}
      {report.author ? (
        <p>
          {t('Account status')}: {t(statusText[report.author.status])}
        </p>
      ) : null}
      <form
        className="account-form"
        method="post"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const data = new FormData(event.currentTarget);
          const reasonCode = data.get('reasonCode');
          let path = `/api/admin/reports/${report.id}`,
            method = 'PATCH',
            body: unknown = { status: action, reasonCode };
          if (['hide', 'unhide', 'delete'].includes(action)) {
            path = `/api/admin/thoughts/${report.thought?.publicId}/moderate`;
            method = 'POST';
            body = { action, reasonCode };
          } else if (['suspend', 'unsuspend'].includes(action)) {
            path = `/api/admin/accounts/${report.author?.id}/suspension`;
            method = 'POST';
            body = { suspended: action === 'suspend', reasonCode };
          }
          try {
            const response = await fetch(path, {
              method,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              cache: 'no-store',
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.code);
            mutationReceiptSchema.parse(result);
            onChange();
          } catch (error) {
            setError(
              errorKey(error instanceof Error ? error.message : undefined),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t('Moderation action')}
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            {Object.entries({
              reviewing: 'Mark reviewing',
              resolved: 'Dismiss report',
              hide: 'Hide thought',
              unhide: 'Unhide thought',
              delete: 'Delete thought',
              suspend: 'Suspend account',
              unsuspend: 'Unsuspend account',
            } as const).map(([value, label]) => (
              <option value={value} key={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Justification')}
          <select name="reasonCode" required defaultValue="">
            <option value="">{t('Choose a reason')}</option>
            {reasonCodes.map((reason) => (
              <option key={reason} value={reason}>
                {t(reasonText[reason])}
              </option>
            ))}
          </select>
        </label>
        {action === 'delete' ? (
          <label>
            <input type="checkbox" required />
            {t('I confirm permanent deletion of this thought.')}
          </label>
        ) : null}
        <button disabled={busy}>{t('Apply action')}</button>
        {error ? <p role="alert">{t(error)}</p> : null}
      </form>
    </article>
  );
}
function AdminContent({
  kind,
  signal,
}: {
  kind: 'reports' | 'accounts' | 'audit';
  signal: AbortSignal;
}) {
  const { t, store, locale } = usePreferences();
  const [view, setView] = useState<ReportView>('actionable');
  const [reports, setReports] = useState<z.infer<
      typeof reportsResponseSchema
    > | null>(null),
    [audits, setAudits] = useState<z.infer<typeof auditResponseSchema> | null>(
      null,
    ),
    [accounts, setAccounts] = useState<z.infer<
      typeof accountsResponseSchema
    > | null>(null),
    [error, setError] = useState<MessageKey | ''>(''),
    [cursor, setCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(),
      combined = AbortSignal.any([controller.signal, signal]);
    const clear = () => {
      setReports(null);
      setAudits(null);
      setAccounts(null);
    };
    const refresh = () => {
      clear();
      controller.abort();
      setAttempt((n) => n + 1);
    };
    const visibility = () => {
      if (document.hidden) {
        clear();
        controller.abort();
      } else refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visibility);
    const active = () =>
      !combined.aborted && !document.hidden && store.isAcknowledged();
    if (active())
      fetch(
        `/api/admin/${kind}?${new URLSearchParams({ ...(kind === 'reports' ? { view } : {}), ...(cursor ? { cursor } : {}) })}`,
        { cache: 'no-store', signal: combined },
      )
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.code);
          if (!active()) return;
          if (kind === 'audit') setAudits(auditResponseSchema.parse(data));
          else if (kind === 'accounts')
            setAccounts(accountsResponseSchema.parse(data));
          else setReports(reportsResponseSchema.parse(data));
        })
        .catch((error) => {
          if (active())
            setError(
              errorKey(error instanceof Error ? error.message : undefined),
            );
        });
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [kind, cursor, attempt, signal, store, view]);
  useEffect(() => {
    if (!reports?.items.length) return;
    const expiry = Math.min(
      ...reports.items
        .filter((r) => r.thought)
        .map((r) => Date.parse(r.thought!.expiresAt)),
    );
    const timer = setTimeout(
      () => {
        setReports(null);
        setAttempt((n) => n + 1);
      },
      Math.max(0, Math.min(2147483647, expiry - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [reports]);
  function refresh() {
    setReports(null);
    setAudits(null);
    setAccounts(null);
    setError('');
    setCursor(null);
    setAttempt((n) => n + 1);
    heading.current?.focus();
  }
  const result =
    kind === 'audit' ? audits : kind === 'accounts' ? accounts : reports;
  return (
    <>
      <h1 tabIndex={-1} ref={heading}>
        {t(
          kind === 'audit'
            ? 'Moderation history'
            : kind === 'accounts'
              ? 'Reported accounts'
              : 'Reports queue',
        )}
      </h1>
      <nav className="dashboard-nav">
        <Link prefetch={false} href="/admin/reports">
          {t('Reports queue')}
        </Link>
        <Link prefetch={false} href="/admin/accounts">
          {t('Reported accounts')}
        </Link>
        <Link prefetch={false} href="/admin/audit">
          {t('Moderation history')}
        </Link>
        <Link prefetch={false} href="/log-out">
          {t('Sign out')}
        </Link>
      </nav>
      {kind === 'reports' ? (
        <label className="account-form">
          {t('Report view')}
          <select
            value={view}
            onChange={(event) => {
              setView(event.target.value as ReportView);
              refresh();
            }}
          >
            {reportViews.map((value) => (
              <option key={value} value={value}>
                {t(
                  (
                    {
                      actionable: 'Awaiting action',
                      open: 'Open',
                      reviewing: 'Reviewing',
                      resolved: 'Resolved',
                      all: 'All reports',
                    } as const
                  )[value],
                )}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p>
        {t(
          kind === 'accounts'
            ? 'Reported and suspended accounts.'
            : 'Reports do not automatically hide thoughts. Review the context and select a justification for each action.',
        )}
      </p>
      {error ? (
        <p role="alert">{t(error)}</p>
      ) : !result ? (
        <p role="status">{t('Please wait…')}</p>
      ) : !result.items.length ? (
        <p>
          {t(
            kind === 'accounts'
              ? 'No accounts to show.'
              : 'No reports to show.',
          )}
        </p>
      ) : null}
      {reports?.items.map((report) => (
        <ReportCard key={report.id} report={report} onChange={refresh} />
      ))}
      {accounts?.items.map((account) => (
        <AccountCard key={account.id} account={account} onChange={refresh} />
      ))}
      {audits ? (
        <ul>
          {audits.items.map((item) => (
            <AuditEntry key={item.id} item={item} locale={locale} />
          ))}
        </ul>
      ) : null}
      {result?.nextCursor ? (
        <button
          onClick={() => {
            setReports(null);
            setAudits(null);
            setAccounts(null);
            setCursor(result.nextCursor);
          }}
        >
          {t('Next page')}
        </button>
      ) : null}
      {cursor ? (
        <button
          onClick={() => {
            setReports(null);
            setAudits(null);
            setAccounts(null);
            setCursor(null);
          }}
        >
          {t('Back to first page')}
        </button>
      ) : null}
      <button onClick={refresh}>{t('Refresh')}</button>
    </>
  );
}
export function AdminView({
  kind,
}: {
  kind: 'reports' | 'accounts' | 'audit';
}) {
  // Reuse the existing acknowledged-content boundary; never SSR reports/identity.
  const loader = useCallback<PublicContentLoader>(
    async (signal) =>
      function AuthorizedAdmin() {
        return <AdminContent kind={kind} signal={signal} />;
      },
    [kind],
  );
  return (
    <AuthShell>
      <PublicContentGate load={loader} />
    </AuthShell>
  );
}
