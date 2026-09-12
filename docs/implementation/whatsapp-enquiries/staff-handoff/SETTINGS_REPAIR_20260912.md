# WhatsApp settings diagnosis and requested test case

## Verified production state

Inspected on 2026-09-12. Source HEAD: `e5c80d72fa5b112dad729a916f62e294bb5e6fa7`, branch `codex/staff-reference-handoff`. Existing `bun.lockb` change preserved.

Neon project `dawn-meadow-79190048`, production branch `br-polished-sea-aom4i1ct`, database `neondb`: `to_regclass('public.whatsapp_service_policies')` and `to_regclass('public.staff_notification_intents')` both return null. Latest recorded migration is `20260909120000_source_promotion_tiers.sql`; the six 20260912 migrations are not recorded.

The policy list server function queries `whatsapp_service_policies`. Its editor catches any rejection and displays the reported generic permissions/migrations message. Missing schema is confirmed; changing roles or pretending an empty successful response would not repair it.

## Concrete repair awaiting production migration permission

For the policy editor, apply the existing migrations in this order:

1. `neon/migrations/20260912120000_whatsapp_enquiry_events.sql` — observation event ledger. SHA256: `827CD685BFF212A0921E6E3512932D408F720DDEDF0FC2107762756E88F60250`.
2. `neon/migrations/20260912130000_whatsapp_enquiry_episodes.sql` — policy table and its prerequisites, attribution tables, additive inquiry columns and immutable evidence triggers. SHA256: `DC0ECCFD684B00BBDFF14B6F5658E81D32144AC7FA29519F7CCC540D9D0D9558`.

Both files were read in full. Scope includes relaxing inquiry name nullability only for WhatsApp via a replacement check constraint; other inquiry sources still require names. No policy approval, active generation, historical replay or provider message is seeded. Record exact filenames in `app_migrations` only after successful application. Use an explicit production target, bounded locks and a transaction containing these two reviewed files and their receipts. Do not invoke the unfiltered all-pending runner: it would also apply the other four pending migrations outside this repair scope.

After authorization/application: verify both receipts, read policies using the existing server function under authenticated admin access, and verify the browser editor loads. An empty policy list is expected until the operator saves a draft; business policy values and approval must come from the operator. Remaining assignment/service/staff-notification migrations 140000–170000 are a separate release scope. Do not enable their flags or infer full workflow readiness from this policy repair.

Rollback: retain additive tables and evidence. Do not drop tables or undo immutable history. No policy activation occurs in this repair; investigate a failed transaction before retrying. No production migration, deployment, policy approval or external message was performed during this diagnostic task.

## Requested test case created and verified

Case label: `[內部測試] A065407 售盤指派驗證` / `EP-TEST-A065407-20260912`.

- Inquiry: `c9be6a07-2516-4d57-8a76-a8aee0056407`.
- CRM lead: `189a655a-d00a-48f9-b3a1-f039be86331a`.
- Property: `0cf2d3bd-32d9-4485-a5f7-ca6f09fe3cb6`, canonical number `A065407`, active sale listing.
- Assignee: active staff `72285986-c82c-46bd-98d9-c6b021d91b0d`, `willylai@fimmick.com` (admin).

Created atomically with linked contact, lead, inquiry and audit entry under the user's explicit request. Source is `manual_test`, contact tagged `internal-test`, no phone/email/normalized phone, WhatsApp opt-in false and opt-out true. Readback confirms contact and lead assignment agree with the inquiry. Actor audit is not attributed to Willy: he is the recipient, not the authenticated executor. No WhatsApp transcript, live-webhook evidence, assignment confirmation or customer identity was fabricated. This is a CRM assignment test, not a successful end-to-end WhatsApp/provider test. It remains visible as a clearly labelled test record; do not interpret it as customer demand.

## Actual verification

Executed from this worktree:

```powershell
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/episodes.db.test.mjs src/lib/whatsapp-enquiries/service-workflow.db.test.mjs
```

Result: 26 passed, 0 failed, 0 skipped, exit 0. The designated `br-quiet-hat-aoxbj2ue` database was used with per-run isolated schemas and synthetic data. Includes real policy listing/approval queries, immutable policy/attribution checks, episode deduplication and disabled-service behavior. External adapters are fixtures; this does not prove live provider delivery or production migration compatibility under load.

