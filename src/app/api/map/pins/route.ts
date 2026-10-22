import { queryMapPins, MapInputError } from '@/server/geo/pins';
import { getMapDatabase } from '@/server/geo/runtime';
import { limitMapRequests } from '@/server/geo/limits';
import { ApiError, errorResponse } from '@/lib/api/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    await limitMapRequests(getMapDatabase(), 'pins');
    const result = await queryMapPins(
      getMapDatabase(),
      new URL(request.url).searchParams,
    );
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
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
