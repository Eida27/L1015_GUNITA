import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PreferencesProvider } from '../../src/components/ui/preferences';
import { PolicyCopy } from '../../src/components/ui/policy-copy';
it('provides the verified Philippine resource without implementation phase copy', () => {
  const html = renderToString(
    createElement(
      PreferencesProvider,
      null,
      createElement(PolicyCopy, { policy: 'help' }),
    ),
  );
  expect(html).toContain('NCMH Crisis Hotline');
  expect(html).toContain(
    'tel:+63180018881553?oai_link_source=model_response_hotline',
  );
  expect(html).not.toContain('Phase 7');
  expect(html).not.toContain('implementation specification');
});
