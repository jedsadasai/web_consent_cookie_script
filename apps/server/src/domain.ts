import { z } from 'zod';

export const CONSENT_ACTIONS = ['accept_all', 'reject_all', 'custom', 'withdraw'] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** Body of POST /api/v1/consent — strict: unknown keys are rejected. */
export const consentBodySchema = z
  .object({
    eventId: z.string().uuid(),
    consentId: z.string().uuid(),
    siteKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    subjectId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .optional(),
    action: z.enum(CONSENT_ACTIONS),
    categories: z
      .object({
        necessary: z.literal(true),
        preferences: z.boolean(),
        analytics: z.boolean(),
        marketing: z.boolean(),
      })
      .strict(),
    policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
    language: z.enum(['th', 'en']),
    pageUrl: z.string().max(2048).url().optional(),
  })
  .strict();

export type ConsentBody = z.infer<typeof consentBodySchema>;

/** Row written to dbo.ConsentRecord. */
export interface ConsentRecord {
  eventId: string;
  consentId: string;
  siteKey: string;
  subjectId: string | null;
  action: ConsentAction;
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  policyVersion: string;
  language: 'th' | 'en';
  pageUrl: string | null;
  ipTruncated: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export type InsertResult = 'created' | 'duplicate';

export interface ConsentRepository {
  insert(record: ConsentRecord): Promise<InsertResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
