import { getAuthService } from '@/server/auth/runtime';
import { errorResponse } from '@/lib/api/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    return await getAuthService().handle(request);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handle as GET, handle as POST };
