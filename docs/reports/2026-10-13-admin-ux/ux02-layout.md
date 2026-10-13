# T-UX02 — shared header and width contract

Source baseline: 5485528e plus the layout diff in this commit; final clean-head rerun remains required.

- RED: 5 failures before the contract (three missing geometry owners, two truncated titles).
- GREEN: 15 layout checks (12 actual-route normal viewports, two 200% long-title/action cases, skip-link focus) plus 7 navigation checks = 22 passed.
- Existing layout tests: 33 passed. Existing styles: 33 passed. TypeScript: passed.
- Intermediate failures retained: an initial fixture write used Windows default encoding; repaired the fixture text in UTF-8. A formatter changed an unrelated font-stack declaration; restored original shared CSS formatting and passed the existing style guard without weakening it.
- Single admin gutter owner uses 16/24/32px, full viewport desktop 256/72px grid, standard1440/wide/form896 widths. Header and body are siblings in the same width owner. No nested main or document overflow hiding.
- Staff-ready title/actions gates, auth/checklist/attention lifetime are preserved. Toolbar keeps caller form ownership with an optional disabled fieldset.
- New transaction is the initial form route; its variant migration is consumed by T-UX04. The remaining 22 normal route templates are pending their tasks, not counted as passed here.

Local evidence: .audit/admin-ux-20261013/ux02-*.log and layout.json/navigation.json. No normal Auth, real DB, provider or native keyboard evidence. All fixture servers and browser contexts were disposed.
