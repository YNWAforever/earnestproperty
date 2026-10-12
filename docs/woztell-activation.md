# WozTell WhatsApp Activation

## Server Environment

Set these variables in the Vercel environment used by the deployment:

```text
WOZTELL_ENABLED=true
WOZTELL_BOT_ACCESS_TOKEN=<server-side bot access token>
WOZTELL_APP_ID=<WozTell app id>
WOZTELL_CHANNEL_ID=<WozTell channel id>
WOZTELL_CHANNEL_SECRET=<server-side webhook signing secret>
```

Keep the token and channel secret server-side. Do not use `NEXT_PUBLIC_` names
for either secret.

## Tracked `/w/` links

Tracked WhatsApp links (FX-19c-1) are on when `EP_WA_ENQUIRY_MODE` is `observe` or `active`. Set these now:

```text
EP_WA_ENQUIRY_MODE=observe|active
VITE_CONTACT_WHATSAPP_PHONE=<digits only, the company WhatsApp of the WozTell channel, never a staff phone>
WOZTELL_CHANNEL_ID=<WozTell channel id of the company WhatsApp>
```

`WOZTELL_CHANNEL_ID` serves as the company channel only while `EP_WA_ENQUIRY_MODE` is `observe` or `active`.

The old names `EP_WA_TRACKED_LINKS_ENABLED`, `EP_WA_COMPANY_PHONE` and `EP_WA_COMPANY_CHANNEL_ID` are deprecated. Do not add them. Each is still read, and wins, until 19c-2 while it is set. In particular, `EP_WA_TRACKED_LINKS_ENABLED=false` turns links off even in active mode. Delete them in Vercel after 7 days with no `[wa-config] legacy_name_in_use` log. Until then, the WhatsApp service health card shows 「舊設定名稱仍在使用」 with the names.

A production build fails when `WOZTELL_ENABLED=true` and the intake values are missing, or when tracked links are on and no usable company phone or channel resolves. Preview builds only warn.

## Webhook

Register this endpoint in the WozTell channel settings:

```text
https://www.earnestproperty.com/api/woztell/webhook
```

The older `https://earnestproperty.vercel.app/api/woztell/webhook` registration keeps
working: production 308s pages on `earnestproperty.vercel.app` to www, but `/api/*` is
never host-redirected.

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
