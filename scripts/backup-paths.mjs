import { realpath, lstat } from 'node:fs/promises';
import {
  resolve,
  dirname,
  basename,
  join,
  relative,
  isAbsolute,
  sep,
} from 'node:path';

// Resolve links/case in existing ancestors even when the final file or archive
// directory has not been created. Broken links and inaccessible paths fail closed.
export async function canonicalBackupPath(path) {
  let existing = resolve(path);
  const missing = [];
  for (;;) {
    try {
      return join(await realpath(existing), ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await lstat(existing);
        throw new Error('Unresolvable backup path');
      } catch (entryError) {
        if (entryError.code !== 'ENOENT') throw entryError;
      }
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

export function withinBackupPath(directory, path) {
  const normalize = (value) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const child = relative(normalize(directory), normalize(path));
  return (
    child === '' ||
    (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep))
  );
}

export async function externalBackupPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new Error('External backup path required');
  const canonical = await canonicalBackupPath(path);
  if (withinBackupPath(await realpath('.'), canonical))
    throw new Error('External backup path required');
  return canonical;
}
