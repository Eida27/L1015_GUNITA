import { getThoughtService } from '@/server/thoughts/runtime';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return getThoughtService().handle(request);
}
