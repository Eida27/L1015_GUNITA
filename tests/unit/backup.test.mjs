import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

it('authenticates encrypted archives before revealing plaintext and rejects wrong keys, truncation and tampering', async () => {
  const subject = await import('../../scripts/backup-lib.mjs').catch(
    () => ({}),
  );
  expect(typeof subject.encryptArchive).toBe('function');
  if (!subject.encryptArchive) return;
  const key = randomBytes(32),
    plain = Buffer.from('private backup canary: email/body/password');
  const archive = subject.encryptArchive(plain, key);
  expect(archive.includes(plain)).toBe(false);
  expect(subject.decryptArchive(archive, key)).toEqual(plain);
  expect(subject.encryptArchive(plain, key)).not.toEqual(archive);
  expect(() => subject.decryptArchive(archive, randomBytes(32))).toThrow();
  for (const offset of [0, 12, 28, archive.length - 1]) {
    const changed = Buffer.from(archive);
    changed[offset] ^= 1;
    expect(() => subject.decryptArchive(changed, key)).toThrow();
  }
  expect(() => subject.decryptArchive(archive.subarray(0, -1), key)).toThrow();
});
