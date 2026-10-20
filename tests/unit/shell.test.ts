import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { catalogs, browserLocale, errorKey } from '@/lib/i18n/catalog';
import { PreferencesProvider } from '@/components/ui/preferences';
import { PublicContentGate } from '@/components/ui/public-content-gate';

describe('Phase 3 public shell', () => {
  it('has complete English and Filipino catalogs with nonempty translations', () => {
    expect(Object.keys(catalogs.fil).sort()).toEqual(
      Object.keys(catalogs.en).sort(),
    );
    for (const catalog of Object.values(catalogs))
      for (const value of Object.values(catalog))
        expect(value.trim().length).toBeGreaterThan(0);
  });
  it('uses the first supported browser preference and falls back safely', () => {
    expect(browserLocale(['fr', 'fil-PH', 'en'])).toBe('fil');
    expect(browserLocale(['en-US', 'fil'])).toBe('en');
    expect(browserLocale(['tl', 'fr'])).toBe('en');
  });
  it('does not serialize or invoke a public content loader in SSR', () => {
    let called = false;
    const output = renderToString(
      createElement(
        PreferencesProvider,
        null,
        createElement(PublicContentGate, {
          load: async () => {
            called = true;
            return () => 'PRIVATE_SENTINEL';
          },
        }),
      ),
    );
    expect(called).toBe(false);
    expect(output).not.toContain('PRIVATE_SENTINEL');
    expect(output).toContain('Enable JavaScript');
  });
  it('maps allowlisted API codes to localized messages without reflecting server content', () => {
    expect(catalogs.fil[errorKey('INVALID_CREDENTIALS')]).toBe(
      'Mali ang email o password.',
    );
    expect(errorKey('PRIVATE_SENTINEL')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
