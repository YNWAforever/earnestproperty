# Staff handoff provider capability ledger

Status: **not live verified**. No provider messages, assignment calls, tenant changes or device tests were performed for this implementation. Documentation-derived transport fixtures are synthetic contracts, not tenant-observed evidence.

| Capability | Implemented boundary | Required evidence before activation |
|---|---|---|
| Actual assignee readback | Server-only Inbox list-threads; exact company channel/customer member, unique result, Inbox user and folder checks | Approved tenant URLs/auth and redacted readback fixtures; current intended staff folder access |
| Assignment | Existing versioned assignment requests/jobs; configured Inbox adapter; authoritative readback required | Authorized test tenant and synthetic customer/staff allowlists; current assignee proof |
| Private thread context | Private internal-message API only; handler/folder rechecked; private-note-posted evidence only | Confirm note absent from customer device and present in intended thread |
| Targeted mention/device push | No inferred capability from @email or API acceptance | NT-20 intended recipient foreground/background device observations |
| Optional staff WhatsApp | Dedicated verified permissioned destination; own window only; signed context isolation before customer intake | Independent endpoint consent, signed callback/reply fixtures and dual-role customer test |
| Outside-window staff template | Fails closed pending verified locator-bearing template contract | Approved template with exact parameter/link binding and tenant-observed acceptance |
| Five/ten minute acknowledgement reminder | No active policy or sends seeded; check job reports pending blocker | Explicit business approval, quiet hours, dedupe and destination evidence |

Configuration belongs in the server environment. `EP_WA_INBOX_SIGNATURE` is secret; never put it in VITE variables, browser state, reports or tracking links. Empty `EP_WA_INBOX_*` capability values fail closed. `WOZTELL_APP_ID`, company channel and integration must all refer to the separately approved test tenant. A nonempty verification reference is an operator attestation, not self-verifying evidence.

The settings editor records evidence references and versioned destinations. It never proves device delivery or grants transcript access. No FYI is emitted without an approved collaboration policy; referring agents gain no transcript or acknowledgement permission.

Official contract reference consulted by the backend reviewer: [WOZTELL Inbox integration public API](https://doc.woztell.com/docs/integrations/inbox/inbox-integration-public-api/) (2026-09-12, search-index documentation content; direct page retrieval timed out). Examples contain different endpoint prefixes; no prefix probing or tenant verification was performed.

`EP_WA_STAFF_ASSOCIATION_REVIEW_REF` must refer to an approved human review procedure before optional staff transport can be constructed. Managers can read normalized ambiguous messages in settings; automatic disposition/replay is intentionally absent. Initial staff-window acquisition and operational handling of ambiguous legitimate customer enquiries must be verified before activation. The adapter does not infer these from a public phone number or ordinary customer activity.
