# Admin UX implementation baseline — 2026-10-13 HKT

Source and freshly read remote main: `433ab194f9e51c789d89d49216fe2983f2791616`.
Isolated branch: `codex/admin-ux-20261013`. The original checkout at `72469433409a0839fd3ed5868304bac1bd2b5c2c` has existing tracked/untracked work; it was not reset, cleaned or used for implementation.

The current main's CLAUDE.md and the user's AGENTS.md graph-discovery instructions were read. There is no repository AGENTS.md in this checkout. The code graph is `earnest-admin-ux-20261013`. Current authentication uses an opaque Neon session token, not the historical JWT wording in the old checkout. This is a presentation change to the existing TanStack Start admin, with no server/schema/config changes planned.

## Input integrity

Implementation ZIP SHA256: `fe18f3103a8967d83c644addd8297b6bf41d8d743c0b09450e67a5b4695666b8`.

The user supplied the extracted original audit's location during execution. Its same-parent `EarnestProperty_Admin_Audit_2026-10-02_zhHK.zip` has the required SHA256 `ffcfe4160a23080caee6b0bf7ca126df298cf29a3ae60bd14394486ba6acb2d2`. The initial missing-archive blocker is resolved. The historical archive is retained separately; private evidence and customer/source reports are not copied into the PR.

The supplied new pack's 50 UAT rows, 25 route templates and 10 tasks are preserved verbatim under `input/`. Execution copies retain the initial definitions. The planned denominators are 100 admin normal viewport instances and 100 role-route combinations; neither is a passed count.

Original CSV counts independently parsed: 68 BUSINESS_ACTION and 1,332 SOURCE_CONTROL_CANDIDATE; 60 REQUIRED_SCENARIO, 68 BUSINESS_ACTION_ACCEPTANCE and 1,332 SOURCE_CANDIDATE_ACCEPTANCE. Historical 29 PASS / 9 FAIL / 22 BLOCKED belongs to the 2026-10-02 audit and is unchanged.

## Before-change tests

| Command | Result at baseline SHA | Layer | Evidence |
|---|---|---|---|
| `node --test src/components/admin/admin-nav-roles.test.mjs src/test-wiring.test.mjs` | 14 pass, 0 fail, 0 skip | Source guard parity / wiring | `.audit/admin-ux-20261013/baseline-nav-wiring.log` |
| `npm run test:admin-daily-work:ui` | 174 pass, 0 fail | Actual route components, synthetic Auth/API, owned loopback Chromium | `.audit/admin-ux-20261013/baseline-daily-work.log` |

Dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund` against the committed lockfile. Existing dependency deprecation warnings are retained in the install log.

## Preserved boundaries and history

The 17 navigation destinations already have role/first-read parity tests. Agent retains six destinations and viewer only operations. Manager's team read is not `staff.manage`; writes continue through existing capability, actor, resource and revision guards. The eight editor routes retain their module's existing server access and submission handlers.

The current repository's EP-12–20 reports and master reconciliation describe implemented scope/identity, dirty draft, CAS, receipt, unknown-send and recovery controls. Their historical successes are not rerun results. The following legacy IDs remain open to their original acceptance requirements:

| Legacy scope | Current source/report evidence | This task's boundary |
|---|---|---|
| F01 / RPK-01 | Canonical eligibility and durable knowledge repair implemented | Preserve; no AI indexing rewrite or paid run |
| F02 / RPK-03 | Receipt, assignment and handoff controls implemented | Normal Auth/provider acceptance remains separate |
| F03–05 / RPK-02 | Eligibility, truthful result and stale apply controls implemented | Preserve method/source and draft-only behavior |
| F06 / RPK-04 | Later source/native readback reports exist | External completeness and native schedule acceptance not reassessed by UI work |
| F07 / RPK-05 | Picker, wizard and StaffNotificationPanel exist | Preserve business names, verification and capability boundaries |
| F08 / RPK-06 | Bounded conversation query implemented | No SQL rewrite for this UI package |
| RPK-07 / UC01–20 | Owned UI/SQL/golden-journey evidence exists | No automatic closure from navigation/layout changes |

## Unverified external scope

No authorized authenticated HKWTIA reference session was supplied. Direct read attempts of both public admin URLs through the web tool were inaccessible in this run. Therefore the implementation follows the supplied explicit sidebar proposal; no one-to-one reference comparison is claimed. Production app/worker/schema versions, actual feature flags and normal Auth/provider capability are unknown for this run.

Normal Auth → server function → disposable DB → isolated provider journeys require their own target/session evidence. Native mobile IME/keyboard and human role UAT remain separate. No production DB/config mutation, customer send, paid model, merge or deployment is authorized by this implementation request.
