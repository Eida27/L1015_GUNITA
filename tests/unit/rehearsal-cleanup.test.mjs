import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cleanupSource = readFileSync(
  new URL('../fixtures/production-probe-cleanup.mjs', import.meta.url),
  'utf8',
);

// Run the same self-contained cleanup sent over stdin to the operator image.
// SQL transport is the fault boundary; no real DB or credential is needed.
function cleanupProcess(mode) {
  return spawnSync(process.execPath, ['--input-type=module'], {
    encoding: 'utf8',
    input: `
      ${cleanupSource}
      globalThis.cleanupProductionProbe = cleanupProductionProbe;
      const closed=[]; let absent=false;
      const client={
        async query(sql,args){
          if(args?.[0]!=='owned-author')throw new Error('wrong owner');
          if(sql.startsWith('DELETE')){
            if(${JSON.stringify(mode)}==='delete-failure')throw new Error('private database credentials');
            absent=${JSON.stringify(mode)}!=='still-present'; return {rowCount:1};
          }
          if(sql.startsWith('SELECT'))return {rows:[{n:absent?0:1}]};
          throw new Error('unexpected SQL');
        }, async end(){closed.push('client');}
      };
      const bootstrap={async query(){throw new Error('unexpected unowned DROP');},async end(){closed.push('bootstrap');}};
      const runtime={async end(){closed.push('runtime');if(${JSON.stringify(mode)}==='close-failure')throw new Error('private close failure');}};
      const restore=${JSON.stringify(mode)}==='restore-failure'?{name:'gunita_restore_1234567890abcdef'}:undefined;
      await globalThis.cleanupProductionProbe({client,bootstrap,runtime,author:'owned-author',restore});
      console.log(JSON.stringify({closed,absent}));
    `,
  });
}

it.each([
  'delete-failure',
  'still-present',
  'close-failure',
  'restore-failure',
])('fails closed and closes every client after %s', (mode) => {
  const result = cleanupProcess(mode);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).closed.sort()).toEqual([
    'bootstrap',
    'client',
    'runtime',
  ]);
  expect(result.stderr).toContain('rehearsal_cleanup_failed');
  expect(result.stderr).not.toMatch(/private|credentials|owned-author/);
});

it('verifies the owned fixture is absent before successful exit', () => {
  const result = cleanupProcess('success');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    closed: ['runtime', 'client', 'bootstrap'],
    absent: true,
  });
  expect(result.stderr).toBe('');
});
