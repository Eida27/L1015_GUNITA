import { externalBackupPath } from './backup-paths.mjs';
import { loadLocalEnv } from './load-env.mjs';
import {
  backupDatabase,
  createBackupKey,
  restoreDatabase,
} from './backup-lib.mjs';
loadLocalEnv();
const command = process.argv[2];
try {
  const keyFile = await externalBackupPath(process.env.BACKUP_KEY_FILE);
  if (command === 'keygen') {
    await createBackupKey(keyFile);
    console.log(JSON.stringify({ event: 'backup_key_created' }));
  } else if (command === 'create') {
    const destination = await externalBackupPath(
      process.env.BACKUP_DESTINATION,
    );
    const result = await backupDatabase({
      databaseUrl: process.env.BACKUP_DATABASE_URL,
      destination,
      keyFile,
      destinationKind: process.env.BACKUP_DESTINATION_KIND,
      container: process.env.BACKUP_PG_CONTAINER,
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 7),
    });
    console.log(
      JSON.stringify({
        event: 'backup_completed',
        bytes: result.bytes,
        retentionDays: result.retentionDays,
        destinationKind: result.destinationKind,
      }),
    );
  } else if (command === 'restore') {
    const result = await restoreDatabase({
      archive: process.env.BACKUP_ARCHIVE,
      keyFile,
      operatorUrl: process.env.RESTORE_OPERATOR_DATABASE_URL,
      container: process.env.BACKUP_PG_CONTAINER,
      runtimeRole: process.env.RESTORE_RUNTIME_ROLE,
    });
    console.log(
      JSON.stringify({
        event: 'restore_quarantined',
        database: result.name,
        cleanup: result.cleanup,
        reconciliationRequired: true,
      }),
    );
  } else throw new Error('Unknown operation');
} catch {
  console.error(
    JSON.stringify({ event: 'backup_operation_failed', trafficEnabled: false }),
  );
  process.exitCode = 1;
}
