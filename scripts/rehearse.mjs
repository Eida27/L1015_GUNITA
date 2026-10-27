import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import https from 'node:https';
import { prepareRehearsal, readRehearsal } from './rehearsal-lib.mjs';

const command = process.argv[2];
try {
  if (command === 'prepare') {
    await mkdir('.local', { recursive: true });
    // Exclusive receipt prevents replacing an existing owned rehearsal.
    const receipt = await import('node:fs/promises').then(({ open }) =>
      open('.local/phase-9-rehearsal.json', 'wx', 0o600),
    );
    try {
      await receipt.writeFile(
        JSON.stringify(
          await prepareRehearsal(Number(process.argv[3] || 8449)),
          null,
          2,
        ),
      );
    } finally {
      await receipt.close();
    }
    console.log(
      'Isolated dummy rehearsal prepared. Receipt: .local/phase-9-rehearsal.json',
    );
  } else {
    const receipt = await readRehearsal();
    const args = [
      'compose',
      '--env-file',
      join(receipt.directory, 'compose.env'),
      '-p',
      receipt.project,
      '-f',
      'compose.prod.yml',
      '-f',
      'compose.staging.yml',
    ];
    async function docker(extra, capture = false, input) {
      const env = { ...process.env, FORCE_COLOR: '0' };
      delete env.NO_COLOR;
      return new Promise((resolve, reject) => {
        const child = spawn('docker', [...args, ...extra], {
          env,
          windowsHide: true,
          stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
        });
        let output = '';
        child.stdout?.on('data', (data) => {
          output += data;
        });
        child.on('error', () => reject(new Error('Docker unavailable')));
        child.on('close', (code) =>
          code
            ? reject(new Error(`Rehearsal command failed (${code})`))
            : resolve(output),
        );
        child.stdin.end(input);
      });
    }
    async function topology() {
      const config = JSON.parse(
        await docker(['config', '--format', 'json'], true),
      );
      assert.equal(config.networks.database.internal, true);
      assert.deepEqual(config.services.db.networks, { database: null });
      for (const [name, service] of Object.entries(config.services)) {
        if (name !== 'caddy') assert.equal(service.ports, undefined);
      }
      assert.equal(config.services.caddy.ports.length, 1);
      assert.equal(config.services.caddy.ports[0].host_ip, '127.0.0.1');
      assert.deepEqual(
        config.services.web.secrets.map((secret) => secret.source),
        ['web_env'],
      );
      console.log(
        'PASS topology: private DB, no web/DB/SMTP/metrics host ports; Caddy loopback only; web secret isolation',
      );
    }
    if (command === 'config') await topology();
    else if (command === 'build') {
      await topology();
      await docker(['build', 'operator']);
      await docker(['build', 'web']);
    } else if (command === 'start') {
      await topology();
      await docker(['up', '-d', '--wait', 'db', 'mailpit']);
      await docker(['run', '--rm', 'volume-init']);
      await docker(['run', '--rm', 'operator', 'initialize']);
      await docker(['run', '--rm', 'operator', 'keygen']);
      await docker([
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '240',
        'web',
        'caddy',
        'maintenance',
        'backup',
        'metrics',
      ]);
    } else if (command === 'verify') {
      await topology();
      const caFile = join(receipt.directory, 'caddy-root.crt');
      await docker([
        'cp',
        'caddy:/data/caddy/pki/authorities/local/root.crt',
        caFile,
      ]);
      const ca = await readFile(caFile);
      for (const path of ['/api/health', '/api/ready', '/api/me/thoughts']) {
        const result = await new Promise((resolve, reject) => {
          const request = https.get(
            `https://localhost:${receipt.port}${path}`,
            { ca, family: 4, timeout: 10000 },
            (response) => {
              let body = '';
              response.on('data', (chunk) => {
                body += chunk;
              });
              response.on('end', () =>
                resolve({
                  status: response.statusCode,
                  headers: response.headers,
                  body,
                }),
              );
            },
          );
          request.on('error', reject);
          request.on('timeout', () =>
            request.destroy(new Error('HTTPS deadline')),
          );
        });
        assert.equal(result.status, path.startsWith('/api/me') ? 401 : 200);
        assert.match(result.headers['cache-control'], /no-store/);
        assert.match(result.headers['strict-transport-security'], /max-age=/);
        console.log(
          `PASS verified CA + hostname HTTPS ${path}: ${result.status}, no-store, HSTS`,
        );
      }
      await docker([
        'exec',
        '-T',
        'web',
        'node',
        '-e',
        "if(process.getuid()!==10001)process.exit(1);if(require('node:fs').existsSync('/run/secrets/operator_env'))process.exit(2);console.log('PASS non-root web and no operator secret')",
      ]);
      for (const name of ['maintenance', 'backup', 'metrics'])
        await docker([
          'exec',
          '-T',
          name,
          'node',
          'scripts/job-health.mjs',
          name,
        ]);
      await docker(
        [
          'run',
          '--rm',
          '-T',
          '--no-deps',
          '--entrypoint',
          'node',
          'operator',
          '--input-type=module',
        ],
        false,
        await readFile('tests/fixtures/production-probe.mjs', 'utf8'),
      );
      await writeFile(
        '.local/phase-9-rehearsal-verified.json',
        JSON.stringify(
          {
            project: receipt.project,
            verifiedAt: new Date().toISOString(),
            port: receipt.port,
          },
          null,
          2,
        ),
      );
      console.log('PASS local staging rehearsal; not a production launch');
    } else if (command === 'stop') await docker(['stop']);
    else throw new Error('Use prepare, config, build, start, verify or stop');
  }
} catch (error) {
  console.error(
    error.message?.startsWith('PASS')
      ? 'Rehearsal failed'
      : `Rehearsal failed: ${error.code || error.name || 'operation'}`,
  );
  process.exitCode = 1;
}