Browser verification is blocked: the computer-use runtime failed to initialize with a Windows sandbox ACL error. Production policy loading cannot be claimed fixed until migration approval/application and authenticated verification. A real WhatsApp test additionally needs an approved test sender and verified provider configuration; no messages were sent.

## Production repair completed after explicit approval

2026-09-12 18:26 HKT: Applied only the checksum-verified 20260912120000 and 20260912130000 migrations to production br-polished-sea-aom4i1ct / neondb in one transaction including both receipts, an advisory transaction lock, 5-second lock timeout and 60-second statement timeout. Both receipts show 2026-09-12T10:26:57.624Z. Earlier pending/no-migration statements above are historical.

Post-commit policy list SQL succeeds with an empty result: no policy was seeded or approved. The A065407 sale test inquiry still resolves to willylai@fimmick.com with service_state=unmeasured and effects_eligible=false. No external messages, deployment or activation changes. Other pending migrations remain unapplied.

Operator verification: reload /admin/whatsapp-settings and confirm the generic load error disappears. Save intended settings as a new draft and reload to verify persistence. Use only the explicitly non-sending simulator for hypothetical checks. Do not approve a policy merely to test. Search /admin/leads for the internal A065407 test case and verify the assignee. Authenticated browser verification remains outstanding due to the browser runtime ACL failure. Real WhatsApp intake/delivery is not verified by this CRM case.

## Follow-up: complete settings dependency audit

The new exact error is emitted by src/routes/admin.whatsapp-settings.tsx when Promise.all of getWhatsappStaffChannels and fetchAdminAgents rejects. The staff channel server API queries whatsapp_staff_channels, confirmed absent in production. Auth headers and admin/manager authorization are present. The existing policy table is present. Staff references, notification endpoints, routing exceptions, notification intents and service activation tables are also absent. Thus the earlier two-migration repair addressed policy loading only.

Reviewed remaining release scope in order:
- 20260912140000_whatsapp_assignment_evidence.sql — mapping, assignment requests and response evidence. SHA256 29CA60E27E11DEC31F8D7A0ADAB7F4D6EA9DBA757954CD7D17EFB16AB5E5185E.
- 20260912150000_whatsapp_service_workflow.sql — activation/service prerequisites for notifications and service health. SHA256 729AC7726C02AAAEDAA4BECB730AA623C8BD217E1EF219B334030CBF13632A72.
- 20260912160000_staff_reference_snapshots.sql — staff reference editor. SHA256 0F66771E700267F4CE40C90AC8D5F42689A2CF1DBDEC841B189FB0D2444E8890.
- 20260912170000_staff_notifications.sql — endpoint/review/attention/notification health editors. SHA256 9B115B94D2DE31E6A4764197D629EAF162FF1BA2508666E488276D1A6A3A9DAF.

Material behavior: 140000 installs an ownership trigger that records conversation assignment changes as pending provider requests and retains the existing local assignee until confirmation. This does not backfill or send messages, but changes future conversation ownership writes. 150000 adds explicit active-generation support and worker capability guards; no approved policy or generation is seeded. 160000 preserves immutable staff identity evidence. 170000 adds notification capture and readiness triggers gated by event eligibility and active generation. Do not seed mappings or change activation/environment flags merely to clear the UI. Retain all evidence tables on rollback; no destructive down-migration.

Verification command:
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/assignment.db.test.mjs src/lib/whatsapp-enquiries/service-workflow.db.test.mjs src/lib/whatsapp-enquiries/staff-reference.db.test.mjs src/lib/whatsapp-enquiries/staff-notifications.db.test.mjs

Initial result: 45 passed, 4 failed (three assertions plus their parent test). Root cause: assignment fixtures A/B lacked the staff roles required by the current dispatch guard. Fixed only the fixture and added a roleless mapped-staff rejection case; production authorization unchanged. Rerun: 50 passed, 0 failed, 0 skipped, exit 0. Tests use synthetic isolated schemas on the previously approved disposable branch. The fixture change is uncommitted; bun.lockb remains untouched.

The four additional production migrations remain pending explicit approval because the prior approval named only 120000 and 130000. Proposed execution: one bounded transaction on br-polished-sea-aom4i1ct/neondb, exact files plus receipts, then verify all settings loader tables/queries and confirm no activated policies/generations/endpoints. Authenticated browser verification remains outstanding. No additional production writes performed in this follow-up.

## Remaining four production migrations completed after explicit approval

