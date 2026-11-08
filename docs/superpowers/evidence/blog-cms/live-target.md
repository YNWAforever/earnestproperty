# Live target readiness — 2026-11-05

**Latest:** production binding was explicitly USER_CONFIRMED and owner access authorized with enforced READ ONLY transactions. Inventory completed; see [live-reconciliation.md](live-reconciliation.md). Metadata observations below remain historical, not automated endpoint proof.

Current status: target binding USER_CONFIRMED; read-only collection and local rehearsal completed. See [release-request.md](release-request.md) for current candidate/gates. The sections below retain the earlier metadata observation and original candidate; their NOT_RUN/UNKNOWN statements are historical. No push, merge, deployment, migration, database write, credential creation or writer pause performed.

## Directly verified

- Vercel domain `www.earnestproperty.com` resolves in deployment metadata to production deployment `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5`, READY, project `prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5` (`earnestproperty`), team `team_qvzlsFmfCsLkgItSypqHjw3z`.
- Deployed source: `main`, `8b49d0a21c867c401c4d41db393e43c8db76a74d`. This is the original baseline, not the uncommitted CMS candidate.
- Neon organization `org-withered-credit-79001055` contains project `dawn-meadow-79190048` (`Earnestproperty`), PostgreSQL 18, Singapore region. The other two connected organizations returned no matching project.
- That project's primary/default branch is `br-polished-sea-aom4i1ct`, named `production`; its active read/write endpoint is `ep-divine-frost-aokzrg7f`.
- Current Vercel project environment metadata contains production `DATABASE_URL` and `DATABASE_URL_UNPOOLED` entries of type sensitive. Values were not requested. The separately read non-secret `NEON_BRANCH` value is `production`.
- These matching names do NOT prove the deployed application's database endpoint/database identity. Current project configuration also does not prove the immutable deployment's environment binding.

## Access observations

The Vercel connector environment listing returned 403. Its suggested native CLI command rejected `--project`. The equivalent explicitly scoped read-only CLI API request succeeded; output was filtered to metadata, excluding values. The non-secret branch identifier was separately read and validated before output. No environment pull or credential files were created.

Neon metadata access is administrative, not evidence of a least-privilege read-only collection session. No SQL or application content queries were executed.

## Local candidate, reverified this session

`verifyBuildReceipt()` passed against the current working tree and built output:

| Field | Value |
| --- | --- |
| Base HEAD | `8b49d0a21c867c401c4d41db393e43c8db76a74d` |
| Source SHA-256 | `947e25836611d71caea647f0062bc5010570896045c6d39a7dfac725c71aef4f` |
| Output SHA-256 | `5e38e73cc2f3d18b4e2c6553435f67bcb0d0287b53da32658ec330a42e3b88af` |
| Receipt SHA-256 | `c6e0549f5afd30f50fbf32eea0455d10327f3033fdc863668ddbf1cd5a8ee0b9` |
| Build time UTC | `2026-11-05T04:37:53.777Z` |
| Local Node | `v26.13.0` |

Vercel project metadata reports Node `24.x`; hosted runtime parity remains unverified. Existing local acceptance is not hosted acceptance.

## Required before live collection

1. Independently establish the deployed application's endpoint and database name, using a non-secret runtime/provider binding receipt. Branch name alone is insufficient.
2. Establish an existing read-only access path and verified read-only repeatable-read session. Do not create a role or alter production permissions without separate approval.
3. Assign editorial, database, platform and release owners. Names have not been supplied; do not infer them from account ownership.
4. Implement and test the separate collector against owned fixtures per the release plan before running it live. Keep the owned-only importer guard intact.

All live article/revision/draft counts remain UNKNOWN. Schema capabilities, reconciliation dispositions, writer fencing and backup/restore readiness remain unverified. Task 1 is partial; Task 2 live execution is blocked by these prerequisites. No release approval is requested by this receipt.

See [reconciliation and release plan](../../plans/2026-11-05-blog-cms-live-reconciliation-release.md).
