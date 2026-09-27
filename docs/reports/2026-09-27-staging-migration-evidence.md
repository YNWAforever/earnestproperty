# T13 staging schema expansion — 2026-09-27

## Scope and branch identity

Neon project dawn-meadow-79190048, database neondb, branch br-young-breeze-ao85rtx1 (name staging) was explicitly supplied for T13. The Neon branch API confirmed that it is ready, nondefault, has a separate read-write endpoint and is in aws-ap-southeast-1. It is a copy-on-write child of the production branch with a parent-data snapshot; it expires on 2026-10-04 unless extended. The inherited data is not an isolated synthetic automated-test fixture.

This schema-expansion step changed only the staging branch. A Preview-only staging redeploy and a separate empty synthetic test database were completed later; see 2026-09-27-staging-acceptance-evidence.md. No production deploy or migration, historical placement backfill, provider request or external message occurred. No automated fixture ran on inherited production data.

## Migration evidence

Before execution, app_migrations recorded 55 versions. These matched all prior SQL files in the current branch; only the five 2026-09-27 files were missing. The existing link, version and open row counts and digests were captured for comparison.

Each file was executed on the explicit staging branch with the Neon transaction tool, together with its app_migrations insert in the same transaction. The next file began only after the previous registry row and new schema were read back successfully.

| Order | Migration | SHA-256 | Read-back |
| --- | --- | --- | --- |
| 1 | 20260927080000_staff_notification_receipt_times.sql | 7BB26BBC48DBF4161E22156E01A7A904B098DBF765D345A73F7FD91F41DDEF43 | Registry row and six receipt columns |
| 2 | 20260927083000_staff_notification_test_attempts.sql | 3CBFB21D13224CD5E05971E09B847AB41A19D1A4E527B17ADB13D452322E2F5A | Registry row and two empty test tables |
| 3 | 20260927090000_whatsapp_link_batch_operations.sql | 09A5DAE807AA6FC3131FF99483383D81ED3F72EF59D028C322453A046E0286E1 | Registry row, four tables and commit function |
| 4 | 20260927093000_whatsapp_link_management_indexes.sql | 4820C9A50350E22B1675AA11CE3DC74EB7FB2412E9E41FD1F35FCF2774AF51A9 | Registry row, export tables and five indexes |
| 5 | 20260927100000_whatsapp_redirect_bucket_retention.sql | 6364D6B088B3CBA619E3C953F7AD03DA03C93D5E66FD4D768480BD9211332D19 | Registry row and retention index |

After execution, staging recorded 60/60 repository SQL versions. New preview, attempt, batch, placement and export tables contained zero rows. Existing tracking link, immutable version and open counts and digests were unchanged; WhatsApp enquiry count was unchanged. A separate read-only query on the production branch still showed 55 migration versions, zero 2026-09-27 versions and no batch preview table.

These checks prove the staging schema expansion and absence of observed rewrites in the checked legacy records. They do not prove application compatibility, concurrent behavior, browser journeys, provider delivery or a code rollback rehearsal.

## Original supplied Preview isolation check (before branch-scoped configuration)

The supplied Vercel alias `earnestproperty-git-codex-earnest-159f07-ynwaforevers-projects.vercel.app` resolved to READY deployment `dpl_8zUxBfVjk7N9NLpvHBGd68zQMvN9` for commit `e153ea2ada795e881819c7a81739901e3a70f130`. Vercel listed no branch-specific Preview environment variables for the audit branch. A temporary, deleted-after-inspection Preview env pull showed `NEON_BRANCH=production` and Neon Auth hosts under `ep-divine-frost-aokzrg7f`, which Neon identified as the production branch auth endpoint. The staging branch auth endpoint is under `ep-square-leaf-aobruyvf`. Vercel redacted both database connection strings in the pull, so their actual hosts were not established. No secrets were printed or retained.

That original Preview was not verified as isolated staging. Later branch-scoped staging Auth/DB variables and a Preview-only redeploy are recorded in 2026-09-27-staging-acceptance-evidence.md. Deployed runtime DB-host attestation and authenticated browser acceptance remain open.

## Remaining T13 gates

The supplied Preview alias is now attached to a branch-scoped staging redeploy and a separate synthetic database scope exists. Authenticated synthetic browser fixtures and runtime DB-host attestation are still needed before full staging journeys. The user confirmed that staging staff account 72285986-c82c-46bd-98d9-c6b021d91b0d, named test with phone suffix 3493, belongs to designated colleague Willy Lai. The user confirmed that the staff WhatsApp endpoint and tenant-approved template have not yet been created. No test request ID or provider attempt exists. Production release and a real send remain gated by the acceptance sequence.

Rollback if later code fails: turn off the new batch and notification entry points, revert compatible application code, and retain these additive staging tables, receipt columns and operation records. Reconcile any unknown send before retry. No production schema rollback is needed because production was not changed.