2026-09-12 18:52 HKT: user explicitly approved all four remaining migrations. Applied the previously reviewed checksum-verified 140000, 150000, 160000 and 170000 files in one transaction on br-polished-sea-aom4i1ct / neondb, including all four receipts. Advisory transaction lock and 5-second lock / 60-second statement timeouts were used. All four receipts show 2026-09-12T10:52:12.470Z; all six 20260912 migrations are now recorded.

Post-commit read-only verification: mapping list, policy list, endpoint list, routing/help attention union and internal-event review queries succeed. Staff-reference table is present and empty. Active generations, enabled endpoints, approved policies, notification intents and notification attempts are all zero. The original A065407 internal case remains assigned to willylai@fimmick.com with effects_eligible=false. No settings records, provider identities, activated policies or messages were seeded. No deployment or environment change was made. Earlier pending-approval statements above are historical.

Authenticated browser rendering remains unverified because of the previously recorded local browser runtime blocker. Operator should hard-refresh the settings page and confirm the mapping, reference, endpoint and policy panels load; empty histories are expected before verified setup data is entered.

## Verified live Inbox mapping using user-authorized temporary access

2026-09-12: Temporary access token successfully authenticated to WOZTELL Open API. It was used only for read queries; it was not written into repository files, reports or deployment variables. Returned signatures were held only inside a short-lived process and were not logged or saved.

Verified app 6927eb27008d048e6586627e, Inbox integration 6927eb27008d048e65866280, and Earnest Property channel 6a740a3869244a10a91325c1. Channel matches the existing production CRM channel. Open API team identity and channel+folder+user filtered Inbox list-users both identify willylai@fimmick.com as user 69280afe1bbc4961899a4ce8, with Inbox MANAGER role and access to main. Pagination showed no further filtered result. No customer contents retained. Default environment mSP2hTUzup has no configured trees or routing nodes.

Saved mapping ec2f3102-719a-428c-835e-3d6016a79655 with folder main, blank routing_node_id (not fabricated), null branch, eligible=false, verification reference WOZTELL-READONLY-20260912-WILLY-MAIN. Audit records the API evidence and assisted executor; no false staff verifier identity was assigned. Production readback confirms exact values. No provider write, message, policy approval or active generation was performed.

Found a real configuration mismatch: direct Inbox adapter uses memberId/userId and folder readback, but mapping validation and HTML required an unused chatbot node. Added regression, observed failure on routingNodeId too_small, then removed only that min-length and HTML-required constraint. Blank folder still rejects and eligible stays false. Focused assignment/provider tests: 11 passed, 0 failed, 0 skipped. Local source correction still requires publication permission; it is not deployed.

Prepared server configuration (not yet installed):
- WOZTELL_APP_ID=6927eb27008d048e6586627e
- EP_WA_COMPANY_CHANNEL_ID=6a740a3869244a10a91325c1
- EP_WA_INBOX_INTEGRATION_ID=6927eb27008d048e65866280
- EP_WA_INBOX_VERIFICATION_REF=WOZTELL-READONLY-20260912-WILLY-MAIN (read scope only, not delivery certification)
- EP_WA_INBOX_SIGNATURE: retrieve privately from verified installed Inbox integration during authorized configuration; never use the temporary Open API token as this signature.
- EP_WA_INBOX_LIST_USERS_URL=https://api.inbox.woztell.sanuker.com/v1.0/api/list-users (live GET verified)
- EP_WA_INBOX_LIST_THREADS_URL=https://api.inbox.woztell.sanuker.com/v1.0/api/list-threads (live GET verified)
- EP_WA_INBOX_ASSIGN_URL=https://api.inbox.woztell.sanuker.com/v1.0/update-thread-agent (official documented path only; no live write test)
- EP_WA_INBOX_INTERNAL_MESSAGE_URL=https://api.inbox.woztell.sanuker.com/v1.0/internal-message (official documented path only; no live send test)

Official contract: https://support.woztell.com/portal/en/kb/articles/public-a . Do not infer delivery readiness from successful read APIs. Keep routing, service, staff alerts and reminders disabled until an authorized live pilot, approved business policy and test sender exist. Do not enable a private-note endpoint without verifying customer isolation. Other staff mappings require exact account evidence, not inferred name/phone matches. Production environment installation/deployment are not performed in this step.

## Tracked test link redirect repaired

