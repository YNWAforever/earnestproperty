import { z } from "zod";

export const bulkPropertyManagementSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            propertyNo: z.string().trim().min(1).max(100),
            expectedVersion: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    scope: z.enum(["sale", "rent", "all"]),
    action: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("status"),
          status: z.enum(["active", "draft", "offline", "sold", "rented"]),
        })
        .strict(),
      z.object({ type: z.literal("agent"), agentId: z.string().uuid().nullable() }).strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.propertyNo)).size !== value.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "不可重複選擇同一物業。",
      });
    }
    if (
      (value.scope === "all" &&
        (value.action.type !== "status" || value.action.status !== "offline")) ||
      (value.action.type === "status" &&
        ((value.action.status === "sold" && value.scope !== "sale") ||
          (value.action.status === "rented" && value.scope !== "rent")))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "操作不適用於所選放盤範圍。",
      });
    }
  });

export type BulkPropertyManagementInput = z.infer<typeof bulkPropertyManagementSchema>;
export type BulkPropertyResult = {
  propertyNo: string;
  ok: boolean;
  error?: string;
  uncertain?: boolean;
};
