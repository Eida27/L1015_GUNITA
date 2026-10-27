import { parseEnv } from 'node:util';

const allowed = {
  web: [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'TURNSTILE_SECRET_KEY',
    'SMTP_USER',
    'SMTP_PASSWORD',
  ],
  maintenance: ['MIGRATION_DATABASE_URL'],
  backup: ['BACKUP_DATABASE_URL'],
  metrics: ['MIGRATION_DATABASE_URL'],
  operator: [
    'BOOTSTRAP_DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'DATABASE_URL',
    'RESTORE_OPERATOR_DATABASE_URL',
  ],
};
export function loadServiceSecret(service, source, env = process.env) {
  const values = parseEnv(source);
  if (
    !allowed[service] ||
    Object.keys(values).some((key) => !allowed[service].includes(key))
  )
    throw new Error('Invalid service secret');
  Object.assign(env, values);
}