2026-09-12: User reported /w/U4XbCVRP5hGBAKvBAoQcKmw_jsMKSbW0 did not open WhatsApp. Reproduced HTTP 302 Location /contact. Registered version 1 was enabled, linked to A065407 sale and Willy; deployment lacked EP_WA_COMPANY_PHONE and EP_WA_TRACKED_LINKS_ENABLED. Configured production phone 85297987774 using the existing public /contact WhatsApp destination and enabled tracked navigation only. Redeployed approved commit 98cafb056434475d29c9265d237c60fa4e5e2b1d as dpl_E6qfaZuz9Xc6B2xLS8857wdGgaDB, now READY with earnestproperty.vercel.app alias.

Post-deployment GET without following redirect: HTTP 302, destination wa.me/85297987774, decoded prefilled text includes A065407 and an EPWA reference, Cache-Control private/no-store. The verification created link-open evidence only; no WhatsApp message was sent. Three existing redirect tests passed. Automatic routing and service automation were not activated. Real incoming-message processing and Willy handoff remain separate live tests.

## Production observe-only activation (2026-09-12)

Operator approved enabling observation without sending messages. Production EP_WA_ENQUIRY_MODE was set to observe. Redeployment dpl_4n4RukRavQm85nQnrNN6DmAEJNvW is READY and owns earnestproperty.vercel.app, using the existing reviewed source.

Routing, service automation, staff notifications, staff WhatsApp alerts, escalation and activation were not enabled. No production migrations, provider writes or messages were performed for this activation.

Verification limitation: the attempted bounded service-worker check stopped before making its HTTP request because CRON_SECRET was unavailable to the Vercel env-run process. The deployed Cloudflare worker predates the new service-worker schedule; automatic observation processing is not yet verified. No schedules were changed. A fresh user-sent test message and worker processing verification are still required; the prior message captured while mode was off must not be represented as a new live event.

Rollback: set EP_WA_ENQUIRY_MODE=off and redeploy the same reviewed production source. Retain captured evidence and schema.

## Live observation verified (2026-09-12 12:00 UTC)

Correction to the earlier pending-worker assessment: the existing five-minute control-plane cron is operational and processes v1 observe events. Live Cloudflare tail captured POST /api/admin/control-plane/worker returning HTTP 200 with claimed=1, succeeded=1, retried=0, failed=0. The existing ten-minute queue invocation returned zero claimed jobs. No worker deployment or schedule/secret change was necessary.

The user-sent 11:57:15 UTC message produced event 739fdffa-d6bc-4bc1-a875-358f16be5339. At 12:00:43.773 UTC it became observed; its job succeeded on attempt 1. Inquiry f45e0749-135c-4716-8a46-d6fd8330e2fd resolves public listing A065407 by reference and requested staff Willy (72285986-c82c-46bd-98d9-c6b021d91b0d). assigned_agent_id remains null; event and inquiry effects_eligible are both false; association_review is false. This verifies the actual live observation path. It does not verify active routing, notifications or the newer one-minute service lane. The earlier queued state was the normal wait for the next five-minute tick, not evidence of a broken cron.

## Routing and Inbox notification activation preparation

User approved all new enquiries, Inbox internal notifications, and manual handling when no eligible handler is available. Policy owner explicitly selected: info@earnestproperty.com (79e7d3e9-b235-4661-a7c3-cc88cbadc9fb). Added manager role while retaining admin, with assisted-operation audit. Enabled only Willy's previously verified staff-channel mapping. Draft policy 73f28fbe-1444-4b38-b833-c43aa4303489 is routing_notifications with a 300-second intake freshness limit; customer service/calendar/copy fields remain unapproved and unused. No active generation yet.

Found and reproduced two activation blockers: policy validation incorrectly required customer-service configuration for routing-only activation; actual Inbox unassigned-thread responses omit userId rather than returning null. Added routing-only validation which cannot schedule customer-service obligations, preserving existing full-service policy requirements. Accepted omitted userId only as an empty/unassigned handler; private notes still require exact confirmed handler/folder. Both regressions were observed failing before fixes.

Verification: test:whatsapp-enquiries 72 passed; staff-notifications.test.mjs 6 passed; tsc --noEmit passed; scoped ESLint and git diff --check passed. No schema migration or unrelated bun.lockb change included.

