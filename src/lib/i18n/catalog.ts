import type { ApiErrorCode } from '@/lib/api/errors';
import en from '../../../locales/en.json';
import fil from '../../../locales/fil.json';

export type Locale = 'en' | 'fil';
export type MessageKey = keyof typeof en;
export const catalogs: Record<Locale, Record<MessageKey, string>> = { en, fil };
export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^fil(?:-|$)/i.test(language)) return 'fil';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}
// API messages are never displayed directly: only known, allowlisted codes.
export const errorKeys = {
  STALE_EDIT:
    'This thought changed. Your draft is kept. Reload the saved thought before editing again.',
  VERIFICATION_REQUIRED: 'Complete the verification and try again.',
  VERIFICATION_UNAVAILABLE: 'Verification is unavailable. Please try again.',
  GUIDELINES_REQUIRED:
    'Accept the current Community Guidelines before publishing.',
  POST_LIMIT_REACHED:
    'You can leave five thoughts in a rolling 24 hours. Please come back later.',
  THOUGHT_UNAVAILABLE: 'This thought is unavailable.',
  CONTENT_REJECTED:
    'Please remove contact details, links, threats or harmful instructions.',
  UNAUTHENTICATED: 'Sign in to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_UNVERIFIED: 'Verify your email before continuing.',
  ACCOUNT_SUSPENDED: 'This account cannot perform member actions.',
  FORBIDDEN: 'This action is not available.',
  INVALID_TOKEN:
    'This link has expired or has already been used. Request a new link.',
  RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
  EMAIL_DELIVERY_FAILED: 'Email delivery is unavailable. Please try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  MALFORMED_JSON: 'Send a valid JSON body.',
  INVALID_INPUT: 'Check the submitted information.',
  BODY_TOO_LARGE: 'The request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Send an application/json body.',
} as const satisfies Record<ApiErrorCode, MessageKey>;
export function errorKey(code: unknown): MessageKey {
  return typeof code === 'string' && Object.hasOwn(errorKeys, code)
    ? errorKeys[code as keyof typeof errorKeys]
    : errorKeys.INTERNAL_ERROR;
}
