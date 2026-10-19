import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadLocalEnv } from './load-env.mjs';
import { validateEnv } from './env.mjs';

try {
  loadLocalEnv();
  const config = validateEnv(process.env, 'production');
  process.env.NODE_ENV = 'production';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  process.env.HOSTNAME = config.preview ? '127.0.0.1' : '0.0.0.0';
  process.env.PORT = String(config.port);
  await import(pathToFileURL(resolve('.next/standalone/server.js')).href);
} catch (error) {
  console.error(
    error.message.startsWith('Invalid environment:')
      ? error.message
      : 'Application startup failed. Build the app and verify configuration.',
  );
  process.exitCode = 1;
}
