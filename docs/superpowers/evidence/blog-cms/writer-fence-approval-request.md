# Writer fence activation and separate reopening request

Status: **BLOCKED_NOT_ACTIVATED**. Willy remains platform/deployment and
database/recovery owner. Ownership is not action approval. No production setting,
workflow, role/grant, session, staff access or object was changed by this task.

The [register](writer-control-register.json) contains 36 identified proposed
controls, each with observed pre-state, explicit gaps, source references, control
steps, proof, drain criteria, retained evidence and reopening steps. It is bound
to inspected source head `52fe2f456d993fd3b0b715d846c45322a5e04526` and proposal
generation `blog-cms-writer-proposal-20261106-01`. Eventual activation must bind
the final reviewed release head and packet as well.

Current register bytes SHA-256:
`c18e38ba38248e76d932b750baec11e28181c8c49479e0168b276832b51a0150`.
Refreshing any pre-state requires a new hash and review, not reuse of this digest.

## Evidence boundary and expiry

The supplied `writer-read-only-observations.json` was captured at
`2026-11-06T20:40:47.6592322+08:00`. It confirms active workflows and these
non-secret values: `OWNER_PUBLICATION_DAILY_ENABLED=true`,
`OWNER_PUBLICATION_MANUAL_APPLY_ENABLED=true`, `PROPERTY_SYNC_DAILY_ENABLED=true`,
`PROPERTY_SYNC_OBSERVABILITY_ENABLED=true`, `IMPORT_TARGET_ENV=production`,
`IMPORT_BLOB_TARGET_ENV=production`, `PROPERTY_SYNC_EXPECTED_BRANCH=main`.
Historical completed runs are not current drain evidence.

The register also hashes existing value-free `release-provider-metadata.json`
and `recovery-blob-metadata.json` in the same task workspace. The former is a
November 5 snapshot of one deployment, five aliases and DB roles/sessions. Blob
metadata identifies the store and its three connected environments but lacks its
own capture timestamp; refresh before relying on it. No secret values were read.

The supplied writer JSON has **no Cloudflare trigger/deployment fields**. Cron
expressions below are repository configuration, not live provider attestation.
Unknown state remains a blocker, never an assumed zero or disabled state.

Proposal expiry is `2026-11-07T12:40:47Z`, at most 24 hours after the latest
observation. Expiry invalidates proposal use; it never releases external controls.
Refresh and issue a new generation after expiry or any pre-state/inventory change.
Tests use an explicit historical clock, not a claim of present freshness. Actual
activation approval and fence evidence require separately bounded windows.

## Exact resource scope

