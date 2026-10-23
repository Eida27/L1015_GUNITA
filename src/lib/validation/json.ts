import type { ZodType } from 'zod';
import { ApiError } from '@/lib/api/errors';

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = 16384,
  options: { allowEmptyObject?: boolean } = {},
): Promise<T> {
  const isJson =
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ===
    'application/json';
  if (!isJson && !options.allowEmptyObject)
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw new ApiError('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader && !options.allowEmptyObject)
    throw new ApiError('MALFORMED_JSON');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (!reader) break;
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError('BODY_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader?.releaseLock();
  }
  if (length > 0 && !isJson) throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value =
      length === 0 && options.allowEmptyObject
        ? {}
        : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError('MALFORMED_JSON');
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError('INVALID_INPUT');
  return result.data;
}
