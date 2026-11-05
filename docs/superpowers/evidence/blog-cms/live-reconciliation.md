# Live blog inventory reconciliation — 2026-11-05

**Inventory collected and validated. Production unchanged. Release remains blocked.**

The user explicitly confirmed the documented production database and authorized the existing owner connection with enforced READ ONLY transactions. Application-to-database binding is recorded as **USER_CONFIRMED**, not automated endpoint proof. No connection string was retrieved, printed or saved.

## Target and consistency

- Neon project `dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, endpoint `ep-divine-frost-aokzrg7f`, database `neondb`, role `neondb_owner`.
- Vercel public-domain metadata refreshed: production `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5`, READY, source `8b49d0a21c867c401c4d41db393e43c8db76a74d`.
- Inventory transaction started at **2026-11-05T11:53:31.249694Z**, snapshot `1977045:1977045:`. The reviewed collector validated the same snapshot, database, role, READ ONLY and repeatable-read settings at both ends, unchanged catalog, and deterministic counts/rows. Transaction-local statement timeout 15s, lock timeout 3s, idle timeout 30s; row security was set off to fail rather than silently filter inaccessible rows.
- All 14 collector query results returned and validated within one transaction after `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. Separate metadata preflight and independent zero-count verification were also read-only.

## Observed inventory

| Item | Observed count / status |
| --- | --- |
| Database article rows, all publication states | **0** |
| Article revisions, all authors and states | **0** |
| Private article drafts / draft-only identities | **0 / 0** |
| Applied migration ledger entries | **95** |
| Unfiltered deployed registry articles | **112** |
| Exact public article URLs matching registry | **112** |
| Policy route excluded from article import | **1** |
| Main/category presentation pages | **8** |
| Exact category query keys | **7** |
| Public-only URLs missing registry / registry-only URLs missing sitemap | **0 / 0** |
| Registry articles absent from database | **112** |
| Database-only articles / private-draft collisions | **0 / 0** |

The zero article/revision counts were independently confirmed using the same explicit owner target. Both tables have RLS and forced RLS disabled and are owned by `neondb_owner`; zero is not an inaccessible or filtered result. A resource-type count check found only estate/FAQ revision types, with no alternate article revision type. Unrelated revision bodies were not collected.

The fresh public capture started at **2026-11-05T11:54:46.574Z** and returned nine HTTP 200 responses: main blog, all seven categories and sitemap. All 112 registry URLs match the sitemap and observed page-link union; the sitemap also contains `/blog/editorial-standards`, which remains a separate policy route. These public observations and the database snapshot are separate point-in-time observations, not a cross-service atomic snapshot. Individual article responses/media were not crawled.

## Schema and disposition

The database still has the legacy article schema. Seven new article columns and six new blog tables are absent, and none of the three proposed blog migrations is installed. Absent tables have `null` counts, never fabricated zero rows. All existing in-scope rows are captured; the collector correctly reports **schema-limited** and withholds normalized `DatabaseSnapshot` output. There were no numeric-precision gaps.

Each of the 112 source/public articles is recorded privately as `SOURCE_ONLY_CANDIDATE_REQUIRES_REHEARSAL_AND_APPROVAL`, retaining its exact slug/URL and source date. This is an observed disposition register, **not an executable or approved import manifest**. No existing database article is being overwritten, but the migration/import still needs isolated rehearsal and release controls. Two registry records omit publication dates; approved preservation/default behavior must be exercised in that rehearsal rather than inventing a date during capture.

The pure public/source normalization report still has `UNKNOWN_LIVE_DATABASE` and `source:database`, because it deliberately receives no DB adapter. The separate combined `reconciliation.json` binds that source bundle to the captured database and supplies the actual zero counts. No missing schema, system identifier or revision history was synthesized to force importer readiness.

## Private evidence and verification

All raw files are under ignored `.private-sync-evidence/blog-import/`; no raw payloads or credentials were added to Git. Files were created exclusively, hashed, read back, and marked read-only locally. ACL inspection found no generic Everyone/Users/Authenticated Users/Anonymous allow grants. Owners can override file attributes; this is not WORM storage or a recoverable database backup.

| Artifact | SHA-256 |
| --- | --- |
| Binding confirmation receipt | `80d7555c89f0d36d21e27108535ba36b9c013e94dcb1297ea5cdd9e770a0497b` |
| Collector canonical raw snapshot | `346929ae303798c3ee4ad51487cf36aa3c3b58e573d479a48233f59927caedd1` |
| Fresh source bundle, file bytes | `60f95f002b0b0f1da1ad4145b7a8d02f14ab19066e9bd3a18bd9b3563a71427e` |
| Fresh source bundle, contract fingerprint | `dd82d936e236b64f45c40c8fcded5b651c8c043c35b2b649aecc3d59a38d1d04` |
| Database evidence seal, 11 verified entries | `e90c5d02e8b1bdbdea66fa22f6ba87fc918b482d102ed3a32d81cbd8471ef375` |
| Public/source evidence seal, 39 verified entries | `62d44550cc9ab25671f388dc81080e52bbb40890aae4b2ff86dc4c67d2f038b6` |

Database capture directory: `live-database-2026-11-05T11-51-46-243Z`. Fresh public/source directory: `public-source-2026-11-05T11-54-46-574Z`. Both are beneath the ignored directory above. The original earlier captures and receipts remain intact.

The collector source still matches reviewed hash `5e1672bd937c375c3f1243ff1e51f3275e7f736bce5d3161ea1236831ff307a3`. Local loader preparation required a generated CommonJS bridge; no reviewed source was changed. The first public normalization attempt lacked its provider receipt; its empty output directory was retained, the receipt added, and normalization succeeded on retry. No failure was treated as an empty database.

## Release plan implications

Binding/access/inventory blockers are resolved for this capture. Next: rehearse the observed legacy schema and the three migrations on an isolated owned target, prepare/review the exact 112-article import manifest and production adapter, and verify every preserved URL and CMS edit path. Full-source build/HTTP binding must be refreshed after operational source additions. Hosted auth/storage/CDN, actual all-writer fencing, recoverable backup/restore, owner assignments and final under-fence freshness checks remain release gates.

No push, merge, deployment, role/grant change, migration, import or content write occurred. Each consequential release action still requires separate approval. See the [release plan](../../plans/2026-11-05-blog-cms-live-reconciliation-release.md).