Authorized one-off live adapter verification INBOX-PILOT-20260912-A065407-1: assigned only the existing A065407 test conversation to Willy, verified authoritative Inbox readback, then posted one labelled internal note. Provider returned accepted/private_note_posted. Audits c5e8c9ce-7a05-4d60-afea-6638a9c774f3 and 70251505-e420-42b5-a0d3-10e67a24f9aa record intent/result. This manual transport verification does not upgrade the observe event or prove the automatic workflow. Recipient/customer device isolation confirmation is pending. Endpoint prepared disabled; global flags remain observe/off.

## Missing notification visibility investigation

Operator reports not seeing the pilot note. Read-only provider verification confirms thread T0000771 in main remains assigned to Inbox user 69280afe1bbc4961899a4ce8 (willylai@fimmick.com); filtered list-users confirms folder access and no further page. Earnest transcript contains no pilot internal note. This does not prove the note is absent from native WOZTELL Inbox. Official internal-message API documents an internal message in a thread, not guaranteed recipient push delivery. No resend, flag activation, or delivery confirmation was performed. Browser inspection could not start because the local CUA kernel failed with a sandbox ACL error. Awaiting which surface the operator is inspecting; actual native-note visibility and customer isolation remain unverified.

## Operator receipt/isolation confirmation

Operator confirmed the pilot note is visible in WOZTELL Inbox and that the customer WhatsApp received nothing. This proves the tested private-note visibility/isolation only, not device push or the automatic pipeline. Authorized activation scope remains all new qualified enquiries with available verified staff mappings; unmatched enquiries require manual handling. info@earnestproperty.com owns the routing-only policy. Keep customer service automation, direct staff WhatsApp and acknowledgement escalation disabled. Preserve observe events unchanged.

## Routing-only production activation completed

2026-09-12: operator confirmed customer WhatsApp received no pilot note. Approved routing-only policy 73f28fbe-1444-4b38-b833-c43aa4303489 and created activation e1111b82-ca70-4e88-af4e-8c61794bdc81, cutover 2026-09-12T13:29:02.302Z, under the explicitly designated info@earnestproperty.com policy owner. Assisted executor and user authorization are retained in audit 259e75f1-5790-445a-917b-b9c2e17891fc; no staff login was impersonated. Enabled only verified Willy private-note endpoint 1e6a8975-68d2-46a4-91ab-978ea71bb2a6.

Production variables: EP_WA_ENQUIRY_MODE=active, EP_WA_ROUTING_ENABLED=true, EP_WA_STAFF_NOTIFICATIONS_ENABLED=true, EP_WA_ACTIVATION_ID=e1111b82-ca70-4e88-af4e-8c61794bdc81. Customer service automation, direct staff WhatsApp alerts and ack escalation explicitly false. Inbox verification reference now records the user-confirmed pilot. No schema migrations.

Exact source release: local commit 8eea44ec5973ccc9df7663ced32ecb4712a42ab0 on codex/whatsapp-routing-notifications. Exported only committed files, excluding unrelated bun.lockb modification. Vercel candidate dpl_HkcwEhoHJfVr11sZAt9FihBz9HzP built READY, then promoted. CLI inspection of earnestproperty.vercel.app resolves to this release; homepage and settings respond HTTP 200 (not a claim of authenticated browser rendering). GitHub push/merge not performed.

Cloudflare earnestproperty-cron version 973103bd-be9f-4e7f-9c96-155086f43151 published the existing one-minute service route while retaining five/ten-minute triggers. Actual service-worker POST returned HTTP 200 with zero queued jobs, and database service-v2 heartbeat observed at 2026-09-12T13:32:51.068Z. All-new automatic intake/assignment/notification remains to be verified with a fresh real user message. Existing qualified mappings/endpoints currently cover Willy only; unavailable handlers remain manual routing exceptions.

Completed the identified user observation test inquiry f45e0749-135c-4716-8a46-d6fd8330e2fd with status closed and an audit, retaining its immutable effect-ineligible event and transcript. This is not a live-event replay or eligibility upgrade. A subsequent genuine user message can create a new active enquiry.

Rollback: set mode=observe and routing/staff-notifications=false and redeploy the same compatible source; keep customer/service/direct-alert/escalation flags false. End activation only as part of operator-authorized rollback, retain schema/evidence and inspect any unknown attempts without replay. Prior deployment is dpl_4n4RukRavQm85nQnrNN6DmAEJNvW, but keep compatible source for reading the new policy purpose rather than blindly reverting it. The local source branch still needs authorized GitHub synchronization to prevent future main deployments from reverting the policy support.
