'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { localTurnstileToken } from '@/lib/turnstile-local';
import { usePreferences } from './preferences';
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (id: string) => void;
    };
  }
}
const configSchema = z
  .object({ siteKey: z.string().min(1), localTest: z.boolean() })
  .strict();
export function VerificationWidget({
  action,
  onToken,
}: {
  action: 'report' | 'registration';
  onToken: (value: string) => void;
}) {
  const { t, locale } = usePreferences();
  const [config, setConfig] = useState<z.infer<typeof configSchema> | null>(
      null,
    ),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/verification', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = configSchema.parse(await response.json());
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!ready || !config || !container.current || !window.turnstile) return;
    const widget = window.turnstile.render(container.current, {
      sitekey: config.siteKey,
      action,
      size: 'compact',
      language: locale === 'fil' ? 'auto' : 'en',
      callback: (value: string) => {
        try {
          callback.current(
            config.localTest ? localTurnstileToken(value, action) : value,
          );
        } catch {
          setFailed(true);
          callback.current('');
        }
      },
      'expired-callback': () => callback.current(''),
      'error-callback': () => {
        callback.current('');
        setFailed(true);
      },
    });
    return () => {
      window.turnstile?.remove(widget);
      callback.current('');
    };
  }, [ready, config, action, locale]);
  return (
    <div className="verification-widget">
      <p>{t('Verification')}</p>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      <div ref={container} />
      {failed ? (
        <p role="alert">
          {t('Verification is unavailable. Please try again.')}
        </p>
      ) : null}
    </div>
  );
}
