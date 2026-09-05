# Task 6 intake implementation and remaining product gate

Implemented locally:
- Public client keeps an opaque pending submission UUID across response loss/reload (only payload digest and ID stored; no contact text in storage).
- Atomic submission claim/contact/lead/inquiry write links inquiry to its lead. Duplicate requests use a fresh read of the original, reject changed payload and expire replay after72hours without reusing the identity.
- Existing contact identity/marketing flags are preserved on public duplicate-phone submissions. Inquiry stores checkbox request plus server copy version and existing creation time.
- Inbound WhatsApp no longer grants marketing opt-in (Task5 shared ingestion).
- New admin/manager-only marketing opt-in/out dialog requires a confirmation source and bounded internal evidence reference. Runtime SQL rechecks active staff role and commits contact flags, consent evidence and privacy-bounded audit together.
- Disposable database race fixture prepared and gated behind TEST_DATABASE_URL and CRM_TEST_DATABASE_CONFIRMED=true.

Verification: before idempotency implementation 3 failing regressions; afterward inquiry suite13/13 and browser identity helpers2/2 pass. Staff consent tests2/2. DB race skipped without explicit test target. Integrated typecheck passed after shared declaration update; final build/full suite/review pending.

Not complete: WhatsApp-to-lead trigger and inquiry-status versus sales-stage lifecycle require the user's policy choice. No automatic lead creation or sales-stage remapping has been added. Public affirmative-consent policy is also pending; existing new-contact checkbox semantics retained meanwhile. Existing customers must use the new staff confirmation workflow to change marketing opt-in. No production migration/data/settings/send was performed.

## Review follow-up: legacy opt-out reset bypass

- Reproduced the bypass before editing: consent/WozTell regressions reported 39 passes and 2 failures for the missing legacy fail-closed guard and retained reset UI.
- The old `clearContactWhatsappOptOut` server function now delegates only to a deny guard. Admin/manager receive HTTP409 `CONSENT_EVIDENCE_REQUIRED` with guidance to the consent workflow; agents/viewers/no-role callers receive403. It performs no contact mutation or audit write and cannot re-enable a retained `opt_in_whatsapp=true` flag. The legacy client/server-function shape remains solely so stale callers fail closed with guidance.
- Removed the inbox's old reason-only state, handler, confirmation dialog and reset button. Desktop/mobile conversation panes now use `WhatsappConsentDialog` directly, retaining the server-derived management-role visibility and refreshing detail after a successful evidence-based update. The duplicate bottom-of-page dialog was removed.
- Affirmative consent remains explicit through the existing `setWhatsappMarketingConsent` service: selected customer intent, allowed affirmative source, bounded internal evidence reference, atomic flag/evidence/audit persistence and active server-side role checks. A free-text reason, missing reference or opt-out evidence cannot manufacture opt-in.
- Verification: focused regressions41/41 pass; combined consent/WozTell/admin-route tests **79/79 pass**; **typecheck passed (exit0)**; focused ESLint for the consent service and WhatsApp page **passed (exit0)**. Added role-denial and missing/invalid-evidence tests with zero mutation calls. No database, migration, provider, campaign, CMS or upload work was performed in this follow-up.

Final copy clarification: contact form now explicitly says repeat submissions preserve existing marketing settings pending staff confirmation. Existing contact tests passed. See astra-execution-progress.md for integrated verification and unresolved acceptance.
