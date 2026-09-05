import { withStaffUploadIdentity } from "@/auth";

// File content binds retries across re-selection and reload in this tab. A failed
// storage write stops before dispatch, so reload cannot accidentally create a new blob.
export async function uploadAdminMedia(file: File, ownerType: string) {
  if (
    !file.size ||
    file.size > 5 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
  ) {
    throw new Error("請選擇非空白 JPG / PNG / WEBP / AVIF 檔案，每張不超過 5MB。");
  }
  const { actorId, headers } = await withStaffUploadIdentity();
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const key = `media-upload:${encodeURIComponent(actorId)}:${ownerType}:${file.type}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const stored = sessionStorage.getItem(key);
  const intent: { id: string; receipt?: string } = stored
    ? JSON.parse(stored)
    : { id: crypto.randomUUID() };
  sessionStorage.setItem(key, JSON.stringify(intent));
  const body = new FormData();
  body.set("file", file);
  body.set("ownerType", ownerType);
  body.set("uploadId", intent.id);
  if (intent.receipt) body.set("receipt", intent.receipt);
  let response: Response;
  try {
    response = await fetch("/api/admin/media/upload", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body,
    });
  } catch {
    throw new Error(`上載結果未確認，請重新選擇相同檔案查核。編號：${intent.id}`);
  }
  const data = await response.json().catch(() => null);
  if (data?.receipt) {
    intent.receipt = data.receipt;
    sessionStorage.setItem(key, JSON.stringify(intent));
  }
  if (!response.ok || !data?.ok || typeof data.url !== "string") {
    const text =
      data?.error === "UPLOAD_METADATA_PENDING"
        ? "檔案已上載，資料待補存；請重新選擇相同檔案重試。"
        : data?.error === "UPLOAD_OUTCOME_UNKNOWN"
          ? "上載結果未確認；請聯絡管理員查核，勿建立新上載。"
          : "上載未完成，請重試。";
    throw new Error(`${text} 編號：${intent.id}`);
  }
  return { url: data.url as string, pathname: data.pathname as string };
}
