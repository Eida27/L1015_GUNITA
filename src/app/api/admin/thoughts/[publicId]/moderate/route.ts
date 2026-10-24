import { getModerationService } from '@/server/moderation/runtime';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return getModerationService().handle(request);
}
