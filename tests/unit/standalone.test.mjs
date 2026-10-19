import { expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

it('removes copied private settings from standalone while preserving root settings and required assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gunita-package-'));
  try {
    await mkdir(join(directory, '.next/static'), { recursive: true });
    await mkdir(join(directory, '.next/standalone/config'), {
      recursive: true,
    });
    await mkdir(join(directory, 'public'), { recursive: true });
    await writeFile(join(directory, '.env'), 'PRIVATE_ROOT_CANARY=keep-me');
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.db',
      'config/.env.operator',
    ])
      await writeFile(
        join(directory, '.next/standalone', name),
        'PRIVATE_ARTIFACT_CANARY=remove-me',
      );
    await writeFile(join(directory, '.next/static/app.js'), 'static-content');
    await writeFile(join(directory, 'public/health.txt'), 'public-content');
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/prepare-standalone.mjs')],
      { cwd: directory, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.db',
      'config/.env.operator',
    ])
      await expect(
        access(join(directory, '.next/standalone', name)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(directory, '.env'), 'utf8')).toBe(
      'PRIVATE_ROOT_CANARY=keep-me',
    );
    expect(
      await readFile(
        join(directory, '.next/standalone/.next/static/app.js'),
        'utf8',
      ),
    ).toBe('static-content');
    expect(
      await readFile(
        join(directory, '.next/standalone/public/health.txt'),
        'utf8',
      ),
    ).toBe('public-content');
  } finally {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !/^gunita-package-[a-zA-Z0-9]+$/.test(basename(directory))
    )
      throw new Error('Unsafe fixture cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
