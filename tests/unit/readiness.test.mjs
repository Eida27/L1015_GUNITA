import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { checkDatabase } from '../../src/server/db/readiness.mjs';

// A real TCP peer completes PostgreSQL authentication, then deliberately never
// answers SELECT 1. A connect-only timeout cannot protect this boundary.
describe('readiness deadline', () => {
  it('closes an established stalled connection and returns unavailable within the total deadline', async () => {
    const sockets = new Set();
    let queryReceived = false;
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let authenticated = false;
      socket.on('data', (data) => {
        if (!authenticated) {
          authenticated = true;
          socket.write(
            Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]),
          );
        } else if (data[0] === 81) queryReceived = true;
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let failSafe;
    try {
      const started = performance.now();
      const result = await Promise.race([
        checkDatabase(
          `postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture?sslmode=disable`,
        ),
        new Promise((resolve) => {
          failSafe = setTimeout(() => resolve('deadline missed'), 2300);
        }),
      ]);
      expect(queryReceived).toBe(true);
      expect(result).toBe(false);
      expect(performance.now() - started).toBeLessThan(2200);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(sockets.size).toBe(0);
    } finally {
      clearTimeout(failSafe);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
