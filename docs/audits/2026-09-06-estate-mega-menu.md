# Estate directory mega menu verification

- Branch: codex/estate-mega-menu
- Replaces fixed estate shortcuts with published estate directory, registry grouping, local Chinese/English/alias search, unique property totals and sale/rental filters.
- Lightweight read query uses latest public member per deal before active filtering. No schema or data mutations.
- Automated: directory tests 3/3, navigation/config tests 30/30, isolated PostgreSQL fixture passed including dual offers, withdrawals, published zero inventory and unpublished exclusion.
- TypeScript and targeted ESLint passed. Independent code review resolved registry grouping precedence; no remaining findings.
- Local Playwright: 22 estates; 1440x900 and 1024x600 bounds; ArrowDown search focus and Escape trigger focus; no-result search; 320px/390px mobile navigation closes sheet and retains estate/deal filters.
- Browser request failure simulation: no fake zero inventory; retry restores all 22 estates.
- Screenshots and browser scripts retained locally under .audit-20260905.
- Production verification pending CI and deployment.
