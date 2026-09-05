# OpenCode Go timeout follow-up — 2026-09-06

## Root cause and measured evidence

PR #115 used DeepSeek's native `thinking: {type: "disabled"}` option. OpenCode Go ignores that option. In isolated Vercel builds with the production AI configuration, the old request still returned 16,444 reasoning characters and took 64.580 seconds; a streaming comparison took 37.893 seconds with 8,421 reasoning characters. Both exceed the 30-second request budget.

The gateway's `reasoning_effort: "none"` option returned valid JSON in 5.913 and 6.358 seconds with zero reasoning characters. Reference: https://github.com/anomalyco/opencode/issues/46178 . These are diagnostic samples, not a guaranteed SLA.

The real application context loader, provider client and proposal validation were then exercised with a synthetic public estate fixture and the user's settings: improve, five name/description/SEO fields, professional tone, original language, internal research. Without any knowledge results, generation was quick but factual patches failed `COPILOT_EVIDENCE_REQUIRED`: the saved record was not itself citable.

The context loader now provides a bounded `internal-resource` evidence item from its existing allowlisted saved-record projection, even when optional knowledge search is empty or fails. No additional database fields or CRM data are read, and proposal/citation validation remains unchanged.

The final full-service probe returned validated proposals twice: 8.284 seconds and 9.321 seconds, each with four patches. Persistence was injected as no-op fixture ports, so no production content, proposals or audit rows were changed by diagnostic runs. The deployed service modules were copied with only the TanStack server-only marker removed for standalone execution.

## Diagnostic deployments

All used `--prod --skip-domain`; the canonical `earnestproperty.vercel.app` alias was checked and retained the application deployment while diagnostics ran. No credentials were exported to local disk or logged.

- Old parameter: dpl_DiJKGwc3wnFZ3MAd8qvvoWrnVCRS
- Gateway parameter: dpl_7Ajb5JY568ABpAygTk6LZTJ1xgyR
- Full-service fixture without record evidence (expected failure): dpl_7VL46tp8xH2tYvmAtC8BRKVxVbWm
- Final context + provider + validation: dpl_FUNW7xszeZ3NqhFucA36LytxshXp

## Verification

Regression tests failed before the gateway/evidence fixes and passed afterward. AI suite: 69 Node + 24 Bun tests passed. Independent review approved both scoped changes. Staff-authenticated browser operation still requires separate observation; the provider and proposal-validation probes do not simulate the staff session or real persistence.
