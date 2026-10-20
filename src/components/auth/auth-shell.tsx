import Link from 'next/link';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell auth-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Gunita home">
          <span aria-hidden="true" className="brand-mark">
            g.
          </span>
          gunita
        </Link>
        <Link className="quiet-link" href="/">
          Back to Gunita ↗
        </Link>
      </header>
      <main id="main" className="account-main">
        {children}
      </main>
      <footer className="site-footer">
        <span>A place for feelings left unsaid.</span>
        <nav aria-label="Policies">
          <Link href="/guidelines">Guidelines</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
