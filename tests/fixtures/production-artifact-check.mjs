// Read private values only to prove their absence; never print values or file content.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const values = [];
for (const file of ['.env', '.env.db']) {
  const env = parseEnv(await readFile(file, 'utf8'));
  for (const [key, value] of Object.entries(env)) {
    if (/DATABASE_URL$/.test(key))
      values.push(decodeURIComponent(new URL(value).password));
    else if (['BETTER_AUTH_SECRET', 'SMTP_PASSWORD'].includes(key))
      values.push(value);
  }
}
const privateValues = values.filter((value) => value.length >= 16);
let files = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(
      !/^\.env(?:\.|$)|^\.local$|^\.superpowers$|\.key$|\.gunitabackup$/.test(
        entry.name,
      ),
    );
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile()) {
      files++;
      const data = await readFile(path);
      assert.ok(
        privateValues.every((value) => !data.includes(Buffer.from(value))),
      );
    }
  }
}
await inspect('.local/phase-9-context-proof/context');
for (const file of ['locales/en.json', 'locales/fil.json'])
  await readFile(join('.local/phase-9-context-proof/context', file));
console.log(
  `PASS actual exported build context: ${files} allowlisted files, locale catalogs present, no private env/keys/archives/values`,
);
const scan = `const fs=require('node:fs'),path=require('node:path');const values=JSON.parse(fs.readFileSync(0,'utf8'));let count=0;function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(/^\\.env(?:\\.|$)|^\\.local$|^\\.superpowers$|\\.key$|\\.gunitabackup$/.test(e.name))throw Error('private filename');const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(e.isFile()){count++;const b=fs.readFileSync(p);if(values.some(v=>b.includes(Buffer.from(v))))throw Error('private value');}}}scan('/app');console.log('PASS image private-data scan files='+count);`;
for (const image of ['gunita-web:phase9', 'gunita-operator:phase9']) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--network',
      'none',
      '--entrypoint',
      'node',
      image,
      '-e',
      scan,
    ],
    {
      encoding: 'utf8',
      input: JSON.stringify(privateValues),
      windowsHide: true,
      timeout: 180000,
    },
  );
  assert.equal(result.status, 0, 'Image private-data scan failed');
  console.log(`${image}: ${result.stdout.trim()}`);
}
