# Staff reply correlation uses the member id when the webhook has no reply context

- Date: 2026-11-18
- Status: accepted by the owner for Production
- Scope: staff WhatsApp transport gate, enquiry forwarding dispatch, staff event isolation

## Problem

Enabling the staff transport (and therefore website enquiry forwarding) required four
references. Two of them assume the provider delivers reply context:

- `EP_WA_STAFF_REPLY_CONTEXT_PATH` — the exact path of the quoted message id in the webhook body.
- `EP_WA_STAFF_CORRELATION_VERIFICATION_REF` — evidence that signed reply correlation was verified.

## Observation

Production records for the company channel's WOZTELL Bot webhook never contain reply context.

- 28 historical `whatsapp_inbound_receipts` rows: every `normalized_event.payload.data` has the
  single key `text`. The payload's own keys are `to app data from type member channel eventType
  messageId timestamp` — no `context`, `replyTo`, `quoted` or parent id anywhere.
- Live staff replies from 85298873493 to the 2026-11-17 delivery canary, recorded after the send:
  - 16:50:15Z (`Noted`) — `data = { "text": "Noted" }`
  - 16:56:18Z (`收到`, sent as a quoted reply) — `data = { "text": "收到" }`
- `staff_notification_internal_events` is empty, and the fixture path `messageEvent.context.replyTo`
  belongs to a different (Inbox) webhook shape that this channel does not deliver.

No truthful value can be produced for the reply-context path, and correlation therefore cannot be
verified against the provider payload.

## Decision

Keep `strict` as the default. Add an explicit operator mode:

```
EP_WA_STAFF_CORRELATION_MODE=member_id
```

In `member_id` mode:

- The correlation evidence reference is still required (an audit/receipt id, never free text).
- The reply-context path is not required, because the provider cannot supply it.
- Correlation uses the opaque provider member id that appears on both the outbound destination and
  the inbound reply (`staff_notification_attempts.destination_reference_snapshot = event.woztellMemberId`).
  The existing isolation query already matched on that id; only the unusable quote metadata is waived.
- Consent, ownership, destination readiness, isolation and the "exactly one notification" rules are
  unchanged.

## Consequences

- In `member_id` mode `CAPABILITY_REFERENCES_MISSING` no longer fires for a channel whose webhook
  has no reply context; `capabilities.replyContext` stays `false` so the report does not overclaim.
- If WOZTELL later emits reply context, switch back to strict (`EP_WA_STAFF_CORRELATION_MODE` unset)
  and set both the path and a reference to a real observed reply.
- Code: `src/lib/whatsapp-enquiries/staff-correlation-mode.js`, `staff-whatsapp-transport.server.ts`,
  `staff-event-isolation.server.ts`, `enquiry-forwarding-provider.server.ts`.
- Production evidence ids: `audit:fa33a7d2-290d-44c6-a240-bb1b39bb8929` (delivery canary accepted with
  provider message id), `audit:785996b5-de95-40ef-8c94-391c566b642d` (staff mapping verification),
  `receipt:6982111b-3162-48b0-8901-fbb35a15f08b` (quoted staff reply with member id `6afc8132d764935f20c196d0`).
