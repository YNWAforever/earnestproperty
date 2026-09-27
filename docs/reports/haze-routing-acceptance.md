# Haze routing acceptance — 2026-09-27

**Overall:** external-blocked for real tenant assignment and delivery. The isolated worktree has no configured `PLAYWRIGHT_BASE_URL`, `STAFF_HANDOFF_BROWSER_FIXTURE`, company Channel; no provider configuration was supplied for this run. No staff recipient, verified Inbox identity/Folder or separate test conversation was supplied. No provider request or production mutation was made.

| Capability | Environment | Staff ID | Mapping version | Endpoint version | Tested at | Result | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inbox account and Folder review | Local synthetic tests | Not supplied | Not available | N/A | 2026-09-27 | Local contract passed; tenant readback blocked | `test:staff-notifications`, 21 Node + 13 Bun pass |
| Assignment readback for Haze | No approved isolated target | Not supplied | Unknown | N/A | Not run | External-blocked; request acceptance is not readback | Pending exact test conversation |
| Inbox private note | No approved isolated target | Not supplied | Unknown | Unknown | Not run | External-blocked | Pending scoped provider test and receipt |
| Staff WhatsApp provider acceptance | No approved isolated target or approved recipient | Not supplied | Unknown | Unknown | Not run | External-blocked | Pending named masked destination and one request ID |
| Signed delivery receipt | No provider attempt | Not supplied | Unknown | Unknown | Not run | Unknown | Pending receipt tied to attempt |
| Haze recipient confirmation | No recipient test | Not supplied | Unknown | Unknown | Not run | Unknown | Pending colleague confirmation |
| Browser prepared-state journeys | No staging URL/fixture | Not supplied | Unknown | Unknown | Not run | External-blocked before browser launch | `test:staff-notifications:e2e` reported missing `PLAYWRIGHT_BASE_URL` |

## Local evidence and limits

- `node --test scripts/staff-handoff-fixture.test.mjs`: 1 pass; rejects non-synthetic, cross-origin, blank state paths and duplicate notification identities.
- `npm run test:staff-notifications`: 21 Node and 13 Bun pass. These cover versioned mapping review, readiness, separate transport states, test preview and receipt isolation.
- `npm run test:staff-notifications:e2e`: intentionally stopped at the missing `PLAYWRIGHT_BASE_URL` gate. The browser and provider were not invoked.
- The existing prepared-state browser spec checks authenticated takeover isolation, refresh, stale work and viewer denial once an approved fixture exists. It does not by itself prove real provider assignment, delivery or customer reply.

The acceptance card in `docs/runbooks/whatsapp-staff-onboarding.md` lists the missing inputs and the evidence chain for a later approved isolated run. R01's production portion stays open. No fixture success is reported as real Haze delivery.
