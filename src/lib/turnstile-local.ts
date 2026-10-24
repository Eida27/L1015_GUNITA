// Explicit official-test callback adaptation, never used for real provider tokens.
export const LOCAL_TURNSTILE_PREFIX = 'gunita-local-v1.';
export function localTurnstileToken(
  token: string,
  action: 'report' | 'registration',
): string {
  if (token !== 'XXXX.DUMMY.TOKEN.XXXX')
    throw new Error('Unexpected local verification token');
  return `${LOCAL_TURNSTILE_PREFIX}${action}.${Date.now()}.${crypto.randomUUID()}.XXXX.DUMMY.TOKEN.XXXX`;
}
