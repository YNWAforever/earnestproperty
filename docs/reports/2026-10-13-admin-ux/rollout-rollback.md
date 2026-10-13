# Admin UX rollout / rollback

Release state: HOLD for normal-session, hosted and human acceptance. This branch is a review candidate, not a production acceptance certificate.

## Version and review batches

Base main: `433ab194f9e51c789d89d49216fe2983f2791616` (remote main rechecked unchanged during T-UX09).

- A: `5485528e` navigation and `59043559` shared header/width contract.
- B: `a8e2c77a`, `9ce972e7`, `826bd69f`, `86184c11` migrate all 25 route templates in daily lists, editors, inbox and management/settings groups.
- C: `2a23c48e` actual-route geometry/error/interaction coverage plus reproduced UI fixes; `bb13af29` layered role/workflow evidence. T-UX09 final review fixes and evidence follow in separate commits.

No backend ACL/capability, staff identity, CAS, SQL migration, provider dispatch or receipt/reconciliation algorithm changed. UI service-health visibility follows its existing admin/manager reader. All remaining operations actions still use server-returned capabilities. The only new persistent preference is `earnest:admin-nav-collapsed`; it contains a boolean, no identity or customer data.

## Before any release

1. Review code and the 50-case/25-route/100-role-pair trackers. Preserve historical F01–08, RPK01–07 and UC01–20 independently.
2. Bind the proposed preview to its exact source commit and check app/worker/schema/flags. A successful local build or READY preview does not prove those versions agree.
3. Supply an isolated full app with normal admin/manager/agent/viewer staff sessions, authorized records in at least two branches, disposable database and isolated provider stub. Exercise the blocked normal Auth→server→DB flows and direct API denials with independent readbacks. UI fixtures and mocked staff SQL harnesses cannot replace this.
4. Admin and agent review all relevant pages at 390/768/1280/1440, the collapsed sidebar, draft/dirty navigation, timeout/reconciliation, and real mobile IME/keyboard. Capture actual outcomes and cleanup. No authenticated HKWTIA view was supplied; the implementation follows the explicit proposal, without a one-to-one visual claim.
5. If a provider canary is later required, obtain the named test recipient, channel, operation type/count and environment authorization first. Retain the original intent for unknown outcomes and reconcile read-only; do not blind retry.
6. Only after a specific release authorization, use the existing deployment mechanism, then verify the actual runtime source and normal admin/agent journeys. Do not change production DB/config as part of this UI rollout.

## Rollback

This UI change requires no migration or production flag. Record the currently authorized deployment ID before release. If layout/navigation blocks work, restore that authorized deployment through the existing platform rollback procedure, or revert the UI commits in a separately reviewed branch and deploy only with authorization. Keep later backend security/identity/receipt fixes; never roll back to a known vulnerable backend to undo UI spacing.

A stored collapse preference can remain after rollback and must not be used as an auth decision. No business record cleanup is required by this branch. Remove only explicitly owned test data/containers after independent readback; preserve receipts, unknown intents and audit history. All local owned test containers in this run were already stopped and removed by their harnesses.

## Preserved limitations

The 50 cases are partial and the 100 normal-Auth role-route reads are blocked. Native mobile IME, human UAT, authenticated HKWTIA comparison and deployed app/worker/schema/flag parity are unverified. Agent access to CMS own drafts/resource editors is an existing backend policy distinct from admin/manager-only directory navigation; this branch records that difference without changing it. No real recipient send, paid model, merge or production deployment occurred.

Final client fix: `bd044145d324fcdf5c748df1425c621db7cdc6fb` retires 12 route workspaces on verified staff changes and revalidates agent editor capability. Server membership resolution, permissions, DB schema, CAS and provider/receipt algorithms are unchanged. Agent editor opening adds a capability GET after loader preflight. Roll back client commits as a reviewed unit; retain server security fixes. Exact validation and immutable capture references are in final-verification.md.
