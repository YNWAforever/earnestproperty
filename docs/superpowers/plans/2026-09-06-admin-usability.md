# Admin usability implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task with focused reviews.

**Goal:** Make daily CMS editing and CRM follow-up easier while preserving existing business rules.
**Architecture:** Reuse authenticated server functions; extract small shared presentation helpers and editor controls. No schema or customer data changes.
**Tech Stack:** React, TanStack Router/Start, TypeScript, Tailwind, Bun/Node tests, Playwright.

## Global constraints
- Approved spec: docs/superpowers/specs/2026-09-06-admin-usability-design.md.
- Keep permissions, revision comparison, explicit publish confirmation, unsaved-change guards and reply drafts.
- No real messages, test customer writes, automatic inference or provider changes.
- Worktree audit-20260905; preserve unrelated local changes; stage explicit files only.

## Task 1: CMS daily workflow
Files: src/routes/admin.cms.tsx, new src/components/admin/CmsEditorFields.tsx and focused tests as needed.
- [x] Reproduce contradictory search copy with a regression; inspect current editor/dirty guard semantics.
- [x] Put content workspace first and technical AI status in a compact expandable area, with visible failure/stale alerts.
- [x] Group forms; district choices from authoritative project data, retain unknown values; units and slug/facilities help.
- [x] Image upload and preview through uploadAdminMedia, retaining URL input and failures without losing form state.
- [x] Visible save/publish actions with truthful unsaved/saved state; AI/history collapsible; keep comparison and publish confirmation.
- [x] Correct search scope/error retry and counts. Run CMS tests, typecheck, targeted lint; review.

## Task 2: CRM workflow and shared language
Files: src/routes/admin.leads.tsx, src/routes/admin.leads_.command-center.tsx, src/components/admin/AdminShell.tsx, new src/lib/admin/crm-presentation.ts and tests.
- [x] Write failing tests for shared stages and quick filter serialization.
- [x] Chinese task-based navigation and consistent stage labels; preserve enum values and permissions.
- [x] New/unassigned quick filters, concise primary filters, expandable advanced filters with Chinese intent/source labels and preserved unknown values.
- [x] Make internal note/save semantics clear; keep related conversation links and customer facts. Label AI-only scores and unknown values honestly.
- [x] Run CRM suites, typecheck and targeted lint; review.

## Task 3: WhatsApp and integrated verification
Files: src/routes/admin.whatsapp.tsx; focused UI tests and local synthetic browser fixtures.
- [x] Collapse optional AI/provider detail and prioritize permitted reply action without changing sending rules.
- [x] Verify protected UI with synthetic authenticated fixtures; no real credentials or messages. Check empty/error/loading, form retention and mobile action visibility.
- [x] Run relevant CMS/CRM/auth suites, typecheck/lint, independent review.
- [ ] Commit explicit changes, PR and CI; follow approved release workflow. Verify production read-only and accurately report authenticated acceptance limits.
