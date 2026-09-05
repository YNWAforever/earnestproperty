import { queryRows } from "@/lib/neon/db.server";
export const mediaUploadRepository = {
  async claim(input: {
    id: string;
    staff_id: string;
    fingerprint: string;
    pathname: string;
    contentType: string;
    size: number;
    ownerType: string;
  }) {
    const inserted = await queryRows(
      `INSERT INTO media_upload_intents
      (id, created_by, fingerprint, pathname, content_type, size_bytes, owner_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [
        input.id,
        input.staff_id,
        input.fingerprint,
        input.pathname,
        input.contentType,
        input.size,
        input.ownerType,
      ],
    );
    const rows = inserted.length
      ? inserted
      : await queryRows(`SELECT * FROM media_upload_intents WHERE id=$1`, [input.id]);
    if (!rows[0]) throw new Error("UPLOAD_INTENT_UNAVAILABLE");
    const row = rows[0];
    return {
      fresh: inserted.length > 0,
      intent: {
        id: String(row.id),
        staff_id: String(row.created_by),
        fingerprint: String(row.fingerprint),
        pathname: String(row.pathname),
        url: row.url ? String(row.url) : null,
      },
    };
  },
  async complete(intent: { id: string; staff_id: string; fingerprint: string }, url: string) {
    await queryRows(
      `WITH completed AS (
      UPDATE media_upload_intents SET url=$4, completed_at=now()
      WHERE id=$1 AND created_by=$2 AND fingerprint=$3 RETURNING *
    ) INSERT INTO media_assets (upload_intent_id,url,pathname,content_type,size_bytes,owner_type,created_by)
      SELECT id,url,pathname,content_type,size_bytes,owner_type,created_by FROM completed
      ON CONFLICT (upload_intent_id) DO NOTHING`,
      [intent.id, intent.staff_id, intent.fingerprint, url],
    );
  },
};
