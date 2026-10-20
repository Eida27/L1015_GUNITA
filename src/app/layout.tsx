import type { Metadata } from 'next';
import '@/styles/globals.css';
import { PreferencesProvider, Text } from '@/components/ui/preferences';

export const metadata: Metadata = {
  title: 'Gunita — A place for feelings left unsaid',
  description:
    'Gunita local development. Private accounts with permanent pseudonyms. Map and publishing are still to come.',
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