| Surface | Non-secret resources | Register controls |
| --- | --- | --- |
| Vercel | Project `prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5`, team `team_qvzlsFmfCsLkgItSypqHjw3z`; deployment `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5` | `vercel-current`, `vercel-alias-1` through `vercel-alias-5`, `vercel-other` |
| GitHub | `YNWAforever/earnestproperty`, production branch `main`, concurrency `property-sync-agent-540` | `github-owner`, `github-pipeline`, `github-record`, five other workflows and `github-dispatch` |
| Cloudflare | Account `e387dfbeded3deb5b8f0023a78a660b5` from MLS config; `earnestproperty-cron`, `earnest-mls-container`, `earnest-mls-runner`; cron account binding requires live verification | `cloudflare-cron`, `cloudflare-wake-consumers`, `cloudflare-mls` |
| Neon | Project `dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, database `neondb`; direct endpoint must match `production-target.ts` and independently verified evidence | `db-owner`, `db-runtime`, `db-privileged`, `db-other-roles`, `db-sessions`, `direct-tools`, `provider-consoles` |
| CMS/blog/access | Generic revisions, copilot proposal/audit/usage, article/settings/category/feature routines, staff activation/roles/bootstrap/auth sessions | `cms-generic`, `cms-copilot`, `blog-articles`, `blog-settings-features`, `blog-categories`, `staff-access` |
| Blob | `store_sEHe3hQ90qGByxQA` / `earnestproperty-media`, public, `hkg1`, production/preview/development | `blob-upload`, `blob-finalization`, `blob-variants`, `blob-delete-console` |

Known Vercel hosts, each separately registered:

- `earnestproperty-iatgxp51a-ynwaforevers-projects.vercel.app` (immutable deployment)
- `www.earnestproperty.com`
- `earnestproperty.vercel.app`
- `earnestproperty.com`
- `earnestproperty-ynwaforevers-projects.vercel.app`
- `earnestproperty-git-main-ynwaforevers-projects.vercel.app`

Before approval, enumerate every historical/preview/development deployment with
production DB or Blob access and extend the register and reviewed coverage
catalog. This list does not claim that no other deployment can write.

## Request A: ACTIVATE-WRITER-FENCE

This is a scoped request for later approval, **not a request to execute in this
chat**. It remains non-actionable until missing exact identifiers/pre-states are
collected and independently reviewed. Do not approve an unresolved wildcard.

1. **Freeze control changes.** Name every provider owner, SQL-console operator,
   credential holder, dispatch caller and emergency operator. Capture effective
   permissions and an independently witnessed exclusive-change agreement. Monitor
   audit feeds through reopening. Freeze deployments, aliases, tokens, roles,
   grants, schedules, workflows and staff-access changes.
2. **Close ingress.** Apply an owner-reviewed provider deny to all requests on
   every registered Vercel hostname/deployment, including hashed TanStack server
   functions, cron endpoints, APIs and bypass holders. Captured password
   protection is off, SSO is `all_except_custom_domains`, trusted IPs are off.
   These are pre-states, not sufficient controls. Attach exact effective rule
   IDs, matches, exemptions and restoration payloads before approval. Broad
   application downtime is proposed because auth bootstrap/identity binding can
   write even on a read/auth path. Custom-domain-only protection is insufficient.
3. **Stop workflow admission.** Request reversible disablement of
   `.github/workflows/property-sync-daily.yml`, `migration-drift.yml`,
   `property-sync-watchdog.yml`, `property-price-status-sync.yml`, `ci.yml` and
   `property-sync-acceptance.yml` in the named repository. All six were captured
   `active`. Include schedules, all-ref manual dispatch, reruns, reusable consumers
   and dashboard dispatch. Set the four captured true flags
   `OWNER_PUBLICATION_DAILY_ENABLED`, `OWNER_PUBLICATION_MANUAL_APPLY_ENABLED`,
   `PROPERTY_SYNC_DAILY_ENABLED`, `PROPERTY_SYNC_OBSERVABILITY_ENABLED` to false
   as defense in depth; leave both import target environment values unchanged.
   Proven read-only/disposable workflows may be excluded only by an updated
   reviewed inventory proving role/target isolation. SELECT-only code using owner
   credentials is not isolation. Inspect all refs and the concurrency group:
   pausing admission does not stop existing jobs or the `record` finalizer.
4. **Stop worker admission.** Capture actual live trigger and worker versions.
   Proposed cron removal covers `*/10 0-13 * * *` and `0 14-23 * * *` UTC only if
   live readback matches. Deny `/wake/service`, `/wake/general`,
   `/api/admin/whatsapp/service-worker`, `/api/admin/control-plane/worker`,
   including direct authorized callers. Hold both `JOB_WAKE` lane alarms and
   enqueue/retry paths. Freeze MLS workflow/container starts/retries and preserve
   checkpoints. Cron removal alone cannot stop alarms or direct consumers.
5. **Establish sustained DB isolation.** Supply the exact reviewed credential and
   identity separation plan, saved membership/grant/owner matrix, endpoint
   mapping, distinct release identity and per-holder admission denies.
   `neondb_owner` owns target tables and has CREATEROLE/CREATEDB/BYPASSRLS;
   `cloud_admin` and `neon_service` need privileged-control proof. Include
   `neon_auth` and `migration_monitor` effective privileges. An owner allowlist,
   ordinary REVOKE, trigger or table lock cannot exclude holders able to undo it.
   No new role names, grant statements, rotations or PID termination targets are
   invented here. Their exact plan is a **blocking external prerequisite** and
   needs a separate reviewed production-change request if changes are necessary.
6. **Hold media and access writers.** Block intent/PUT, receipt finalization,
   deletion/overwrite, variant/backfill and external console/SDK writes to the
   named Blob store across all three environments. Attach the real reversible
   provider/credential deny and holder inventory. If unavailable, stop for a
   separate credential-change design. Preserve object bytes/keys, references,
   pending intents and recovery receipts privately. Block staff reactivation,
   role/invite/bootstrap and session-issuing admin paths. This request does not
   deactivate staff or revoke sessions; either requires a separate per-identity
   approval and saved-state map.
7. **Drain.** Stop new admissions first, then wait for admitted work under
   supervision. Do not implicitly cancel jobs or terminate sessions. Attach a
   per-resource worksheet with maximum runtime/retry horizon, timestamps,
   invocation counts, pending/leased jobs, workflow run IDs, PID/transaction/lock
   waiter counts and media disposition. Take two observations separated by the
   longest applicable runtime/retry horizon. Idle owner sessions, held write
   waiters, pending finalizers and unknown object outcomes are not success. Pending
   jobs may remain only if inventoried and held behind independently proven
   controls. Unknown media outcomes require reconciliation, not blind retry.
8. **Prove denies and retain the fence.** Under separately approved probes, test
   each former writer, role, deployment, workflow, alarm, SQL/CLI and storage
   consumer. Use rollback-only SQL in isolated probe transactions and provider
   non-persisting permission checks where available. Rollback cannot undo Blob
   PUTs or trigger external side effects. If a safe probe cannot establish denial,
   keep BLOCKED and request a separate exact probe; do not implicitly create and
   delete production objects.

Planning allowance: **120 minutes of full application/CMS/API downtime**, paused
publication and delayed job/service processing, including up to 90 minutes for an
already admitted owner-publication job and 30 minutes for verification. This is
an estimate, not measured drain time or a scheduled start. Approval must name UTC
start/end and measured runtime/retry horizons; reschedule or request a new window
if these exceed the allowance. Public pages may be unavailable under the broad
deny; public Blob reads should remain available. Shared revisions also stop
estate/video/FAQ/media editing. Failure may extend downtime under the retained
fence; expiry never automatically restores writers.

Required approval record (every field mandatory; **currently absent**):

```text
action = ACTIVATE-WRITER-FENCE
proposalGeneration = blog-cms-writer-proposal-20261106-01
registerSha256 = hash of the exact reviewed writer-control-register.json bytes
releaseHead / releasePacketSha256 = exact reviewed candidate and packet
target = exact Vercel/GitHub/Cloudflare/Neon/Blob resources above
resourceInventorySha256 / preStateArchiveSha256 = refreshed complete inventories
controlPlanSha256 = exact rule IDs/payloads, identities, grants and denies
probePlanSha256 = exact per-writer non-persisting denial tests
startsAt / expiresAt = explicitly approved UTC timestamps
operator / independentVerifier / approver / approvalReference = named identities
allowedActions = only enumerated controls; no import/migration/deploy/reopen
stopConditions = all conditions below, acknowledged by approver
```

No placeholder or owner assignment is approval. A complete control plan/inventory
must be presented as a newly reviewed artifact; the proposal-only schema cannot
be relabelled active.

**Stop conditions:** unknown writers/holders, altered source/target, expired
evidence/approval, inventory mismatch, unapproved provider change, inadequate
provider deny, admitted writer, uncertain SQL/Blob outcome, queued waiters, drain
timeout or failed proof. Do not begin import/migration. If controls are partially
active, retain them and report the exact state; recovery/reopening requires
separate explicit approval.

## Evidence handoff and enforcement boundary

Retain per-writer target, source deployment/job/role, operator/verifier, actual
pre-state, applied control IDs, denial source, observed counts, timestamps,
generation and archive hashes. Preserve raw private evidence under access
control; the register stores sanitized summaries/hashes. Keep proposed and actual
restoration states distinct so previously disabled consumers stay disabled.

The pure `assessWriterControlRegister` validator always returns
`productionAuthorized: false`. It validates proposal structure/known coverage,
not live completeness or proof. It cannot discover live writers, sign receipts
or issue a capability. Unknown `fence=true` fields, missing/duplicate/unknown
writers, wrong target/resources and missing generation/expiry/pre-state fail.

The existing executor still needs independently authenticated target, approval,
recovery and `production-fence-v1` envelopes. Only the provisioned independent
fence authority may attest a live fence after reviewing the complete proof
archive. Record this register hash and per-writer archive hash in the authority's
approval audit record. The existing signed envelope binds target, release packet,
generation and validity window, **not individual register rows**. This task does
not change that envelope or provision authority. Its checks before mutation and
commit remain mandatory; this offline register is not a substitute.

Keep external controls through fresh backup, import/migration, artifact activation
and public/private acceptance. Table locks protect the transaction only and end
at COMMIT; they cannot cover old instances, privileged SQL or Blob writes.
Application/staff authorization remains useful but is not a sustained fence.

## Request B: REOPEN-WRITERS (separate approval)

Activation never implies reopening. No reopen approval exists. Request only after
backup/restore proof, exact import/migration receipt, approved artifact activation,
public checks and private acceptance pass, and an independent verifier confirms
the same fence generation remains active.

```text
action = REOPEN-WRITERS
activeFenceGeneration / activeFenceReceiptSha256 = verified current fence
registerSha256 / preStateArchiveSha256 = exact activated controls and saved states
releaseHead / deploymentId / releaseReceiptSha256 = accepted candidate/outcome
acceptanceEvidenceSha256 / recoveryEvidenceSha256 = reviewed successful evidence
restorationPlanSha256 = per-resource exact payloads and ordered steps
heldWorkDispositionSha256 = reviewed queue/intent/checkpoint decisions
startsAt / expiresAt = separately approved UTC window
operator / independentVerifier / approver / approvalReference = named identities
allowedActions = only the restoration steps below for registered resources
```

Order: verify accepted deployment/aliases under restricted acceptance access;
restore approved runtime admission; restore saved staff and application ingress
state; recheck acceptance; reconcile held media/jobs individually; restore only
originally enabled workflows, variables, dispatchers, triggers/alarms; prove
retired writers remain denied; release privileged-operator freeze last. No blind
queue replay, bulk deletion, new grants or enabling previously disabled jobs.
Restore actual captured states, not document defaults. Abort on drift, failed
acceptance, stale held work or missing pre-state; keep remaining controls active
and request a new bounded decision.
