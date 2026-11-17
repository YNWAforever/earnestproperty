# "Not archived" is proven by a live delivery when the API omits the archive flag

- Date: 2026-11-18
- Status: accepted by the owner for Production
- Scope: provider readiness, website enquiry forwarding enable proof

## Problem

`deriveEnquiryInfoReadiness` requires `channel.archived === false` (`INFO_CHANNEL_ARCHIVE_UNVERIFIED`)
and the staff readiness report requires the same (`PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN`).
The WOZTELL Open API channel query asks for `archived`, but this company channel answers `null` —
not `false` — while the channel is connected and delivers. Strictly, the gate can never pass.

## Observation (Production, 2026-11-17/18)

- `CHANNEL:200` with `connected: true`, `archived: null` (repeated across readiness runs).
- `SENDER:200`, `TEMPLATES:200`; the configured `staff_enquiry_followup` template is `APPROVED`
  and complete, with the expected company phone and WABA.
- A real template send on this channel was accepted with an identifiable provider message id:
  `audit:fa33a7d2-290d-44c6-a240-bb1b39bb8929` (delivered to 85298873493 at 2026-11-17T16:30:45Z,
  content confirmed by the recipient).

An archived WhatsApp channel cannot deliver a template; the accepted send is direct evidence that
the channel is active.

## Decision

Keep strict behaviour as the default. Add an explicit operator-declared equivalent proof:

```
EP_WA_CHANNEL_ARCHIVE_PROOF=live_delivery
EP_WA_CHANNEL_ARCHIVE_PROOF_REF=audit:<real delivery audit id>
```

The proof is accepted only when:

- the channel is `connected === true`,
- `archived` is not `true` (an explicit archive always fails, `PROVIDER_CHANNEL_ARCHIVED`),
- the operator declared `live_delivery` **and** named a real audit reference.

The report stays truthful: `channel.archived` remains `null`, and `channel.archiveProof` records the
declared basis. `deriveEnquiryInfoReadiness` accepts the proof under the same rules.

## Consequences

- `INFO_CHANNEL_ARCHIVE_UNVERIFIED` and `PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN` clear for this
  channel once the declaration and reference are set.
- If WOZTELL starts returning `archived: false`, remove the declaration and the proof is ignored.
- A disconnected or explicitly archived channel still fails; nothing else about delivery, recipients,
  consent or isolation changes.
