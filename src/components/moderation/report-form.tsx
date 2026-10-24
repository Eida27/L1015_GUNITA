'use client';
import Link from 'next/link';
import { useState, useRef } from 'react';
import { usePreferences } from '@/components/ui/preferences';
import { VerificationWidget } from '@/components/ui/verification-widget';
import { reportReasons, reportInputSchema } from '@/lib/moderation-contract';
import { mutationReceiptSchema } from '@/lib/thought-contract';
import { errorKey, type MessageKey } from '@/lib/i18n/catalog';
export const reasonLabels = {
  harassment: 'Harassment',
  private_info: 'Private information',
  threats: 'Threats',
  self_harm_encouragement: 'Encouragement of self-harm',
  spam: 'Spam',
  other: 'Other',
} as const;
export function ReportForm({ publicId }: { publicId: string }) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false),
    [attempt, setAttempt] = useState(0),
    [message, setMessage] = useState<MessageKey | ''>('');
  const token = useRef('');
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('Report thought')}</summary>
      {open ? (
        <form
          className="account-form"
          method="post"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage('');
            const form = event.currentTarget,
              data = new FormData(form);
            try {
              const body = reportInputSchema.parse({
                thoughtPublicId: publicId,
                reason: data.get('reason'),
                details: data.get('details') || '',
                turnstileToken: token.current,
              });
              const response = await fetch('/api/reports', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                cache: 'no-store',
              });
              const output = await response.json();
              if (!response.ok) throw new Error(output.code);
              mutationReceiptSchema.parse(output);
              form.reset();
              setMessage(
                'Thank you. If this thought is available, your report will be reviewed. Reports do not automatically remove thoughts.',
              );
            } catch (error) {
              setMessage(
                errorKey(error instanceof Error ? error.message : undefined),
              );
            } finally {
              token.current = '';
              setVerified(false);
              setAttempt((n) => n + 1);
              setBusy(false);
            }
          }}
        >
          <p>
            {t(
              'Reports are reviewed by moderators. Do not include names, addresses, phone numbers or other private information.',
            )}
          </p>
          <label>
            {t('Reason')}
            <select name="reason" required>
              {reportReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {t(reasonLabels[reason])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Details (optional, up to 500 characters)')}
            <textarea name="details" maxLength={500} />
          </label>
          <VerificationWidget
            key={attempt}
            action="report"
            onToken={(value) => {
              token.current = value;
              setVerified(!!value);
            }}
          />
          <button disabled={busy || !verified}>{t('Submit report')}</button>
          {message ? <p role="status">{t(message)}</p> : null}
          <Link prefetch={false} href="/help">
            {t('Help and support')}
          </Link>
        </form>
      ) : null}
    </details>
  );
}
