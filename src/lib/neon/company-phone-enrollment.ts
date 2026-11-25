import { z } from "zod";

export const companyPhoneEnrollment = z
  .object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    phone: z.string().trim().min(1).max(32),
    companyRecordRef: z.string().trim().min(1).max(160),
    authorizeAllHours: z.literal(true),
  })
  .strict();
