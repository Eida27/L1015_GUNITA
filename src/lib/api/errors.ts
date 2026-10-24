const errors = {
  VERIFICATION_REQUIRED: {
    status: 403,
    message: 'Complete the verification and try again.',
  },
  VERIFICATION_UNAVAILABLE: {
    status: 503,
    message: 'Verification is unavailable. Please try again.',
  },
  GUIDELINES_REQUIRED: {
    status: 403,
    message: 'Accept the current Community Guidelines before publishing.',
  },
  POST_LIMIT_REACHED: {
    status: 429,
    message:
      'You can leave five thoughts in a rolling 24 hours. Please come back later.',
  },
  THOUGHT_UNAVAILABLE: { status: 404, message: 'This thought is unavailable.' },
  CONTENT_REJECTED: {
    status: 422,
    message:
      'Please remove contact details, links, threats or harmful instructions.',
  },
  UNAUTHENTICATED: { status: 401, message: 'Sign in to continue.' },
  INVALID_CREDENTIALS: {
    status: 401,
    message: 'Email or password is incorrect.',
  },
  EMAIL_UNVERIFIED: {
    status: 403,
    message: 'Verify your email before continuing.',
  },
  ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'This account cannot perform member actions.',
  },
  FORBIDDEN: { status: 403, message: 'This action is not available.' },
  INVALID_TOKEN: {
    status: 400,
    message:
      'This link has expired or has already been used. Request a new link.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many attempts. Please wait before trying again.',
  },
  EMAIL_DELIVERY_FAILED: {
    status: 503,
    message: 'Email delivery is unavailable. Please try again.',
  },
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
