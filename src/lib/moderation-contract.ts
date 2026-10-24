import { z } from 'zod';
import { publicThoughtSchema } from './thought-contract';
export const reportReasons = [
  'harassment',
  'private_info',
  'threats',
  'self_harm_encouragement',
  'spam',
  'other',
] as const;
export const reasonCodes = [
  'HARASSMENT',
  'PRIVATE_INFO',
  'THREATS',
  'SELF_HARM_ENCOURAGEMENT',
  'SPAM',
  'OTHER',
  'NO_VIOLATION',
] as const;
export const reportInputSchema = z
  .object({
    thoughtPublicId: z.string().regex(/^t_[A-Za-z0-9_-]{22,64}$/),
    reason: z.enum(reportReasons),
    details: z
      .string()
      .trim()
      .max(500)
      .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(v))
      .optional(),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
export const moderateInputSchema = z
  .object({
    action: z.enum(['hide', 'unhide', 'delete']),
    reasonCode: z.enum(reasonCodes),
  })
  .strict();
export const suspensionInputSchema = z
  .object({ suspended: z.boolean(), reasonCode: z.enum(reasonCodes) })
  .strict();
export const reviewInputSchema = z
  .object({
    status: z.enum(['reviewing', 'resolved']),
    reasonCode: z.enum(reasonCodes),
  })
  .strict();
export const adminAccountSchema = z
  .object({
    id: z.uuid(),
    pseudonym: z.string().min(1).max(64),
    status: z.enum(['active', 'suspended']),
    role: z.enum(['member', 'admin']),
  })
  .strict();
export const reportSchema = z
  .object({
    id: z.uuid(),
    reason: z.enum(reportReasons),
    details: z.string().max(500).nullable(),
    status: z.enum(['open', 'reviewing', 'resolved']),
    createdAt: z.iso.datetime(),
    reporterCategory: z.enum(['guest', 'member']),
    thought: publicThoughtSchema.nullable(),
    thoughtStatus: z.enum(['published', 'hidden']).nullable(),
    author: adminAccountSchema.nullable(),
  })
  .strict();
export const reportsResponseSchema = z
  .object({
    items: z.array(reportSchema).max(20),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const accountsResponseSchema = z
  .object({ items: z.array(adminAccountSchema).max(20) })
  .strict();
export const auditResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            action: z.enum([
              'hide',
              'unhide',
              'delete_thought',
              'suspend',
              'unsuspend',
              'dismiss_report',
              'review_report',
              'bootstrap_admin',
            ]),
            subjectKind: z.enum(['thought', 'account', 'report']),
            reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
            changedStatus: z
              .enum([
                'published',
                'hidden',
                'active',
                'suspended',
                'open',
                'reviewing',
                'resolved',
                'member',
                'admin',
              ])
              .nullable(),
            createdAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(20),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export type AdminReport = z.infer<typeof reportSchema>;
export type AdminAccount = z.infer<typeof adminAccountSchema>;
