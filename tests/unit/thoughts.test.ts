import { expect, it } from 'vitest';

it('counts joined emoji and combining marks as graphemes and rejects the 281st', async () => {
  const loadedModule = await import('../../src/lib/thought-contract').catch(
    () => ({}),
  );
  const count = (loadedModule as { graphemeCount?: (text: string) => number })
    .graphemeCount;
  expect(count?.('👩🏽‍👩🏼‍👧🏾‍👦🏻'.repeat(280))).toBe(280);
  expect(count?.('e\u0301'.repeat(281))).toBe(281);
  const { validateThoughtBody } =
    await import('../../src/server/thoughts/content');
  const limit = '👩🏽‍👩🏼‍👧🏾‍👦🏻'.repeat(280);
  expect(validateThoughtBody(limit)).toBe(limit);
  expect(() => validateThoughtBody('e\u0301'.repeat(281))).toThrow();
});

it('uses a conservative code-point budget when grapheme segmentation is unavailable', async () => {
  const { graphemeCount } = await import('../../src/lib/thought-contract');
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  try {
    Object.defineProperty(Intl, 'Segmenter', {
      value: undefined,
      configurable: true,
    });
    expect(graphemeCount('a'.repeat(280))).toBe(280);
    expect(graphemeCount('👨‍👩‍👧‍👦'.repeat(280))).toBeGreaterThan(280);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', descriptor);
  }
});

it('rejects a pathological combining sequence before the database byte bound can produce a server error', async () => {
  const { validateThoughtBody } =
    await import('../../src/server/thoughts/content');
  expect(() => validateThoughtBody('a' + '\u1AB0'.repeat(6000))).toThrow();
});

it('shows localized relative publication and expiry context alongside absolute timestamps', async () => {
  const loaded = await import('../../src/lib/thought-contract');
  const format = (
    loaded as unknown as {
      relativeThoughtTime?: (
        value: string,
        locale: 'en' | 'fil',
        now: number,
      ) => string;
    }
  ).relativeThoughtTime;
  const now = Date.parse('2026-10-22T00:00:00Z');
  expect(format?.('2026-10-21T00:00:00Z', 'en', now)).toBe('yesterday');
  expect(format?.('2026-10-23T00:00:00Z', 'en', now)).toBe('tomorrow');
  expect(format?.('2026-10-22T00:00:00Z', 'en', now)).toBe('now');
  expect(format?.('2026-10-21T00:00:00Z', 'fil', now)).toBe('kahapon');
});

it('rejects invisible-only padding without stripping valid joined emoji', async () => {
  const { validateThoughtBody } =
    await import('../../src/server/thoughts/content');
  expect(() => validateThoughtBody('\u200D\uFE0F\u034F')).toThrow();
  expect(validateThoughtBody(' \u200B👨‍👩‍👧‍👦 ')).toBe('👨‍👩‍👧‍👦');
});

it('rejects obvious mobile contact details with local and international prefixes', async () => {
  const { validateThoughtBody } =
    await import('../../src/server/thoughts/content');
  for (const contact of ['09171234567', '+639171234567', '+63 917 123 4567'])
    expect(() =>
      validateThoughtBody(`Fictional contact: ${contact}`),
    ).toThrow();
});
