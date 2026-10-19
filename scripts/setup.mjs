import { setupLocal } from './setup-lib.mjs';

try {
  console.log(
    (await setupLocal(process.cwd()))
      ? 'Created private .env with random local secrets.'
      : 'Existing .env preserved.',
  );
} catch {
  console.error(
    'Local setup failed. Check directory access; no secret values are logged.',
  );
  process.exitCode = 1;
}
