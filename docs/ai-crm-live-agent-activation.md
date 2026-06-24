# AI CRM and Live Agent Activation

## Environment

Set these server-side environment variables before deploy:

- `AI_GATEWAY_API_KEY`
- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_EMBEDDING_MODEL`
- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED` optional, preferred for migration or sync jobs when available
- `BLOB_READ_WRITE_TOKEN`
- `WOZTELL_ENABLED`
- `WOZTELL_BOT_ACCESS_TOKEN`
- `WOZTELL_CHANNEL_ID`
- `WOZTELL_CHANNEL_SECRET`

Keep all secrets in Vercel/server environment settings. Do not expose these names through browser-safe modules or `NEXT_PUBLIC_*` variables.

## Migration And Deploy

1. Apply the Neon migrations for AI knowledge, CRM AI profiles, CRM segments, live-agent sessions, and WhatsApp campaign safety gates.
2. Confirm Vercel Blob and Woztell credentials are present in the target environment.
3. Deploy the branch and run `npm run build`.
4. In `/admin`, confirm AI knowledge status, CRM lead AI actions, segments, live-agent handoff, WhatsApp inbox, and blasts load for staff users.

## Staff Operations

1. Rebuild AI knowledge from `/admin` after content, FAQ, estate, article, or active listing changes.
2. Test the public live agent with public listing, estate, and FAQ questions. Confirm uncertain answers offer staff follow-up.
3. Create an AI CRM segment in `/admin/segments` by entering a natural-language audience prompt, then preview matched contacts.
4. Review eligibility reasons before materializing a segment. Contacts without WhatsApp opt-in, opted-out contacts, and contacts without valid phone numbers are not blast-eligible.
5. Queue WhatsApp only from the blast workflow after selecting an approved template, previewing the audience, saving campaign changes, and pressing Queue.

## Safety Rules

- The public live agent uses only public, published, fresh knowledge chunks. It must not use CRM notes, WhatsApp messages, staff-only chunks, private chunks, stale chunks, or prompt text that tries to override rules.
- AI may summarize, draft, suggest tags, suggest segments, and recommend next actions, but it never sends WhatsApp, queues blasts, or publishes CMS without staff action.
- Sensitive or judgmental CRM tags stay suggested until staff review. Only factual tags derived from explicit CRM fields may auto-apply.
- Opt-out is always respected. No-consent and opted-out contacts are ineligible for blast recipients with an explicit eligibility reason.
- Secrets stay server-side in server-only files, tests, docs, or config.
