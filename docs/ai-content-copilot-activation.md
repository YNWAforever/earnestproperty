# AI Content Copilot Activation

This feature is an authenticated CMS assistant for estate, article, FAQ, video, and listing content. It uses OpenCode Go only for Content Copilot generation. Existing CRM AI, segmentation, embedding, knowledge, and live-agent features keep their existing providers and flows.

## Preview or Test Environment

1. Apply the additive proposal migration to the preview or test Neon database using the repository migration workflow. Confirm the `ai_content_proposals` and audit tables exist before enabling the UI.
2. Configure the provider variables in the preview or test environment. Keep secret values out of source control and local logs:

```dotenv
OPENCODE_GO_BASE_URL=
OPENCODE_GO_API_KEY=
OPENCODE_GO_MODEL=
TAVILY_API_KEY=
```

3. Open the admin CMS as a permitted staff user. Save an estate, article, FAQ, video, or listing first; new unsaved records intentionally show a save-first state.
4. Generate an internal proposal, review selected fields, apply it, and then use the existing Save or Publish action. Confirm the proposal status and audit event are present.
5. For the internal pilot, leave web research disabled and `TAVILY_API_KEY` empty. If web research is enabled later, verify that every factual web claim has an HTTPS citation in the review panel.
6. Run `npm run test:content-copilot` before promoting the branch.

## Guardrails

- Only allowlisted content fields can be proposed or merged. Facts, ownership, status, publication state, identifiers, timestamps, CRM data, leads, contacts, WhatsApp data, and private staff notes are excluded.
- The canonical write remains the existing CMS or listing save handler. Copilot never publishes directly.
- Generation quotas, one-active-generation leases, proposal expiry, stale checks, audit metadata, and staff access checks are enforced server-side.
- OpenCode Go credentials, provider prompts, and authoritative context remain server-only.

## Production Approval

Do not apply the migration or add provider variables to production without explicit approval. Before that approval, review the exact migration diff, environment-variable scope, staff roles, provider budget, audit retention, and rollback plan. No production migration or secret provisioning is part of this change.
