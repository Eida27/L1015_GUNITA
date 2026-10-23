import { z } from 'zod';
import { emotions } from './map-contract';
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
export const publicThoughtSchema = z
  .object({
    publicId: z.string().regex(/^t_[A-Za-z0-9_-]{22,64}$/),
    body: z
      .string()
      .min(1)
      .refine((value) => graphemeCount(value) <= 280),
    emotion: z.enum(emotions),
    pseudonym: z.string().min(1),
    location: z
      .object({
        label: z.string().min(1),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.expiresAt) - Date.parse(value.createdAt) ===
      720 * 3600000,
  );
export const consentResponseSchema = z
  .object({
    version: z.literal(CURRENT_GUIDELINES_VERSION),
    accepted: z.boolean(),
  })
  .strict();
export const viewerResponseSchema = z
  .object({ canManage: z.boolean() })
  .strict();
export const mutationReceiptSchema = z
  .object({ status: z.literal(true) })
  .strict();
export type PublicThought = z.infer<typeof publicThoughtSchema>;
export type ConsentResponse = z.infer<typeof consentResponseSchema>;
export type ViewerResponse = z.infer<typeof viewerResponseSchema>;
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
