import type { Metadata } from 'next';
import '@/styles/globals.css';
import { PreferencesProvider, Text } from '@/components/ui/preferences';

export const metadata: Metadata = {
  title: 'Gunita — A place for feelings left unsaid',
  description:
    'A quiet Philippines-first map for feelings left unsaid. Broad places, room to feel.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <PreferencesProvider>
          <a className="skip-link" href="#main">
            <Text id="Skip to content" />
          </a>
          {children}
        </PreferencesProvider>
      </body>
    </html>
  );
}
