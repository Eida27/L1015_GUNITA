import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('rejects invalid production settings before importing the generated standalone server', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gunita-start-'));
  try {
    mkdirSync(join(directory, '.next/standalone'), { recursive: true });
    writeFileSync(
      join(directory, '.next/standalone/server.js'),
      "require('node:fs').writeFileSync('server-imported', 'yes');",
    );
    const result = spawnSync(process.execPath, [resolve('scripts/start.mjs')], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        APP_ORIGIN: 'bad-private-value',
        BETTER_AUTH_SECRET: 'hidden-secret-value',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(directory, 'server-imported'))).toBe(false);
    expect(result.stderr).toContain('APP_ORIGIN');
    expect(result.stderr).not.toContain('bad-private-value');
    expect(result.stderr).not.toContain('hidden-secret-value');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
