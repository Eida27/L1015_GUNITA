import { expect, it } from 'vitest';
import { validateThoughtBody } from '../../src/server/thoughts/content';
it('rejects explicit private address disclosure while allowing ordinary distress', () => {
  expect(() =>
    validateThoughtBody('Her home address is 123 Example Street, Manila.'),
  ).toThrow();
  for (const text of [
    'I feel sad and lonely.',
    'I have thoughts of suicide and need support.',
    'I survived trauma.',
    'I miss my home on this quiet street.',
  ])
    expect(validateThoughtBody(text)).toBe(text);
});
