-- Names are maintained locally because the public Inbox integration API exposes user filtering,
-- not a Folder catalog. No Folder is assumed or seeded for a tenant.
CREATE TABLE IF NOT EXISTS whatsapp_inbox_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_scope text NOT NULL,
  channel_id text NOT NULL,
  folder_key text NOT NULL,
  display_name text NOT NULL,
  provider_folder_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES staff_users(id),
  updated_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_scope, channel_id, folder_key),
  UNIQUE (provider_scope, channel_id, provider_folder_id)
);
CREATE INDEX IF NOT EXISTS wa_inbox_folders_active
  ON whatsapp_inbox_folders (provider_scope, channel_id, active);
