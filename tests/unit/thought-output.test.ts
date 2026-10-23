import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { z } from 'zod';
import * as contracts from '../../src/lib/thought-contract';
const producer = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/db/published.mjs', () => ({
  findPublishedThought: async () => producer.row,
}));
const id = 't_abcdefghijklmnopqrstuv';
const valid = {
  publicId: id,
  body: 'Fictional hope.',
  emotion: 'hope',
  pseudonym: 'Quiet river',
  location: { label: 'Metro Manila', lat: 14.6, lng: 120.98 },
  createdAt: '2026-10-22T00:00:00.000Z',
  expiresAt: '2026-11-21T00:00:00.000Z',
};
it('defines strict shared schemas for each existing response shape', async () => {
  const schemas = contracts as unknown as Record<string, z.ZodType>;
  for (const [key, value] of [
    ['publicThoughtSchema', valid],
    [
      'consentResponseSchema',
      { version: 'guidelines-2026-10-19', accepted: true },
    ],
    ['viewerResponseSchema', { canManage: false }],
    ['mutationReceiptSchema', { status: true }],
  ] as const) {
    expect(schemas[key], key).toBeDefined();
    expect(schemas[key].parse(value)).toEqual(value);
    expect(
      schemas[key].safeParse({ ...value, ownerId: 'private-canary' }).success,
    ).toBe(false);
  }
  expect(
    schemas.publicThoughtSchema.safeParse({
      ...valid,
      location: { ...valid.location, rawLat: 14.5 },
    }).success,
  ).toBe(false);
  expect(
    schemas.publicThoughtSchema.safeParse({
      ...valid,
      createdAt: 'private-invalid-date',
    }).success,
  ).toBe(false);
  expect(
    schemas.viewerResponseSchema.safeParse({ canManage: 'true' }).success,
  ).toBe(false);
  expect(
    schemas.consentResponseSchema.safeParse({ version: 'old', accepted: true })
      .success,
  ).toBe(false);
  expect(
    schemas.mutationReceiptSchema.safeParse({ status: false }).success,
  ).toBe(false);
});
it('validates the actual public response boundary and conceals malformed producer output as a server failure', async () => {
  const { createThoughtService } =
    await import('../../src/server/thoughts/service');
  const service = createThoughtService({
    auth: {} as never,
    pool: {} as Pool,
    origin: 'http://127.0.0.1:3000',
  });
  producer.row = {
    ...valid,
    locationLabel: valid.location.label,
    lat: valid.location.lat,
    lng: valid.location.lng,
    createdAt: new Date(valid.createdAt),
    expiresAt: new Date(valid.expiresAt),
    authorId: 'private-canary',
  };
  const get = () =>
    service.handle(new Request(`http://127.0.0.1:3000/api/thoughts/${id}`));
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(valid);
  for (const bad of [
    { emotion: 'private-canary' },
    { lat: 'private-canary' },
    { createdAt: 'private-canary' },
  ]) {
    const good = producer.row;
    producer.row = { ...good, ...bad };
    const invalid = await get();
    expect(invalid.status).toBe(500);
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect(await invalid.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    producer.row = good;
  }
});
