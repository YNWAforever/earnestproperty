/**
 * Every migration filename in neon/migrations, in apply order.
 *
 * ## Why this list exists at all
 *
 * 20260802100000_agent_specialties.sql sat unapplied in production for eleven
 * days. Nothing said so. /admin/operations reported healthy the whole time,
 * because its database.columns check only covered the control plane's own two
 * tables -- the instrument existed and was not pointed at the application
 * schema. The first signal was 代理管理 returning
 * `column s.specialties does not exist` to a human being clicking 新增代理.
 *
 * The health check now diffs this list against the app_migrations table, so an
 * unapplied migration is visible as a degraded system BEFORE someone finds it
 * by hitting a 500.
 *
 * ## Why a hand-maintained list rather than reading the directory
 *
 * The server bundle does not ship neon/*.sql -- readdirSync would find nothing
 * at runtime on Vercel, and the check would report "0 pending" forever, which
 * is worse than no check. Vite's import.meta.glob would work in the bundle but
 * not under `node --test`, which imports these modules directly.
 *
 * So the list is explicit, and migration-versions.test.mjs fails the build if it
 * drifts from the directory. Adding a migration without adding it here is a red
 * test, not a silent gap.
 *
 * Authored as plain JS with a .d.ts sibling, matching website-inquiry.js and
 * site-branches.js, so the node --test suite imports it with no build step.
 */

/** @type {readonly string[]} */
export const MIGRATION_VERSIONS = Object.freeze([
  "20260622060000_public_content.sql",
  "20260623090000_neon_admin_crm_whatsapp.sql",
  "20260624110000_ai_crm_live_agent.sql",
  "20260626120000_live_agent_security.sql",
  "20260626120100_crm_ai_profile_status.sql",
  "20260626120200_woztell_member_identity.sql",
  "20260709090000_cms_videos.sql",
  "20260710090000_agent_profiles.sql",
  "20260711090000_cms_content_revisions.sql",
  "20260712120000_ai_content_proposals.sql",
  "20260714180000_backend_control_plane.sql",
  "20260801090000_staff_public_slug_unique.sql",
  "20260802090000_listing_search_indexes.sql",
  "20260802100000_agent_specialties.sql",
  "20260816120000_staff_identity_actions.sql",
  "20260817120000_dual_source_listing_sync.sql",
  "20260817130000_youtube_channel_sync.sql",
  // Pre-existing gap, unrelated to listing_alerts below: this migration was
  // already on disk and already applied in production, but was never added
  // here, so the drift check would have reported "0 pending" for it
  // forever. Fixed while already in this exact file for the same reason.
  "20260822120000_whatsapp_audience_segment_link.sql",
  "20260830120000_listing_alerts.sql",
  "20260830130000_estate_expansion.sql",
  "20260830140000_transaction_provenance.sql",
  "20260830150000_agent_languages.sql",
  "20260830160000_branches_entity.sql",
  "20260830170000_valuation_leads.sql",
  "20260831090000_staff_viewer_role.sql",
  "20260831180000_video_category.sql",
  "20260901100000_estate_expansion_facts.sql",
  "20260901110000_estate_expansion_publish.sql",
  "20260902100000_estate_expansion_school_net_correction.sql",
  "20260902110000_estate_expansion_facts_resolution.sql",
  "20260905110000_cms_atomic_mutations.sql",
  "20260905120000_campaign_dispatch_boundary.sql",
  "20260905130000_outbound_intents.sql",
  "20260905140000_media_upload_intents.sql",
  "20260905150000_inquiry_submission_identity.sql",
  "20260905151000_consent_evidence.sql",
  "20260905180000_admin_message_paging.sql",
  "20260905181000_cms_browse_order.sql",
  "20260906020000_whatsapp_delivery_events.sql",
  "20260906021000_estate_editorial_backfill.sql",
  "20260906022000_estate_verified_details.sql",
  "20260906040000_property_public_identity.sql",
  "20260906090000_canonical_property_identity.sql",
  "20260906100000_whatsapp_inbound_leads.sql",
  "20260906110000_estate_listing_links.sql",
  "20260906120000_admin_property_management.sql",
  "20260907120000_propertyhk_ingestion_v2.sql",
  "20260909120000_source_promotion_tiers.sql",
  "20260912120000_whatsapp_enquiry_events.sql",
  "20260912130000_whatsapp_enquiry_episodes.sql",
  "20260912140000_whatsapp_assignment_evidence.sql",
  "20260912150000_whatsapp_service_workflow.sql",
  "20260912160000_staff_reference_snapshots.sql",
  "20260912170000_staff_notifications.sql",
  "20260925120000_rate_limit_bucket_cleanup.sql",
  "20260927080000_staff_notification_receipt_times.sql",
  "20260927083000_staff_notification_test_attempts.sql",
  "20260927090000_whatsapp_link_batch_operations.sql",
  "20260927093000_whatsapp_link_management_indexes.sql",
  "20260927100000_whatsapp_redirect_bucket_retention.sql",
  "20260927110000_staff_mapping_review_versions.sql",
  "20260927120000_named_inbox_folders.sql",
  "20260927130000_staff_notification_test_evidence.sql",
  "20260927140000_whatsapp_link_reference_scope.sql",
  "20260927150000_whatsapp_link_batch_mapping_guard.sql",
  "20260927160000_transaction_sales_attribution.sql",
  "20260927170000_performance_event_quality.sql",
  "20260927171000_inquiry_quality.sql",
  "20260927172000_media_asset_variants.sql",
  "20260929100000_whatsapp_inbound_receipts.sql",
  "20260929101000_whatsapp_receipt_identity.sql",
  "20260929102000_whatsapp_portal_resolution.sql",
  "20260929103000_whatsapp_no_link_episodes.sql",
  "20260929104000_whatsapp_enquiry_access.sql",
  "20260929105000_whatsapp_no_link_effects.sql",
  "20260929106000_whatsapp_enquiry_resolution_guard.sql",
  "20260929107000_whatsapp_forwarded_enquiries.sql",
  "20260930090000_whatsapp_no_link_source_authority.sql",
]);

/**
 * Migrations present in the repo but absent from app_migrations.
 *
 * Deliberately one-directional. A version recorded in the database that this
 * build does not know about is NOT reported as a problem: that is the normal
 * state during a rollback, or while a newer deploy is briefly live alongside an
 * older one, and flagging it would cry wolf during exactly the moments when
 * operators most need the signal to mean something.
 *
 * @param {Iterable<string>} appliedVersions
 * @returns {string[]}
 */
export function pendingMigrations(appliedVersions) {
  const applied = new Set(appliedVersions);
  return MIGRATION_VERSIONS.filter((version) => !applied.has(version));
}
