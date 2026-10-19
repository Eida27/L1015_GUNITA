import { cp, mkdir, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';

await mkdir('.next/standalone/.next', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
if (existsSync('public'))
  await cp('public', '.next/standalone/public', { recursive: true });

// Next's standalone writer also copies loaded .env files. Credentials come from
// the validated runtime environment/root launcher, never a portable artifact.
const output = resolve('.next/standalone');
if ((await lstat(output)).isSymbolicLink())
  throw new Error('Standalone output must be an owned directory');
function insideOutput(path) {
  const child = relative(output, resolve(path));
  if (
    child === '..' ||
    child.startsWith('..\\') ||
    child.startsWith('../') ||
    isAbsolute(child)
  )
    throw new Error('Unsafe standalone cleanup target');
}
async function sanitize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    insideOutput(path);
    if (entry.name === '.env' || entry.name.startsWith('.env.')) {
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await rm(path, { recursive: true, force: true });
      else await unlink(path);
    } else if (entry.name === '.local' && directory === output) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory() && !entry.isSymbolicLink())
      await sanitize(path);
  }
}
await sanitize(output);
