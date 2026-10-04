-- Additive metadata only. Legacy profiles retain NULL metadata and are not
-- retroactively labelled as validated model outputs.
ALTER TABLE crm_ai_profiles
  ADD COLUMN result_kind text CHECK(result_kind IN('model_validated','deterministic','fallback','failed')),
  ADD COLUMN action_type text CHECK(action_type IN('mark_test','complete_contact','verify_source','review_enquiry','service_reply','marketing_review')),
  ADD COLUMN validation_code text;
