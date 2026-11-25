import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";

const target = z.object({ leadId: z.string().uuid(), staffId: z.string().uuid() }).strict();
const approval = target
  .extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), identityReviewed: z.literal(true) })
  .strict();

const list = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  await requireStaffAccess(getRequest(), ["admin", "manager"]);
  const { providerChannelId } = await import("../whatsapp-enquiries/wa-config.server");
  const channelId = providerChannelId();
  if (!channelId) throw new Response("未設定公司 WhatsApp 渠道。", { status: 409 });
  return (await import("./historical-lead-route.server")).listHistoricalRecipients(channelId);
});
const preview = createServerFn({ method: "GET" })
  .inputValidator(target)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    const { previewHistoricalStaffResend } =
      await import("./historical-resend-dispatch/historical-resend-dispatch.server");
    const result = await previewHistoricalStaffResend(data, actor);
    return { ...result, previewOnly: process.env.VERCEL_ENV !== "production" };
  });
const send = createServerFn({ method: "POST" })
  .inputValidator(approval)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    if (process.env.VERCEL_ENV !== "production")
      throw new Response("預覽環境只供身分覆核。", { status: 403 });
    return (
      await import("./historical-resend-dispatch/historical-resend-dispatch.server")
    ).dispatchHistoricalStaffResend(
      { leadId: data.leadId, staffId: data.staffId, fingerprint: data.fingerprint, confirm: true },
      actor,
    );
  });
export const fetchHistoricalRecipients = (current: () => boolean) =>
  callStaffServerFn(list, {}, current);
export const reviewHistoricalRecipient = (data: z.infer<typeof target>, current: () => boolean) =>
  callStaffServerFn(preview, { data }, current);
export const sendHistoricalNotification = (
  data: z.infer<typeof approval>,
  current: () => boolean,
) => callStaffServerFn(send, { data }, current);
