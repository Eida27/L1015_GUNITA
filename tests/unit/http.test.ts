import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GET } from '@/app/api/health/route';
import { GET as ready } from '@/app/api/ready/route';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/validation/json';

describe('minimal public HTTP contracts', () => {
  it('answers liveness without disclosing configuration and prevents caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('hides exception contents behind a generic error with optional correlation ID', async () => {
    const response = errorResponse(
      new Error('postgres://private:secret@db/gunita'),
      'request-17',
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId: 'request-17',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('preserves a known validation status while dropping unsafe correlation content', async () => {
    const response = errorResponse(
      new ApiError('INVALID_INPUT'),
      'email@example.test\r\n',
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 'INVALID_INPUT',
      message: 'Check the submitted information.',
    });
  });
  it('reports unavailable readiness without database configuration or internal details', async () => {
    const response = await ready();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns schema-validated data', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"count":3}',
    });
    expect(
      await parseJsonBody(request, z.strictObject({ count: z.number().int() })),
    ).toEqual({ count: 3 });
  });
  it.each([
    ['{', 'application/json', 100, 'MALFORMED_JSON'],
    ['{"count":"secret"}', 'application/json', 100, 'INVALID_INPUT'],
    ['{"count":3}', 'text/plain', 100, 'UNSUPPORTED_MEDIA_TYPE'],
    ['{"count":333}', 'application/json', 5, 'BODY_TOO_LARGE'],
    ['{"count":3,"role":"admin"}', 'application/json', 100, 'INVALID_INPUT'],
  ])('rejects unsafe body (%s) as %s', async (body, type, limit, code) => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': type },
      body,
    });
    await expect(
      parseJsonBody(
        request,
        z.strictObject({ count: z.number().int() }),
        limit,
      ),
    ).rejects.toMatchObject({ code });
  });
  it('enforces bytes while reading even if content-length understates a streamed body', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
      body: '{"text":"🌱🌱🌱"}',
    });
    await expect(
      parseJsonBody(request, z.object({ text: z.string() }), 20),
    ).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
  });
});
