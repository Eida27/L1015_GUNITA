import assert from 'node:assert/strict';

export async function checkBackupRecovery(run) {
  // Compose waits for SIGTERM drain; only one process may write backup state.
  await run(['stop', 'backup']);
  try {
    const failed = await run(
      [
        'run',
        '--rm',
        '--no-deps',
        '-e',
        'BACKUP_KEY_FILE=/keys/deliberately-missing',
        'backup',
        'backup',
        '--once',
      ],
      1,
    );
    assert.match(failed, /backup_failed/);
    const health = [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'node',
      'backup',
      'scripts/job-health.mjs',
      'backup',
    ];
    await run(health, 1);
    await run(['run', '--rm', '--no-deps', 'backup', 'backup', '--once']);
    await run(health);
  } finally {
    await run(['up', '-d', '--wait', '--wait-timeout', '180', 'backup']);
  }
}
