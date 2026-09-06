import { z } from "zod";

export const sharedPropertySchema = z.object({
  title_zh: z.string().trim().min(1).max(500),
  title_en: z.string().max(500).nullable(),
  estate_id: z.string().uuid().nullable(),
  district_slug: z.string().min(1).max(100),
  address: z.string().max(1000).nullable(),
  saleable_area: z.number().int().nonnegative().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: z.number().int().nonnegative().nullable(),
  floor: z.string().max(100).nullable(),
  description: z.string().max(50000).nullable(),
  images: z.array(z.string().max(4000)).max(100),
  seo_title: z.string().max(500).nullable(),
  seo_description: z.string().max(2000).nullable(),
  video_url: z.string().max(4000).nullable(),
});
export type SharedPropertyFields = z.infer<typeof sharedPropertySchema>;
export type ManagedOffering = {
  id: string;
  dealType: "sale" | "rent";
  price: number | null;
  rent: number | null;
  status: string;
  description: string | null;
  agentId: string | null;
  agentName: string | null;
  editable: boolean;
};
export type ManagedPropertySummary = {
  propertyNo: string;
  title: string;
  estateName: string | null;
  image: string | null;
  saleableArea: number | null;
  offerings: { sale: ManagedOffering | null; rent: ManagedOffering | null };
  version: string;
  editableShared: boolean;
  unlinked: boolean;
  reviewRequired: boolean;
};
export type ManagedPropertyDetail = ManagedPropertySummary & {
  shared: SharedPropertyFields;
  history: {
    id: string;
    listingNo: string;
    dealType: string;
    status: string;
    sourceUpdatedAt: string | null;
    current: boolean;
  }[];
  conflicts: { field: string; values: string[] }[];
  managementAvailable: boolean;
};
export const propertyGroupFiltersSchema = z
  .object({
    q: z.string().max(200).optional(),
    status: z
      .enum(["all", "active", "draft", "offline", "inactive", "sold", "rented"])
      .default("active"),
    deal: z.enum(["all", "sale", "rent"]).optional(),
    estateId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type PropertyGroupFilters = z.input<typeof propertyGroupFiltersSchema>;
export type PropertyGroupPage = {
  rows: ManagedPropertySummary[];
  total: number;
  page: number;
  pageSize: number;
};
const payloadSchema = sharedPropertySchema
  .partial()
  .extend({
    price: z.number().finite().nonnegative().nullable().optional(),
    rent: z.number().finite().nonnegative().nullable().optional(),
    status: z.enum(["draft", "active", "sold", "rented", "offline"]).optional(),
    agentId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const propertyManagementSchema = z
  .object({
    propertyNo: z.string().trim().min(1).max(100),
    expectedVersion: z.string().min(1).max(200),
    scope: z.enum(["shared", "sale", "rent", "all"]),
    payload: payloadSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = Object.keys(value.payload);
    const allowed =
      value.scope === "shared"
        ? Object.keys(sharedPropertySchema.shape)
        : value.scope === "all"
          ? ["status"]
          : value.scope === "sale"
            ? ["price", "status", "description", "agentId"]
            : ["rent", "status", "description", "agentId"];
    if (
      !keys.length ||
      keys.some((key) => !allowed.includes(key)) ||
      (value.scope === "all" && value.payload.status !== "offline") ||
      (value.scope === "sale" && value.payload.status === "rented") ||
      (value.scope === "rent" && value.payload.status === "sold")
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Payload does not match the selected management scope",
      });
  });
export type PropertyManagementInput = z.infer<typeof propertyManagementSchema>;
