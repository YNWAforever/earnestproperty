# Production admin repair — 2026-09-06

User explicitly authorized repair and production rollout. Base: merged PR113, main9db1790. Recovery branch: br-young-art-ao8743s3, created from production br-polished-sea-aom4i1ct before changes; checked18 migrations,22 estates,62 messages.

## Root causes and changes

Production had18/38 migrations. The missing CMS draft_retired_at, campaign dispatch_started_at and inquiry crm_lead_id matched the admin errors. Applied20 previously Preview-tested migrations to production; verified38 recorded and required columns present.

WozTell sends delivery/read status notifications on its inbound webhook. Existing ingestion treated every event as chat content; the reported conversation contained one real TEXT plus a DELIVERED and an UNKNOWN wrapped error. New ingestion stores receipts independently, serializes by provider message identity, and updates only matching outbound message/channel/member status. A database trigger handles receipts arriving before content and prevents read/delivered regression from late lesser statuses. Receipt processing never creates contacts or advances last_inbound_at. Ambiguous outbound intents are not automatically resent or falsely declared delivered. Legacy receipt payloads are retained before removing their empty timeline bubbles. No actual provider send is performed.

Authoritative webhook reference: https://doc.woztell.com/docs/documentations/channels/channels-webhook/

Estate admin description/transport fields were empty although22 public editorial pages already contained content. The fill migration imports that existing prose only into blank fields, records full original rows in estate_content_repair_20260906, and supersedes/inserts published revisions when one exists. Prior versions and authored values are preserved. Unresolved numeric/source conflicts remain null; no fabricated prices, travel times or verified_at stamps.

Additional details verified2026-09-06 and inserted only where blank:
- Bellagio address and facility categories: https://hk.centanet.com/estate/%E7%A2%A7%E5%A0%A4%E5%8D%8A%E5%B3%B6/3-AAPPWPPEPB
- Hong Kong Garden address: https://hk.centanet.com/estate/zh-cn/%E8%B1%AA%E6%99%AF%E8%8A%B1%E5%9C%92-2%E6%9C%9F/2-QSROFRCXUR
- Lido Garden address, developer and facilities: https://hk.centanet.com/estate/%E9%BA%97%E9%83%BD%E8%8A%B1%E5%9C%92/1-DZHHZHTAHH
- Ocean Pointe clubhouse and garden: https://www.kerryprops.com/hk/property-details/59/ocean-pointe
- OMA OMA Club OMA: https://www.wingtaiproperties.com/en-US/property_developments/detail/20

## Verification and rollout

Two new receipt regressions reproduced failures before implementation and pass afterward. Four actual disposable outbound/receipt DB tests pass, including receipt-before-message, late lower status, unchanged inbound timestamp and transcript count. Existing WhatsApp, CMS47 and control-plane94 tests pass. Preview has41 migrations; all22 estates have description/transport after repair, and five active estate publications remain with preserved version history.

Production rollout requires the three20260906 migrations before new ingestion code. Re-run legacy receipt reconciliation after deployment if events arrived during rollout. Verify migration count41, zero remaining status bubbles, customer text retained, zero missing descriptions/transport and successful aggregate reporting SQL. Browser login acceptance must be reported separately from direct database/query verification.

Rollback: retain recovery branch and before-image table. Roll back code to the previous immutable deployment if needed; prefer a targeted repair or restored branch connection after assessing writes since snapshot rather than overwriting newer customer messages. No recovery branch is deleted automatically.

Production credentials are held only in process memory. Automatic approval review rejected the proposed local credential file; no such file was created.
Production results: all41 migrations are now recorded. Original20 plus three new repairs were applied. New repairs used the Neon transaction connector without sending a credential through shell arguments. Local build/typecheck and focused lint passed. Final4/4 disposable DB tests include explicit cross-channel rejection before accepting a matching READ receipt. Source rollout follows via PR/CI.
