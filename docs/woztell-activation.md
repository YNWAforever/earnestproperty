# WozTell WhatsApp Activation

## Server Environment

Set these variables in the Vercel environment used by the deployment:

```text
WOZTELL_ENABLED=true
WOZTELL_BOT_ACCESS_TOKEN=<server-side bot access token>
WOZTELL_CHANNEL_ID=<WozTell channel id>
WOZTELL_CHANNEL_SECRET=<server-side webhook signing secret>
```

Keep the token and channel secret server-side. Do not use `NEXT_PUBLIC_` names
for either secret.

## Webhook

Register this endpoint in the WozTell channel settings:

```text
https://earnestproperty.vercel.app/api/woztell/webhook
```

The handler verifies `X-Woztell-Signature` against the raw request body before
parsing JSON. It stores contacts, conversations, and messages using the
WozTell member/channel identity, and ignores duplicate external message IDs.

## Admin Replies

Staff reply from `/admin/whatsapp`. The browser submits only the conversation ID
and message text. The server re-reads the WozTell member ID from Neon, checks:

- `WOZTELL_ENABLED` is true
- the contact has not opted out
- the last inbound message is within 24 hours

An outbound message is stored as `sending` before the provider call, then
updated to `sent` or `failed` with the provider response and error details.

## Verification

Run the focused checks before deploying:

```bash
npm run test:woztell
npm run lint
npm run build
```

After deployment, send a test inbound message through the configured WozTell
channel, confirm it appears in `/admin/whatsapp`, and send a reply while the
24-hour window is open. Confirm the message timeline shows the final delivery
state.

## Safety

- Never commit real WozTell credentials.
- Keep opt-out state persistent; outbound events do not opt a contact back in.
- Do not bypass the server-side member identity lookup from client code.
- Use approved WhatsApp templates for campaigns outside the free-form window.
