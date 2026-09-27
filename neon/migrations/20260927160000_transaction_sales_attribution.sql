CREATE TABLE IF NOT EXISTS transaction_performance (
 transaction_id uuid PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 attribution_status text NOT NULL CHECK(attribution_status IN ('draft','verified_attributed','verified_unattributed','cancelled')),
 lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
 public_listing_no text REFERENCES property_public_groups(public_listing_no) ON DELETE SET NULL,
 confirmed_at timestamptz,
 commission_receivable numeric(16,2) CHECK(commission_receivable>=0),
 commission_received numeric(16,2) CHECK(commission_received>=0),
 currency char(3) NOT NULL DEFAULT 'HKD' CHECK(currency='HKD'),
 updated_by uuid NOT NULL REFERENCES staff_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_performance_overpayment CHECK(commission_received IS NULL OR (commission_receivable IS NOT NULL AND commission_received<=commission_receivable))
);
CREATE TABLE IF NOT EXISTS transaction_performance_versions (
 transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 attribution_status text NOT NULL CHECK(attribution_status IN ('draft','verified_attributed','verified_unattributed','cancelled')),
 deal_type deal_type NOT NULL,
 lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
 public_listing_no text REFERENCES property_public_groups(public_listing_no) ON DELETE SET NULL,
 confirmed_at timestamptz,
 commission_receivable numeric(16,2) CHECK(commission_receivable>=0),
 commission_received numeric(16,2) CHECK(commission_received>=0),
 currency char(3) NOT NULL DEFAULT 'HKD' CHECK(currency='HKD'),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 changed_by uuid NOT NULL REFERENCES staff_users(id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(transaction_id,version),
 CONSTRAINT transaction_performance_versions_overpayment CHECK(commission_received IS NULL OR (commission_receivable IS NOT NULL AND commission_received<=commission_receivable))
);
CREATE TABLE IF NOT EXISTS transaction_agent_credits (
 transaction_id uuid NOT NULL,
 version integer NOT NULL,
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 branch_id_at_close uuid REFERENCES branches(id),
 share_bps integer NOT NULL CHECK(share_bps>0 AND share_bps<=10000),
 PRIMARY KEY(transaction_id,version,staff_id),
 FOREIGN KEY(transaction_id,version) REFERENCES transaction_performance_versions(transaction_id,version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transaction_performance_status ON transaction_performance(attribution_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_credits_staff ON transaction_agent_credits(staff_id,transaction_id,version);
CREATE OR REPLACE FUNCTION reject_transaction_performance_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'transaction performance history is append-only'; END $$;
DROP TRIGGER IF EXISTS transaction_performance_versions_immutable ON transaction_performance_versions;
CREATE TRIGGER transaction_performance_versions_immutable BEFORE UPDATE OR DELETE ON transaction_performance_versions FOR EACH ROW EXECUTE FUNCTION reject_transaction_performance_history_change();
DROP TRIGGER IF EXISTS transaction_agent_credits_immutable ON transaction_agent_credits;
CREATE TRIGGER transaction_agent_credits_immutable BEFORE UPDATE OR DELETE ON transaction_agent_credits FOR EACH ROW EXECUTE FUNCTION reject_transaction_performance_history_change();

-- Protect confirmed performance from unversioned changes to source facts.
CREATE OR REPLACE FUNCTION guard_confirmed_transaction_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM transaction_performance p WHERE p.transaction_id=OLD.id
   AND p.attribution_status IN ('verified_attributed','verified_unattributed'))
   AND (OLD.deal_type IS DISTINCT FROM NEW.deal_type OR OLD.price IS DISTINCT FROM NEW.price
     OR OLD.deal_date IS DISTINCT FROM NEW.deal_date
     OR OLD.verification_state IS DISTINCT FROM NEW.verification_state) THEN
   RAISE EXCEPTION 'confirmed transaction requires a reasoned correction';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS confirmed_transaction_facts_guard ON transactions;
CREATE TRIGGER confirmed_transaction_facts_guard BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION guard_confirmed_transaction_facts();
