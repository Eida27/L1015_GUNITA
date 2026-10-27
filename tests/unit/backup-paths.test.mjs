import { expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  unlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backupDatabase } from '../../scripts/backup-lib.mjs';

it('rejects a key whose two-dot filename is inside the archive directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gunita-path-proof-'));
  try {
    const keyFile = join(directory, '..backup.key');
    await writeFile(keyFile, Buffer.alloc(32), { mode: 0o600 });
    await expect(
      backupDatabase({
        destination: directory,
        keyFile,
        destinationKind: 'local-simulation',
        databaseUrl: 'invalid',
      }),
    ).rejects.toThrow('Backup key must be separate from archives');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects the checkout root, case aliases and descendants through an existing linked parent', async () => {
  const subject = await import('../../scripts/backup-paths.mjs').catch(
    () => ({}),
  );
  expect(typeof subject.externalBackupPath).toBe('function');
  if (!subject.externalBackupPath) return;
  const root = resolve('.');
  await expect(subject.externalBackupPath(root)).rejects.toThrow(
    'External backup path required',
  );
  if (process.platform === 'win32') {
    await expect(
      subject.externalBackupPath(root.toUpperCase()),
    ).rejects.toThrow('External backup path required');
    await expect(
      subject.externalBackupPath(
        join(root.toUpperCase(), 'new-backups', 'key'),
      ),
    ).rejects.toThrow('External backup path required');
  }
  const directory = await mkdtemp(join(tmpdir(), 'gunita-path-proof-'));
  const linked = join(directory, 'checkout-link');
  try {
    await symlink(
      root,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      subject.externalBackupPath(join(linked, 'not-created', 'key')),
    ).rejects.toThrow('External backup path required');
    const outside = join(directory, '..valid-name', 'new-key');
    await mkdir(join(directory, '..valid-name'));
    await expect(subject.externalBackupPath(outside)).resolves.toBe(outside);
  } finally {
    await unlink(linked);
    await rm(directory, { recursive: true, force: true });
  }
});
