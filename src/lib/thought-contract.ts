import type { Emotion } from './map-contract';
export const CURRENT_GUIDELINES_VERSION = 'guidelines-2026-10-19';
export function relativeThoughtTime(
  value: string,
  locale: 'en' | 'fil',
  now = Date.now(),
): string {
  const seconds = (Date.parse(value) - now) / 1000;
  const [divisor, unit] =
    Math.abs(seconds) >= 86400
      ? ([86400, 'day'] as const)
      : Math.abs(seconds) >= 3600
        ? ([3600, 'hour'] as const)
        : Math.abs(seconds) >= 60
          ? ([60, 'minute'] as const)
          : ([1, 'second'] as const);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(seconds / divisor),
    unit,
  );
}
export function graphemeCount(text: string): number {
  if (typeof Intl.Segmenter === 'function')
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ).length;
  // Conservative fallback: code points can overcount complex emoji, never allow
  // more than 280 graphemes. No unsafe UTF-16 truncation or silent text changes.
  return Array.from(text).length;
}
export type PublicThought = {
  publicId: string;
  body: string;
  emotion: Emotion;
  pseudonym: string;
  location: { label: string; lat: number; lng: number };
  createdAt: string;
  expiresAt: string;
};
