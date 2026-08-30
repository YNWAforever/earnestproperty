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
