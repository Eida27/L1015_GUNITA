'use client';
import Link from 'next/link';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '@/components/ui/public-content-gate';
import {
  usePreferences,
  PreferenceControls,
} from '@/components/ui/preferences';

// Phase 4 replaces the empty client module with its map loader.
const loadPublicContent: PublicContentLoader = async () => () => null;
export default function Home() {
  const { t } = usePreferences();
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label={t('Gunita home')}>
          <span aria-hidden="true" className="brand-mark">
            g.
          </span>
          gunita
        </Link>
        <PreferenceControls />
        <span className="build-label">
          <span aria-hidden="true" />
          {t('Local foundation')}
        </span>
      </header>
      <main tabIndex={-1} id="main">
        <PublicContentGate load={loadPublicContent} />
        <section className="hero" aria-labelledby="welcome-title">
          <div className="hero-copy">
            <p className="eyebrow">{t('A little room to feel.')}</p>
            <h1 id="welcome-title">
              {t('A place for')}
              <br />
              <em>{t('feelings left unsaid.')}</em>
            </h1>
            <p className="introduction">
              {t(
                'Some things stay with us. We’re making a quiet space to set them down, one thought and one place at a time.',
              )}
            </p>
            <div className="foundation-note">
              <p className="note-title">{t('Taking shape, thoughtfully.')}</p>
              <p>
                {t('This is the local development foundation.')}
                <br className="desktop-break" />
                {t('Accounts are ready. Map and publishing are still to come.')}
              </p>
              <Link className="health-link" href="/api/health" prefetch={false}>
                {t('Check app health')}
                <span aria-hidden="true">↗</span>
              </Link>
              <nav className="account-links" aria-label={t('Your account')}>
                <Link href="/sign-up">{t('Create an account')}</Link>
                <Link href="/log-in">{t('Sign in')}</Link>
                <Link href="/settings">{t('Settings')}</Link>
              </nav>
            </div>
          </div>
          <div className="quiet-art" aria-hidden="true">
            <svg viewBox="0 0 460 530" fill="none">
              <ellipse
                className="art-orbit"
                cx="230"
                cy="260"
                rx="180"
                ry="213"
                transform="rotate(21 230 260)"
              />
              <ellipse
                className="art-orbit"
                cx="230"
                cy="260"
                rx="143"
                ry="176"
                transform="rotate(-16 230 260)"
              />
              <ellipse
                className="art-orbit"
                cx="230"
                cy="260"
                rx="105"
                ry="136"
                transform="rotate(18 230 260)"
              />
              <path
                className="art-stem"
                d="M230 385C244 333 215 303 243 257C263 221 264 197 250 171"
              />
              <path
                className="art-leaf"
                d="M243 257C287 260 320 234 312 201C272 202 248 222 243 257Z"
              />
              <path
                className="art-leaf second"
                d="M237 295C195 299 166 274 173 245C208 244 234 263 237 295Z"
              />
              <circle className="art-dot" cx="116" cy="126" r="7" />
              <circle className="art-dot small" cx="357" cy="358" r="4" />
              <path
                className="art-ground"
                d="M167 400C201 413 258 417 294 398"
              />
            </svg>
            <p>{t('Let a little of it go.')}</p>
          </div>
        </section>
        <section className="intentions" aria-labelledby="intentions-title">
          <div className="section-intro">
            <p className="eyebrow">{t('What we’re building')}</p>
            <h2 id="intentions-title">
              {t('A softer corner')}
              <br />
              {t('of the internet.')}
            </h2>
          </div>
          <div className="intention">
            <span className="item-number">01</span>
            <h3>{t('Room for real feelings')}</h3>
            <p>
              {t(
                'Short thoughts, memories, and unsent messages. No popularity rankings or public reaction counts.',
              )}
            </p>
          </div>
          <div className="intention">
            <span className="item-number">02</span>
            <h3>{t('A place, kept approximate')}</h3>
            <p>
              {t(
                'A Philippines-first map with deliberately coarse locations. No GPS or precise pin storage.',
              )}
            </p>
          </div>
          <div className="intention">
            <span className="item-number">03</span>
            <h3>{t('Made to gently fade')}</h3>
            <p>
              {t(
                'Thoughts will last 30 days. A moment to be heard, without becoming a permanent public archive.',
              )}
            </p>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          Gunita <span aria-hidden="true">·</span>
          {t('A place for feelings left unsaid.')}
        </span>
        <span>{t('In progress. With care.')}</span>
      </footer>
    </div>
  );
}
