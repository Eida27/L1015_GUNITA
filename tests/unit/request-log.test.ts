import { expect, it, vi } from 'vitest';

it('logs only generated correlation, route group, status and elapsed time, never request secrets', async () => {
  const subject = await import('../../src/server/security/request-log').catch(
    () => ({}),
  );
  expect('observeRequest' in subject).toBe(true);
  if (!('observeRequest' in subject)) return;
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const observe = subject.observeRequest as (
      group: string,
      work: () => Promise<Response>,
    ) => Promise<Response>;
    const response = await observe(
      'auth',
      async () => new Response('private email/body/token', { status: 403 }),
    );
    expect(response.status).toBe(403);
    const record = JSON.parse(output.mock.calls[0][0]);
    expect(Object.keys(record).sort()).toEqual([
      'durationMs',
      'event',
      'requestId',
      'route',
      'status',
    ]);
    expect(record).toMatchObject({
      event: 'request',
      route: 'auth',
      status: 403,
    });
    expect(record.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record)).not.toContain('private');
  } finally {
    output.mockRestore();
  }
});
