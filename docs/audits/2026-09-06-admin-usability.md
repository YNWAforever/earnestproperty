# Admin daily workflow verification

CMS: content-first workspace, grouped fields, district choices, image upload/preview, visible save/publish actions, accurate dirty state and explicit confirmation. Pending uploads block completion and retain existing paths.

CRM: shared Chinese stages/navigation, quick/advanced filters, clear internal notes. Note-only saves retain other unsaved fields and newer notes; stale customer completions are ignored.

WhatsApp: replies precede optional AI suggestions; applying suggestions remains draft-only with overwrite confirmation and unique composer IDs.

CMS, command-center and Woztell suites, TypeScript, targeted ESLint and independent review passed. Synthetic authenticated Playwright verified save/upload failure, concurrent edits, note retention, filters, explicit publish confirmation, mobile bounds and WhatsApp overwrite cancellation. No real customer messages or data were written; server-function and admin API requests were blocked in browser fixtures.

Production authenticated acceptance is not claimed because the fresh browser has no admin session. Deployment/login-gate checks remain pending. No migration needed.
