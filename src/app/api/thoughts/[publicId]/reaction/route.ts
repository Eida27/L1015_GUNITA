import { getThoughtService } from '@/server/thoughts/runtime';
export const runtime = 'nodejs';
export async function PUT(request: Request) {
  return getThoughtService().handle(request);
}
export async function DELETE(request: Request) {
  return getThoughtService().handle(request);
}
