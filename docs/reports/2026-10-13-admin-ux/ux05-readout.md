# T-UX05 — Responsive inbox without resetting workflows

Source: 9ce972e7e9bc1ab8d2459df145079354f4bd9ad6 + task diff; final clean-head verification pending

Baseline: 76/76 existing owned mobile cases passed. A new 2000px test reproduced the standard-width cap (one product RED); a second initial failure was a wrong test label, corrected to the existing accessible name, not a product change.

The actual inbox now explicitly uses wide content in both staff-loading and ready branches. Header owns refresh/import actions with the same canBackfill condition and handlers. Grid columns have min-width zero; timeline/composer, request journals and identity lifecycle are unchanged.

GREEN: 128/128 owned browser cases (52 layout/inbox + 76 existing mobile); 21/21 existing safety component cases; TypeScript passed. New checks exercise wide geometry and conversation A→B→A draft retention across sidebar collapse. Existing synthetic IME/keyboard, delayed response and membership cases remain distinct from native device acceptance.

Native mobile keyboard/IME and normal Auth→DB/provider acceptance remain unverified.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.
