-- Read-side indexes for deterministic link pages and factual open/enquiry counts.
CREATE INDEX IF NOT EXISTS wa_tracking_links_created_id ON whatsapp_tracking_links(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS wa_tracking_versions_filter ON whatsapp_tracking_link_versions(placement_source,enabled,requested_staff_id,link_id,version);
CREATE INDEX IF NOT EXISTS wa_link_opens_by_link ON whatsapp_link_opens(link_id,id);
CREATE INDEX IF NOT EXISTS wa_inquiries_by_link_open ON inquiries(link_open_id,id) WHERE link_open_id IS NOT NULL AND source='whatsapp';

-- Short-lived, actor-scoped export membership and immutable link version snapshot.
CREATE TABLE IF NOT EXISTS whatsapp_link_export_snapshots (
 id uuid PRIMARY KEY,
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 scope text NOT NULL CHECK(scope IN ('selected','all')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX IF NOT EXISTS wa_link_export_expiry ON whatsapp_link_export_snapshots(expires_at);
CREATE TABLE IF NOT EXISTS whatsapp_link_export_items (
 snapshot_id uuid NOT NULL REFERENCES whatsapp_link_export_snapshots(id) ON DELETE CASCADE,
 ordinal bigint NOT NULL,
 link_id uuid NOT NULL REFERENCES whatsapp_tracking_links(id),
 version integer NOT NULL,
 PRIMARY KEY(snapshot_id,ordinal),
 UNIQUE(snapshot_id,link_id)
);
