import { z } from 'zod';
import { emotions } from './map-contract';
export const CURRENT_GUIDELINES_VERSION = 'guidelines-2026-10-19';
export const reactionTypes = ['love', 'sad', 'care', 'happy'] as const;
export const reactionInputSchema = z
  .object({ type: z.enum(reactionTypes) })
  .strict();
export const emptyInteractionInputSchema = z.object({}).strict();
export const dashboardQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^t_[A-Za-z0-9_-]{22,64}$/)
      .optional(),
  })
  .strict();
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
    reactionTypes: z.tuple([
      z.literal('love'),
      z.literal('sad'),
      z.literal('care'),
      z.literal('happy'),
    ]),
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
  .object({
    canManage: z.boolean(),
    myReaction: z.enum(reactionTypes).nullable(),
    bookmarked: z.boolean(),
  })
  .strict();
export const reactionTotalsSchema = z
  .object({
    love: z.number().int().nonnegative(),
    sad: z.number().int().nonnegative(),
    care: z.number().int().nonnegative(),
    happy: z.number().int().nonnegative(),
  })
  .strict();
export const totalsResponseSchema = z
  .object({ totals: reactionTotalsSchema })
  .strict();
export const ownThoughtSchema = z
  .object({
    thought: publicThoughtSchema,
    status: z.literal('published'),
    totals: reactionTotalsSchema,
  })
  .strict();
export const ownThoughtsResponseSchema = z
  .object({
    items: z.array(ownThoughtSchema).max(20),
    nextCursor: z
      .string()
      .regex(/^t_[A-Za-z0-9_-]{22,64}$/)
      .nullable(),
  })
  .strict();
export const bookmarksResponseSchema = z
  .object({
    items: z.array(publicThoughtSchema).max(20),
    nextCursor: z
      .string()
      .regex(/^t_[A-Za-z0-9_-]{22,64}$/)
      .nullable(),
  })
  .strict();
export const mutationReceiptSchema = z
  .object({ status: z.literal(true) })
  .strict();
export type PublicThought = z.infer<typeof publicThoughtSchema>;
export type ConsentResponse = z.infer<typeof consentResponseSchema>;
export type ViewerResponse = z.infer<typeof viewerResponseSchema>;
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
export type OwnThought = z.infer<typeof ownThoughtSchema>;
export type OwnThoughtsResponse = z.infer<typeof ownThoughtsResponseSchema>;
export type BookmarksResponse = z.infer<typeof bookmarksResponseSchema>;
