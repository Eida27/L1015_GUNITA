import { observeRequest } from '@/server/security/request-log';
import { queryMapMembers, MapInputError } from '@/server/geo/pins';
import { getMapDatabase } from '@/server/geo/runtime';
import { limitMapRequests } from '@/server/geo/limits';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { mapMembersSchema } from '@/lib/map-contract';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    await limitMapRequests(getMapDatabase(), 'pins');
    const result = await queryMapMembers(
      getMapDatabase(),
      new URL(request.url).searchParams,
    );
    return Response.json(mapMembersSchema.parse(result), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return Response.json(
      {
        code:
          error instanceof MapInputError
            ? 'INVALID_MAP_QUERY'
            : 'MAP_UNAVAILABLE',
      },
      {
        status: error instanceof MapInputError ? 400 : 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}

export const GET = (request: Request) =>
  observeRequest('map', () => handle(request));
