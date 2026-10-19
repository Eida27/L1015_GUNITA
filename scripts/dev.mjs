import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadLocalEnv } from './load-env.mjs';
import { validateEnv } from './env.mjs';

try {
  loadLocalEnv();
  const config = validateEnv(process.env, 'development');
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(config.port),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  );
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
