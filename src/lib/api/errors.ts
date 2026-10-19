const errors = {
  INTERNAL_ERROR: {
    status: 500,
    message: 'Something went wrong. Please try again.',
  },
  MALFORMED_JSON: { status: 400, message: 'Send a valid JSON body.' },
  INVALID_INPUT: { status: 422, message: 'Check the submitted information.' },
  BODY_TOO_LARGE: { status: 413, message: 'The request body is too large.' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: 'Send an application/json body.',
  },
} as const;

export type ApiErrorCode = keyof typeof errors;
export type ApiErrorResponse = {
  code: ApiErrorCode;
  message: string;
  requestId?: string;
};

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode) {
    super(errors[code].message);
  }
}

export function errorResponse(error: unknown, requestId?: string): Response {
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const { status, message } = errors[code];
  // IDs are opaque caller-generated tokens, never request/user content.
  const safeId =
    requestId && /^[a-zA-Z0-9_-]{1,80}$/.test(requestId)
      ? requestId
      : undefined;
  const body: ApiErrorResponse = {
    code,
    message,
    ...(safeId ? { requestId: safeId } : {}),
  };
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
