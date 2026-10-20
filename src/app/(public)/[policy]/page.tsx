import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
const policies = {
  terms: {
    title: 'Terms of use',
    paragraphs: [
      'Gunita is for adults aged 18 and older. This local version is under development; public launch terms require review.',
      'Keep your password private. Your random account pseudonym is permanent and connects your thoughts across the service. Do not impersonate other people or misuse another account.',
      'You retain responsibility for what you share. Do not post illegal material, private identifying information, harassment or threats. Content may be moderated under the Community Guidelines.',
    ],
  },
  privacy: {
    title: 'Privacy',
    paragraphs: [
      'Your email, password hash and account sessions are private. We do not display your email or real name on thoughts, and do not request your real name.',
      'Permanent pseudonyms allow people to connect thoughts written by the same account. Gunita does not promise that posts are untraceable. Do not share identifying details.',
      'Deleting your account removes it and related live content and revokes sessions. Prior encrypted backups can retain copies for a rolling seven days. Verification and reset links expire after one hour.',
      'This is a local development version using Mailpit for test email. Production providers, contact channels and legal details must be reviewed before launch.',
    ],
  },
  guidelines: {
    title: 'Community Guidelines',
    paragraphs: [
      'Make room for difficult feelings with care for the people reading them. Ordinary non-graphic grief, heartbreak, loneliness and distress are welcome.',
      'Do not share private identifying details, targeted harassment, credible threats, scams, sexual exploitation, or encouragement or instructions for self-harm or violence.',
      'No accounts are public profiles. Your pseudonym remains the same on your thoughts, so consider what repeated posts could reveal about you.',
      'This service is not an emergency response channel. The local development version is not ready for public posting.',
    ],
  },
} as const;
export default async function Page({
  params,
}: {
  params: Promise<{ policy: string }>;
}) {
  const { policy } = await params;
  if (!Object.hasOwn(policies, policy)) notFound();
  const content = policies[policy as keyof typeof policies];
  return (
    <AuthShell>
      <article className="account-card policy-copy">
        <p className="eyebrow">Local development · Review before launch</p>
        <h1>{content.title}</h1>
        {content.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>
    </AuthShell>
  );
}
