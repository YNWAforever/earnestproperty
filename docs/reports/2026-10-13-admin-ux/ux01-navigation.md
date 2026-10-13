# T-UX01 — role-aware navigation

Source baseline: f46b309dc0c9b1e44351f959f15806132674c590 with the navigation diff in this commit. A clean committed-head rerun is required at T-UX09. Local owned browser evidence is not normal Auth, real DB, provider or human UAT evidence.

- Before change: new navigation suite 3 fail / 4 pass (240px rail, missing groups/collapse); existing daily-work baseline 174 pass.
- After change: navigation 7 pass; existing daily-work / attention / safer-actions 174 pass; role/nav and wiring 15 pass; typecheck passed.
- An intermediate run exposed a real 200% text / short-screen footer overflow. Fixed the fixed-region geometry; retained the <=600px assertion. A separate badge fixture lacked a nonzero count; added an explicit synthetic count. Intermediate failures remain in local evidence.
- Shared metadata covers 17 destinations. Agent has 6, viewer only operations. Manager team visibility does not change staff.manage. The server guards were not modified.
- 256/72px desktop rail, independent menu scroll, persisted collapse boolean with storage-error fallback; keyboard/focus tooltip and accessible badge. Mobile Sheet retains focus trap, Escape return and close after navigation.
- NAV-04 currently verifies leads query/history. Command-center, settings and editor deep links will be covered when the all-route fixture is assembled. NAV-05 normal login remains unverified. NAV-02 property-sync shortcut is handled at T-UX03.
- Private local logs: .audit/admin-ux-20261013/ux01-*.log, ux01-red.json, ux01-short-screen-red.json, navigation.json. Hashes are in ux01-log-hashes.json. Browser contexts and HTTP server were disposed; no DB/provider data was created.

HKWTIA authenticated UI was unavailable. This implementation follows the explicit supplied sidebar proposal; it does not claim a one-to-one reference match.
