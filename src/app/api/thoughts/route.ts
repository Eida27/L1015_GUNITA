import { getThoughtService } from '@/server/thoughts/runtime';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return getThoughtService().handle(request);
}
