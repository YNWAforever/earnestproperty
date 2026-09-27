# Staff WhatsApp handoff test

State: no designated colleague, verified phone endpoint, approved template or actual send in this execution session. Do not use the account named `test` as the recipient by assumption.

## Pre-send manifest

Record in a private operations location, never in a public PR: staff ID and name; active role; Inbox mapping ID/version and provider verification; staff phone endpoint ID/version and masked destination; transport, channel, approved template if needed, dedicated test phone; single test link and its public listing/deal/source; request/correlation ID; operator and time.

If an item needed by the selected transport is absent, stop only the live send step and record that exact missing item. Preview, saving a mapping, copying and opening a page must not enqueue a message.

## One-message evidence chain

1. From the dedicated test phone, open the single registered link and verify the prefilled public property text. Send the generated EPWA text unchanged to the company number.
2. Match open, inbound webhook, enquiry, requested staff, assignment request and provider-confirmed assignment by the same correlation ID. An open alone is not an enquiry.
3. Separately inspect Inbox private note and staff phone attempt. Record provider accepted/message ID, delivery receipt and recipient confirmation independently; missing delivery evidence remains `unknown`.
4. Have the named colleague open the work link and reply, confirming the original test enquiry and destination isolation. In an isolated fixture, replay the webhook and job to verify no duplicate enquiry or notification.
5. Record results, timestamps and sanitized log links in the validation report. Keep raw phone, provider payload and customer text out of git.

If an organization browser policy blocks WhatsApp, record that browser limitation and let the designated tester use an approved device. Do not bypass the policy or label the site broken from that block alone.
