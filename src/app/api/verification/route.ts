import { z } from 'zod';
import { turnstileConfig } from '@/server/security/turnstile';
export const dynamic = 'force-dynamic';
const output = z
  .object({ siteKey: z.string().min(1), localTest: z.boolean() })
  .strict();
export function GET() {
  const config = turnstileConfig(process.env);
  return Response.json(
    output.parse({ siteKey: config.siteKey, localTest: config.localTest }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
