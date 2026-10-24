import { getModerationService } from '@/server/moderation/runtime';
export const dynamic = 'force-dynamic';
export function PATCH(request: Request) {
  return getModerationService().handle(request);
}
