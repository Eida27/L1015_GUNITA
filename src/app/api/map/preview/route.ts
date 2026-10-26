import { observeRequest } from '@/server/security/request-log';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/validation/json';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { coarsenPhilippinesPoint, LocationError } from '@/server/geo/privacy';
import { getMapDatabase } from '@/server/geo/runtime';
import { limitMapRequests } from '@/server/geo/limits';
import { coarsePreviewSchema } from '@/lib/map-contract';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    if (request.headers.get('origin') !== process.env.APP_ORIGIN)
      throw new ApiError('FORBIDDEN');
    if (new URL(request.url).search) throw new ApiError('INVALID_INPUT');
    await limitMapRequests(getMapDatabase(), 'preview');
    const { lat, lng } = await parseJsonBody(
      request,
      z.object({ lat: z.number(), lng: z.number() }).strict(),
      256,
    );
    const point = await coarsenPhilippinesPoint(getMapDatabase(), lat, lng);
    // The preview exposes only its safe display point, not the origin cell.
    return Response.json(
      coarsePreviewSchema.parse({
        lat: point.lat,
        lng: point.lng,
        label: point.label,
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof LocationError)
      return Response.json(
        { code: error.code },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      );
    return errorResponse(error);
  }
}

export const POST = (request: Request) =>
  observeRequest('map', () => handle(request));
