import { randomUUID } from 'node:crypto';
import { errorResponse } from '@/lib/api/errors';

// Only code-owned route groups and a response, never Request/URL/body/error text.
export async function observeRequest(
  route: 'auth' | 'thoughts' | 'moderation' | 'map',
  work: () => Promise<Response>,
) {
  const requestId = randomUUID(),
    started = performance.now();
  let response: Response;
  try {
    response = await work();
  } catch {
    response = errorResponse(new Error('Request failed'), requestId);
  }
  console.log(
    JSON.stringify({
      event: 'request',
      route,
      requestId,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    }),
  );
  return response;
}
