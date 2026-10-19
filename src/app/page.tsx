import Link from 'next/link';

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Gunita home">
          <span aria-hidden="true" className="brand-mark">
            g.
          </span>
          gunita
        </Link>
        <span className="build-label">
          <span aria-hidden="true" />
          Local foundation
        </span>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="welcome-title">
          <div className="hero-copy">
            <p className="eyebrow">A little room to feel.</p>
            <h1 id="welcome-title">
              A place for
              <br />
              <em>feelings left unsaid.</em>
            </h1>
            <p className="introduction">
              Some things stay with us. We’re making a quiet space to set them
              down, one thought and one place at a time.
            </p>
            <div className="foundation-note">
              <p className="note-title">Taking shape, thoughtfully.</p>
              <p>
                This is the local development foundation.
                <br className="desktop-break" /> Map, accounts, and publishing
                are still to come.
              </p>
              <a className="health-link" href="/api/health">
                Check app health <span aria-hidden="true">↗</span>
              </a>
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
            <p>Let a little of it go.</p>
          </div>
        </section>
        <section className="intentions" aria-labelledby="intentions-title">
          <div className="section-intro">
            <p className="eyebrow">What we’re building</p>
            <h2 id="intentions-title">
              A softer corner
              <br />
              of the internet.
            </h2>
          </div>
          <div className="intention">
            <span className="item-number">01</span>
            <h3>Room for real feelings</h3>
            <p>
              Short thoughts, memories, and unsent messages. No popularity
              rankings or public reaction counts.
            </p>
          </div>
          <div className="intention">
            <span className="item-number">02</span>
            <h3>A place, kept approximate</h3>
            <p>
              A Philippines-first map with deliberately coarse locations. No GPS
              or precise pin storage.
            </p>
          </div>
          <div className="intention">
            <span className="item-number">03</span>
            <h3>Made to gently fade</h3>
            <p>
              Thoughts will last 30 days. A moment to be heard, without becoming
              a permanent public archive.
            </p>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          Gunita <span aria-hidden="true">·</span> A place for feelings left
          unsaid.
        </span>
        <span>In progress. With care.</span>
      </footer>
    </div>
  );
}
