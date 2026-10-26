import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

it('renders history enums as localized labels and Manila time while preserving nullable references', async () => {
  const subject =
    await import('../../src/components/moderation/audit-entry').catch(
      () => ({}),
    );
  expect('AuditEntry' in subject).toBe(true);
  if (!('AuditEntry' in subject)) return;
  const item = {
    id: '00000000-0000-4000-8000-000000000001',
    action: 'unhide',
    reasonCode: 'NO_VIOLATION',
    changedStatus: 'published',
    createdAt: '2026-10-25T00:00:00.000Z',
    subjectKind: 'thought',
    actorId: null,
    subjectReference: null,
  } as const;
  const en = renderToStaticMarkup(
    createElement(subject.AuditEntry, { item, locale: 'en' }),
  );
  const fil = renderToStaticMarkup(
    createElement(subject.AuditEntry, { item, locale: 'fil' }),
  );
  expect(en).toContain('Unhide thought');
  expect(en).toContain('No violation');
  expect(fil).not.toContain('Unhide thought');
  expect(fil).not.toContain('No violation');
  for (const output of [en, fil]) {
    expect(output).not.toContain('NO_VIOLATION');
    expect(output).toContain('8:00');
    expect(output).toMatch(/datetime="2026-10-25T00:00:00.000Z"/i);
    expect(output).not.toContain('>thought<');
  }
});

it('describes inspection generically for both account and report subjects in each locale', async () => {
  const { AuditEntry } =
    await import('../../src/components/moderation/audit-entry');
  for (const subjectKind of ['account', 'report'] as const) {
    const item = {
      id: '00000000-0000-4000-8000-000000000002',
      action: 'review_report' as const,
      reasonCode: 'INSPECT',
      changedStatus: null,
      createdAt: '2026-10-25T00:00:00.000Z',
      subjectKind,
      actorId: null,
      subjectReference: null,
    };
    const en = renderToStaticMarkup(
      createElement(AuditEntry, { item, locale: 'en' }),
    );
    const fil = renderToStaticMarkup(
      createElement(AuditEntry, { item, locale: 'fil' }),
    );
    expect(en).toContain('Inspect record');
    expect(en).not.toContain('Inspect account');
    expect(fil).toContain('Suriin ang tala');
    expect(fil).not.toContain('Suriin ang account');
  }
});
