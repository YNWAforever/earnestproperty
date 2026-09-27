import { z } from "zod";

export const linkPageInput = z
  .object({
    q: z.string().trim().max(100).optional(),
    source: z.enum(["website", "28hse", "youtube", "other"]).optional(),
    staffId: z.string().uuid().optional(),
    enabled: z.boolean().optional(),
    cursor: z.string().max(400).optional(),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  })
  .strict();
export type LinkPageFilter = z.infer<typeof linkPageInput>;
