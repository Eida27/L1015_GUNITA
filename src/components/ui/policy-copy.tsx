'use client';
import { usePreferences } from './preferences';
import type { MessageKey } from '@/lib/i18n/catalog';
const policies = {
  terms: {
    title: 'Terms of use',
    paragraphs: [
      'Gunita is for adults aged 18 and older. The checkbox is self-attestation and does not verify age.',
      'Keep your password private. Your permanent pseudonym connects your thoughts across the service. Do not impersonate others or misuse accounts.',
      'You are responsible for what you share. Community rules apply to all content. Legal terms, jurisdiction, operator identity and contact details require external review before launch.',
    ],
  },
  privacy: {
    title: 'Privacy',
    paragraphs: [
      'Your email, password hash and sessions are private. Permanent pseudonyms allow correlation across posts; Gunita does not promise untraceability.',
      'Locations will be approximate and chosen manually, not proof of presence. Authored details can still identify you. Do not share addresses, full names or phone numbers.',
      'Thoughts expire after 30 days in the live database. Account deletion removes related live content and revokes sessions. Encrypted backups may retain prior copies for a rolling seven days; saved copies held by others cannot be erased.',
      'Local storage holds only warning version, language and theme preferences. Local test email uses Mailpit. Production processors, rights requests, retention exceptions and operator contact channels require legal/privacy review before launch.',
    ],
  },
  guidelines: {
    title: 'Community Guidelines',
    paragraphs: [
      'Ordinary non-graphic grief, heartbreak, loneliness and distress are welcome. Make room for difficult feelings with care for others.',
      'Do not post private identifying details, targeted harassment, credible threats, scams, sexual exploitation, or encouragement or instructions for self-harm or violence.',
      'The warning does not waive these rules. Moderation and reporting policies require editorial and legal review before public launch.',
    ],
  },
  help: {
    title: 'Help and support',
    paragraphs: [
      'Gunita is not an emergency response or crisis counseling service. If you feel unsafe, consider reaching out to a trusted person nearby or seeking local professional support.',
      'NCMH Crisis Hotline offers free, confidential phone support 24/7 for people in the Philippines experiencing emotional distress.',
    ],
  },
} as const satisfies Record<
  string,
  { title: MessageKey; paragraphs: readonly MessageKey[] }
>;
export type Policy = keyof typeof policies;
export function PolicyCopy({ policy }: { policy: Policy }) {
  const { t } = usePreferences();
  const content = policies[policy];
  return (
    <article className="account-card policy-copy">
      <p className="eyebrow">
        {t('Draft · External review required before public launch')}
      </p>
      <h1>{t(content.title)}</h1>
      {content.paragraphs.map((paragraph) => (
        <p key={paragraph}>{t(paragraph)}</p>
      ))}
      {policy === 'help' ? (
        <>
          <h2>NCMH Crisis Hotline</h2>
          <p>
            <a href="tel:+63180018881553?oai_link_source=model_response_hotline">
              1800-1888-1553
            </a>
          </p>
          <p>
            <a href="https://www.facebook.com/ncmhcrisishotline?mibextid=LQQJ4d&oai_link_source=model_response_hotline">
              https://www.facebook.com/ncmhcrisishotline?mibextid=LQQJ4d
            </a>
          </p>
          <p>
            {t(
              'Resource details checked on 24 October 2026. Contact availability can change. External resource and native-language review is required before public launch.',
            )}
          </p>
        </>
      ) : null}
      <p className="field-help">
        {t(
          'External legal, privacy, native-language and crisis-resource review is required before public launch. This draft is not legal advice or certification.',
        )}
      </p>
    </article>
  );
}
