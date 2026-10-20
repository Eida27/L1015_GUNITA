import nodemailer from 'nodemailer';

export type AccountMail = {
  to: string;
  kind: 'verify' | 'reset';
  token: string;
};
export type EmailSender = {
  send: (mail: AccountMail) => Promise<void>;
  check: () => Promise<void>;
};

export function accountEmail(
  origin: string,
  kind: AccountMail['kind'],
  token: string,
) {
  const reset = kind === 'reset';
  const link = `${origin}/${reset ? 'reset-password' : 'verify-email'}#token=${encodeURIComponent(token)}`;
  return {
    subject: reset ? 'Reset your Gunita password' : 'Verify your Gunita email',
    text: `${reset ? 'Choose a new password' : 'Verify your email'} for Gunita.\n\n${link}\n\nThis link expires in one hour and can only be used once. If you did not request this, you can ignore this email.\nGunita — A place for feelings left unsaid.`,
  };
}

// Provider-neutral boundary; only this adapter knows SMTP. No bodies or links are logged.
export function smtpSender(
  origin: string,
  port = Number(process.env.SMTP_PORT || 1028),
): EmailSender {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || '127.0.0.1',
    port,
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD || '',
          },
        }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
  });
  return {
    async check() {
      try {
        await transport.verify();
      } catch {
        throw new Error('EMAIL_DELIVERY_FAILED');
      }
    },
    async send({ to, kind, token }) {
      try {
        await transport.sendMail({
          from: process.env.SMTP_FROM || 'Gunita <hello@gunita.test>',
          to,
          ...accountEmail(origin, kind, token),
        });
      } catch {
        throw new Error('EMAIL_DELIVERY_FAILED');
      }
    },
  };
}
