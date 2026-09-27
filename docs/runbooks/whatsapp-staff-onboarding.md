# WhatsApp staff onboarding and Haze handoff

Status: local code verified; tenant handoff pending an approved isolated target and named recipient. Use this runbook for each colleague and capability. A display name alone is not an Inbox identity or a phone destination.

## Before the browser journey

1. Confirm the isolated app URL, synthetic tenant and synthetic conversation. Prepare a private fixture manifest outside Git with `synthetic: true`, `targetKind: "isolated-staging"` (or `"isolated-local"`), same-origin `url` and `staleUrl`, distinct notification IDs, and authenticated Playwright `agentAState`, `agentBState` and `viewerState` paths. The manifest must not contain a production staff UUID or raw customer content.
2. Confirm Haze's local staff ID, role, email, branch and active state. Record the company's configured Channel. In **WhatsApp 同事映射**, select the exact Inbox account and named Folder; compare provider integration scope and fresh provider readback. Record mapping version and review evidence reference. Do not infer provider identity from a name.
3. Choose each requested capability independently: assignment, Inbox private note, or staff WhatsApp. For staff WhatsApp, obtain the explicitly approved test recipient, masked destination, endpoint version and permission reference. Confirm the test conversation is independent of customer conversations.
4. Preview each action before submission. The test text is: **「[測試] 晉誠地產同事接收驗證，請回覆確認。」** No customer data belongs in this message. A preview, page open, mapping save or coverage read must not enqueue a send.

## Local and staging checks

- Run `npm run test:staff-notifications` and `npm run test:woztell`. These prove deterministic code behavior, not tenant routing.
- Run `node --test scripts/staff-handoff-fixture.test.mjs` to check preflight denial cases.
- With the approved isolated target and private manifest, run `npm run test:staff-notifications:e2e`. The wrapper rejects missing prerequisites, a non-synthetic manifest, missing storage states and cross-origin fixture URLs. Record environment and individual Playwright cases; an exit code alone is insufficient.
- Verify an unmapped Haze record is blocked; a verified account and Folder can reach preview; an incorrect Folder is blocked. For the synthetic conversation, compare the provider assignment readback with that same conversation ID, Channel, Folder and staff identity. Provider request acceptance is not assignment confirmation.
- If an explicit test send is authorized for the named recipient, submit one request ID. Record private-note result, staff WhatsApp provider acceptance, signed delivery receipt if present, Haze's actual recipient confirmation and acknowledgement separately. Unknown provider state requires status lookup with the same request ID; do not auto-resend.

## Evidence record

Keep a sanitized record per capability with `{environment, staffId, mappingVersion, endpointVersion, testedAt, result, evidenceRef}`. Mask destination and omit JWTs, provider payloads, raw recipients and customer content from Git. Use `docs/reports/haze-routing-acceptance.md` for the summary. Mark a missing fact `unknown` or `external-blocked`; never infer success from another capability.

When finished, disable any test tracking link through the existing versioned action and retain the audit trail. Do not delete a transaction, test attempt, receipt or mapping review to make the record look clean. Provider setup, live sends, migration and deployment need their own explicit authorization.
