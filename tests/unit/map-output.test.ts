import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  try {
    expect(output.mock.calls.length).toBeGreaterThan(0);
    for (const call of output.mock.calls) {
      const record = JSON.parse(String(call[0]));
      expect(record.route).toBe('map');
      expect(Object.keys(record).sort()).toEqual([
        'durationMs',
        'event',
        'requestId',
        'route',
        'status',
      ]);
      expect([200, 500]).toContain(record.status);
    }
  } finally {
    output.mockRestore();
  }
});
const producer = vi.hoisted(() => ({ pins: {}, members: {}, point: {} }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/geo/runtime', () => ({ getMapDatabase: () => ({}) }));
vi.mock('../../src/server/geo/limits', () => ({
  limitMapRequests: async () => {},
}));
vi.mock('../../src/server/geo/pins', () => ({
  MapInputError: class extends Error {},
  queryMapPins: async () => producer.pins,
  queryMapMembers: async () => producer.members,
}));
vi.mock('../../src/server/geo/privacy', () => ({
  LocationError: class extends Error {},
  coarsenPhilippinesPoint: async () => producer.point,
}));
import { GET as pins } from '../../src/app/api/map/pins/route';
import { GET as members } from '../../src/app/api/map/members/route';
import { POST as preview } from '../../src/app/api/map/preview/route';

it('rejects malformed map output and extra identity fields as generic 500, never client validation errors', async () => {
  producer.pins = {
    type: 'FeatureCollection',
    total: 0,
    features: [],
    email: 'private-canary',
  };
  producer.members = {
    total: 1,
    members: [
      {
        publicId: 't_abcdefghijklmnopqrstuv',
        emotion: 'secret-invalid',
        label: 'Fixture',
      },
    ],
    nextCursor: null,
  };
  producer.point = { lat: 200, lng: 122, label: 'Fixture' };
  vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
  try {
    for (const response of [
      await pins(
        new Request('http://127.0.0.1:3000/api/map/pins?bbox=1,2,3,4&zoom=2'),
      ),
      await members(
        new Request(
          'http://127.0.0.1:3000/api/map/members?bbox=1,2,3,4&zoom=18&group=0:0',
        ),
      ),
      await preview(
        new Request('http://127.0.0.1:3000/api/map/preview', {
          method: 'POST',
          headers: {
            origin: 'http://127.0.0.1:3000',
            'content-type': 'application/json',
          },
          body: '{"lat":14.6,"lng":120.98}',
        }),
      ),
    ]) {
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.text()).not.toMatch(
        /private-canary|secret-invalid|200/,
      );
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

it('returns valid bounded public map output unchanged', async () => {
  producer.pins = { type: 'FeatureCollection', total: 0, features: [] };
  producer.members = { total: 0, members: [], nextCursor: null };
  expect(
    await (await pins(new Request('http://localhost/api/map/pins'))).json(),
  ).toEqual(producer.pins);
  expect(
    await (
      await members(new Request('http://localhost/api/map/members'))
    ).json(),
  ).toEqual(producer.members);
});
