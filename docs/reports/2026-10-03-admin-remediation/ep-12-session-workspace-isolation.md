# EP-12 staff workspace and asynchronous action isolation

Master plan EP-00–21 was reconciled against the existing task CSV and evidence, including already completed owned restore/replay. The independent next local gap was EP-12 step4. Original audit SHA/main51cb0e9c08269ebabeb0b593d4dea611b9246c32; slice baseline110a8cee8a9ce0260474619121aedf006fe8fdc4. Initial scope fix4f91ec44e7b3f7a82c8d12bab21934c0ffdad414; final source3c14cd06a9584363a6c02101f506faac813f3cd9.

Same-user role downgrade or staff rebinding now replaces the Leads workspace using the existing user/staff/sorted-role identity. Unknown staff verification hides private children, header actions and navigation, offers retry and does not mount Leads reads. Same identity rechecks retain selection and unsent work. Existing actor-keyed forwarded journals remain isolated and restore without submitting. No DTO, provider Auth, runtime IDs, server ACL, package, workflow, config or migration change.

One fresh Astra whole-branch review reported0Critical/1Important/0Minor. It inspected all five focused diffs and11 additional changed source samples (16/210 cumulative paths), plus four unchanged supporting files. Its independent extracted actual saveLead probe confirmed an old actor's delayed note could resume a lead update using the new actor's current credential. The single author fix pass invalidates workspace lifetime synchronously on cleanup and checks generation/live staff fingerprint after awaits before follow-on writes, reads and global toasts. An already accepted note is preserved; it is not replayed. No second review. Continuous authorization during credential acquisition/transport after a point-in-time gate is not proven.

| Evidence layer | Actual result | Limit |
|---|---|---|
| Initial scope RED | corrected6FAIL; initial4PASS/2FAIL masked four cases | Stable same-user Auth fixture corrected before source fix |
| Review R1 RED |5FAIL/1 same-context positive PASS | actual route/store/Toaster, delayed synthetic note |
| Exact final UI |92PASS/0FAIL/0SKIP;23 each1440/1280/768/390 | synthetic Auth/API; actual shell/Leads/store; actor, role, binding, A-B-A, delayed-error, positive save |
| Shared UI regression |115PASS/0FAIL/0SKIP | actual routes, synthetic ports |
| Independent owned SQL |4PASS/0FAIL/0SKIP; PostgreSQL17/full85 migrations | scoped list/count readback, separate from UI |
| Command center/team |Node82+Bun8; Node95+Bun31 | existing named scripts; note extraction fixture adds same-context current port |
| Static |exact typecheck PASS, lint PASS, build PASS separately | three existing lint warnings; own generated output restored only after normalized equality |
| Visual |12 stable screenshots; four dialog bounding boxes PASS | restored draft assertion uses accessible textbox, animation settled; real IME/device unproven |
| Formal read-only |homepage/admin HTTP200 | availability only; no authenticated journey or deployed SHA proof |

RED runner logs establish full failed totals; the failed-run JSON summaries contain only partially recorded cases and are not full-run totals. Raw logs and SHA256 are appended under `adminSessionBoundaryFollowup` in [execution-evidence.json](execution-evidence.json). Prior328 selected raw hashes,65 tracked reports and old JSON deep values remain unchanged. Original29PASS/9FAIL/22BLOCKED,22 planned NEW cases,82 execution rows (40PASS/28PARTIAL/14BLOCKED),1400 IDs and408 historical rendered observations are preserved. Only EP-12/NEW-12/TEST-05/TEST-48 execution evidence/environment/SHA fields append this result; statuses remain PARTIAL. True Auth acceptance gates remain blocked; TEST-03 retains PARTIAL and TEST-04 retains BLOCKED. Ordinary portal zeroEPWA, parser/receipt/CAS/draft/Inbox/links/source identities/protected edits/history remain outside this surgical source change.

## Root rulings on every reviewer declined item

- D1 NOT_READY: Only 16 enumerated changed paths plus four supporting files inspected; no exhaustive cumulative audit. Cost if wrong: Undetected cumulative regression.
- D2 BLOCKED: Synthetic stable Auth/store does not establish actual provider expiry/logout/revocation/deep links/cross tabs. Cost if wrong: False formal authorization.
- D3 NOT_READY: Current staff DTO has user/staff/roles; no branch-only identity evidence or exhaustive route-role-flag matrix. Cost if wrong: Cross-scope private presentation.
- D4 NOT_READY: Leads lifetime is fixed; other parent route asynchronous work has not been audited exhaustively. Cost if wrong: Stale mutation on another route.
- D5 BLOCKED: Owned SQL and synthetic browser are separate layers, not one combined authenticated journey. Cost if wrong: False integrated Golden proof.
- D6 BLOCKED: No provider receipt, live destination or send exercise; accepted existing intents/history retained. Cost if wrong: Wrong recipient or duplicate send.
- D7 BLOCKED: No paid application-model calls or semantic-quality/budget acceptance. Cost if wrong: False quality or spend claim.
- D8 BLOCKED: No production migration/deploy/runtime/flags/SHA/load acceptance; compatible UI-only rollback described. Cost if wrong: Unsafe formal rollout.
- D9 BLOCKED: Property.hk requires authorised EPS/EPT/EPW/dt page1-terminal plus real detail/media; partial/403/index-only is not absence;132 held. Cost if wrong: False withdrawal.
- D10 NOT_READY: Baseline1/3, repaired0/3, agent-triggered0. Natural success37160712576 lacks independently read complete private receipt. Cost if wrong: Fabricated schedule acceptance.
- D11 NOT_READY: 1400 mappings and408 old observations unchanged; selected Chromium viewports do not prove all actions, native IME/clipboard/devices/concurrency. Cost if wrong: Missing action/device/race defect.
- D12 BLOCKED / NOT_READY: Owned full85/GoldenABC23/clone restore/replay already passed; production restore/canary blocked and terminal corrupt/missing journals unproven. Cost if wrong: Unsafe restore or unresolved unknown.
- D13 AUTHOR_VERIFIED_SELECTED_ONLY: Author fresh selected browser92/shared115/SQL4/unit/static; reviewer only diff check and inert extracted handler probe, no suite rerun. Cost if wrong: False independent verification attribution.

## Rollback and capability

Compatible UI-only rollback of the two source commits must retain server ACL/read gates and existing actor draft journals; limit affected private lead presentation before reverting the privacy fix. Do not restore the database or replay accepted notes/intents. No new migration; latest existing migration20261003040000_content_proposal_source_guard.sql,85 total. Config/schema/package/workflow/provider DTO diff is empty, with owned dry-run/readback above.

READY: selected local scope/lifetime/readback contracts. NOT_READY: full EP-12, all routes/roles/actions, branch-only identity and repaired native28Hse acceptance0/3 (baseline1/3, agent-triggered0). BLOCKED: true Auth/provider/model/Property.hk full detail-media scopes, production app/worker/schema alignment, release/migration/restore. 403/partial/index-only cannot authorize withdrawal;132 historical candidates remain held. No merge, manual deployment, production write/migration, provider send or paid application-model call.
