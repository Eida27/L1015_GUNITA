import { expect, it } from 'vitest';
import { validateEnv } from '../../scripts/env.mjs';

it('requires explicit local preview and loopback origin before enabling the container bind', () => {
  const input = {
    LOCAL_PREVIEW: 'true',
    LOCAL_PROXY: 'true',
    CONTAINER_PREVIEW: 'true',
    APP_ORIGIN: 'https://localhost:8449',
    PORT: '3000',
  };
  expect(validateEnv(input, 'production').hostname).toBe('0.0.0.0');
  expect(
    validateEnv({ ...input, CONTAINER_PREVIEW: undefined }, 'production')
      .hostname,
  ).toBe('127.0.0.1');
  for (const changed of [
    { LOCAL_PREVIEW: undefined },
    { APP_ORIGIN: 'https://example.com' },
    { CONTAINER_PREVIEW: 'false' },
  ])
    expect(() => validateEnv({ ...input, ...changed }, 'production')).toThrow();
  expect(() => validateEnv(input, 'development')).toThrow();
});
