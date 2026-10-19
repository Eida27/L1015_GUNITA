import { defineConfig } from 'drizzle-kit';

// Generate proposals for review only. SQL migrations own deployment; never push.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './.local/drizzle-proposals',
  strict: true,
  verbose: false,
});
