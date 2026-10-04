# EP13–20 exact-head CI follow-up

Source/test commit `308099a38815543789b486840dca63a1180c8894`. This adds evidence after the first published source and preserves its complete 732 UI /209 SQL snapshot. Existing statuses, all prior CSV cells and all prior execution-evidence entries remain unchanged.

The first exact-head CI at `5491dba`, run [37203311589](https://github.com/YNWAforever/earnestproperty/actions/runs/37203311589), failed in three independent places: two media VM dependency tests; the handoff Bun bundle importing TanStack server-entry dependencies through a lifetime-only hook; and an obsolete campaign API denial message assertion after the new pre-read gate. Its owned PostgreSQL job passed 232 tests, comprising the original 209 groups plus 23 no-link cases. That run's restored Golden clone was 682030 bytes; original recent writes stayed present and receipt replay created zero duplicates. Staging was skipped and remains BLOCKED.

The follow-up extracts the identical lifetime hook to a React-only module (AST equality independently verified), supplies the real workspace-request helper to the VM tests, and displays a clear resolved-role denial reason while requiring zero private campaign reads, authoring controls and queue effects. The optional validated evidence prefix changes only owned test output paths.

A local legacy browser retry then exposed a real initial timeline resize race: pane height changed from 233 to72 pixels while scrollTop stayed4687. A scroll event arrived before ResizeObserver and incorrectly marked the reader unpinned. The route now tracks the observed offset and changes pinned intent only when the offset changes. Four deterministic actual-route RED cases cover this ordering and its older-reader positive control; all48 mobile cases passed. Original viewport and older-reading assertions were retained. A diagnostic filtered run is not complete acceptance. One additional late overview retry failure occurred after the diagnostic rebuilt its shared fixture directory; the failed attempt remains recorded and its cause is unconfirmed. Final serial115-case acceptance passed with no skipped scenario.

| Verification | Result |
|---|---|
| MLS including upload VM | 643 PASS,0 FAIL,0 SKIP |
| Handoff legacy | 14 PASS,0 FAIL,0 SKIP |
| No-link legacy | 115 PASS,0 FAIL,0 SKIP |
| Actual routes: campaign68/Operations20/workspace44/mobile48 | 180 PASS,0 FAIL,0 SKIP |
| Final named Inbox/no-link units; typecheck/lint/build | PASS; lint0 errors,3 pre-existing warnings |
| Next full actual-route CI matrix | 736 expected scenarios (prior732 plus4); exact-head readback follows push |

Focused follow-up commits:
- `57c0e96` fix(admin): isolate lifetime hook and explain denied campaign workspace
- `308099a` fix(admin): ep-14 retain newest-message pin through pane resize

No second independent review was requested; these are the author's verification repairs after the one completed review. No server runtime/config/schema/provider identity changes were made. The 85-schema/one-registry dry-run is retained. No production migration, real sending, application-model spending, merge or manual deployment occurred.

READY covers the selected local contracts and recovery evidence. Full EP13/14/15/16/17/19/20 acceptance remains NOT_READY; EP18 is locally verified only. True Auth/branch-only/cross-tab, combined real UI+Auth+PG, exhaustive action mapping, provider/recipient/model, formal release and Property.hk gates remain separate. Native28Hse baseline1/3,repaired0/3,agent-triggered0; 120/20/45/10 and04:17HKT retained; historical132 candidates remain held. The 27 original historical PNG bytes remain unavailable as valid old screenshot proof; original hash/status metadata is unchanged.

Rollback the two follow-up UI/import/test commits in reverse order if necessary. Preserve accepted writes, media, offers, protected edits, receipts, drafts, mappings, batch/chunk/request identities and stored worker results; do not resend or roll back schema. Same open Draft PR219. This document is the pre-push snapshot; the final exact-head CI link/status is appended to that PR and the local publication readback.
