# Decision register

## Engineering decisions within Phase 1

- Default `EP_WA_ENQUIRY_MODE=off`; only `off` and `observe` accepted in this release. `active` fails closed.
- All captured records permanently store `capture_mode=observe` and `effects_eligible=false`, enforced by CHECK constraints. A future activation requires a new migration and explicit generation/cutover design; no observed backlog is eligible.
- Live identity hash includes app/channel/member/external identity. Transcript uniqueness and historical synthetic IDs remain unchanged. History never creates a workflow event/job, even if observation is enabled.
- Ledger stores a transcript reference plus whitelisted classification metadata, not a second full customer body. Existing transcript payload retains original message evidence. Unsupported controls/notes are acknowledged without customer intake.
- Signature uses existing channel secret/raw bytes. Body budget is 1 MiB. Expected `WOZTELL_CHANNEL_ID` and optional `WOZTELL_APP_ID` are checked; observation requires both configured. No tenant identity assumed.
- A 24-hour age label is diagnostic only, not an approved service policy. Missing/future/stale times remain visible; no service action is eligible at any age.
- Provider fixture provenance: synthetic legacy/documentation-derived, never tenant-observed. API success is not delivery evidence.
- Inbox metadata is preserved. No verified staff mapping exists in this phase; production classification keeps staff-looking callbacks unverified. Pure classification accepts server-verified mapping evidence for future integration only.
- No cron or capacity changes in Phase 1. Existing registered worker executes bounded observation work.
- Roll-forward schema correction preferred. No destructive down migration.

## Business decisions — all UNAPPROVED

Owner for every item: business/operator, not the implementation agent.

| ID | Decision | Blocks |
|---|---|---|
| D01 | Elapsed versus opening-hours response clock | active service deadlines |
| D02 | Before 08:00 and exact 08:00/22:00 boundaries | active calendar |
| D03 | Daytime enquiry crossing closing time | deadlines |
| D04 | Weekdays, holidays, timezone and branch calendar | calendar activation |
| D05 | Reception applicability | reception automation |
| D06 | Active-dialog survey deferral/suppression | surveys |
| D07 | Extra reminders or overdue-manager messages | extra sends |
| D08 | Freshness, survey expiry and worker-lag tolerance | activation and service lane |
| D09 | Manager/reception fallback and control ownership | routing/pilot |

No copy/template/channel/folder/staff mapping approval inferred from source documents or tests.

## Phase 2/3 implementation decisions

1. Reuse inquiries as episode roots. An intake message is unique; enquiry_messages associates followups. Invalid/multiple references flag association review. No unrelated CRM lead is replaced, and no web identity is inferred from a tracking GET.
2. A link has a stable random code and immutable versions; opens retain that version/context and only a SHA-256 reference hash. Link retirement remains possible after an offer goes offline, its requested staff retires, or company configuration is removed. Existing historical channel is retained when retiring.
3. Company routing configuration is server-only. Public loader failure degrades to `/contact`; rendering never provisions links. Requested staff is intent, never assignment authority.
4. Existing local owner writes are intercepted by the additive database trigger, protecting all canonical writer paths including handovers. Provider-confirmed owner, desired owner and version are separate. Handover counts describe pending requests, not confirmed remote transfer.
5. Unknown/stale remote actions hold the conversation exclusion until authoritative resolution is possible. No callback or HTTP 200 is treated as confirmation. No live endpoint/signature was invented. Duty/reception configuration stays missing when unapproved; the pure policy supports it and the operational view shows the exception.
6. Only authenticated accepted intents or tenant-verified persisted Inbox evidence can credit human response. Earliest correction retains evidence; replay cannot credit a different episode. Acceptance is not delivery/read. The Inbox capability table is empty by default and requires separately approved actual tenant evidence.
7. Explicit association rejection is safe to correct because it occurs before enqueue; unknown outcomes retain retry identity. Association is part of the request hash/reservation so a retry cannot silently move a response to another enquiry.
8. Approved service-policy contents cannot be changed in place. Retirement is allowed; approval, calendars, service actors, surveys and sends remain later-phase gates. No policy approvals or provider capabilities are seeded.

## Phase 4 implementation decisions

- No default business approvals: 08:00–22:00 is the source draft, with boundary, weekday, holiday, reception, duration, suppression, freshness, expiry and lag choices explicitly unresolved. A simulator result is hypothetical and does not approve or activate anything.
- Offset-free and calendar-invalid timestamps fail closed. Overnight 10:00 must be in the future on an eligible business day, independently of the response deadline.
- New service purposes are restricted to after_hours_ack, survey, survey_thanks and manager_ack. Human APIs cannot select service authority or arbitrary service text. Existing blanket opt-out stays.
- Live service transport, reply-button decoding, approved outside-window templates and actual assignment readback require authorized tenant fixtures. No guessed WOZTELL payload shapes. Numeric 1/2 has no automatic interpretation without a verified prompt contract.
- Activation requires a persisted generation matching EP_WA_ACTIVATION_ID. Historical and observe captures retain their original ineligible evidence across later activation.
- Phase 5 release evidence is a separate gate from deterministic implementation tests. The JSON checker checks evidence completeness, not the truth of external documents; a release owner must verify referenced evidence.
- Phase 6 has no supplied acceptance criteria. No production action is inferred from the request to develop phases.

## Staff handoff extension decisions

- Reference namespace, raw alias, mapping version, requested staff and selected-offer owner are separate immutable intake facts. Retired/recycled aliases cannot reinterpret a pinned link as another person.
- Confirmed handler receives action-required work; legitimate protected/existing-coordinator/fallback mismatches remain visible. No collaboration FYI is emitted until its access policy is approved.
- Readiness is per enquiry, recipient, assignment version, purpose and generation, with intent and job in the same transaction. Flags are captured at live intake; historical/observe/flag-off events cannot become backlog.
- Acknowledgement and help are authenticated, current-version/current-eligibility writes, independent of the customer-response deadline. GET/HEAD never acknowledges or records seen. Customer replies resolve pending work without inventing acknowledgement.
- Destination management is role-gated, versioned and auditable. It cannot enter synthetic inbound-window timestamps. Unknown transport acceptance is never blindly retried.
- A private note is context evidence only, not a targeted device notification. Optional outside-window staff templates remain blocked until the approved locator-bearing parameter contract is verified. Five/ten-minute reminders stay unapproved.
- Review gate requires separate browser accounts, test tenant/device evidence, release approval and fresh activation. No production action is inferred from coding authority.
