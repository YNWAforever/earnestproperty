-- Proposed only; Task5 tests apply exclusively in owned disposable containers.
-- One manifest is one transaction. This is a durable completion checkpoint, never a partial seed.
CREATE TABLE blog_import_receipts (
 fingerprint text PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 target_identity text NOT NULL,
 receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE blog_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON blog_import_receipts FROM PUBLIC;
CREATE FUNCTION blog_import_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BLOG_IMPORT_RECEIPT_IMMUTABLE'; END $$;
CREATE TRIGGER blog_import_receipt_immutable BEFORE UPDATE OR DELETE ON blog_import_receipts
 FOR EACH ROW EXECUTE FUNCTION blog_import_receipt_immutable();
