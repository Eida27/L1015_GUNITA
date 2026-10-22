import type { FeatureCollection, Point } from 'geojson';
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
