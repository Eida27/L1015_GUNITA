import type { FeatureCollection, Point } from 'geojson';
import { z } from 'zod';
export const emotions = [
  'love',
  'heartbreak',
  'regret',
  'loneliness',
  'gratitude',
  'hope',
  'happiness',
  'confession',
  'other',
] as const;
export type Emotion = (typeof emotions)[number];
export type PinProperties = {
  kind: 'pin' | 'aggregate';
  count: number;
  publicId?: string;
  emotion?: Emotion;
  label?: string;
  group?: string;
};
export type MapPins = FeatureCollection<Point, PinProperties> & {
  total: number;
};
export type CoarsePreview = { lat: number; lng: number; label: string };
export type MapMember = { publicId: string; emotion: Emotion; label: string };
export type MapMembers = {
  total: number;
  members: MapMember[];
  nextCursor: string | null;
};
const publicId = z.string().regex(/^t_[A-Za-z0-9_-]{22,64}$/);
export const coarsePreviewSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().min(1).max(200),
  })
  .strict();
const mapMemberSchema = z
  .object({
    publicId,
    emotion: z.enum(emotions),
    label: z.string().min(1).max(200),
  })
  .strict();
export const mapMembersSchema = z
  .object({
    total: z.number().int().nonnegative(),
    members: z.array(mapMemberSchema).max(20),
    nextCursor: publicId.nullable(),
  })
  .strict();
export const mapPinsSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    total: z.number().int().nonnegative(),
    features: z
      .array(
        z
          .object({
            type: z.literal('Feature'),
            geometry: z
              .object({
                type: z.literal('Point'),
                coordinates: z.tuple([
                  z.number().min(-180).max(180),
                  z.number().min(-90).max(90),
                ]),
              })
              .strict(),
            properties: z.discriminatedUnion('kind', [
              mapMemberSchema
                .extend({ kind: z.literal('pin'), count: z.literal(1) })
                .strict(),
              z
                .object({
                  kind: z.literal('aggregate'),
                  count: z.number().int().min(2),
                  group: z
                    .string()
                    .regex(/^(?:[0-9]|[12][0-9]|30):(?:[0-9]|[12][0-9]|30)$/)
                    .optional(),
                })
                .strict(),
            ]),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .refine(
    (value) =>
      value.total ===
      value.features.reduce(
        (sum, feature) => sum + feature.properties.count,
        0,
      ),
  );
