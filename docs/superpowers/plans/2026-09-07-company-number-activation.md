# Company-number ingestion activation

User authorizes source linkage, first import and daily activation, following explicit production schema approval. Existing daily design applies; company-provided unique property number supersedes exact-unit requirement ONLY for verified 28hse agent540 company linkage. Property.hk exact-unit rules stay unchanged.

## Design

- Capture explicit company number from source HTML as observed metadata `agency_property_no`; never accept a target property UUID or canonical field authority from payload. New parser python-v2.2 fixes semantic contract. Preserve individual advertisement IDs and full counts/baselines.
- Server-side explicit approved policy `config.company_number_identity` controls linking to existing canonical company number/public group and deal. Resolve historical candidate rows with existing admin authoritative order. More than one public group, source-ID reassignment, malformed/missing approved company number, or inconsistent evidence holds/stages rather than creating duplicates. Existing source ID lookup first.
- Same company can have sale/rent offers within one public property. New properties/offer types remain draft, with existing UUID/media/staff overrides preserved; no auto-publication. Existing legacy imported fields need explicit controlled ownership initialization excluding all staff override fields, no inferred manual ownership removal.
- Store every advertisement observation/link/contact. Choose one whole primary advertisement deterministically only when material fields/lifecycle are consistent; divergent price/status/identity remains reviewable and holds projection rather than arbitrarily treating largest source ID as latest. Text/contact differences do not justify combining contact identities. A missing advertisement cannot delist property while another compatible advertisement remains active. Propertyhk never revives delisted primary.
- Preserve atomic receipts, source state, links, ownership adoption, canonical updates, conflicts/reviews, events and baseline. Shared locks and frozen replay stay intact.

## Implementation tasks

1. Worker: sanitized fixtures, failing Python tests, exact company-number extraction, duplicate/malformed labels fail closed, wire agency_property_no, parser2.2. Worker-owned files only.
2. Server: decode optional observed company number (validated); policy-controlled relationship/grouping and safe legacy-field adoption; deterministic multi-ad selection/review; database regressions for existing group, historical rows, dual offer, new drafts, conflicts, overrides, source changes, replay/rollback. Keep new logic in bounded helper module where practical.
3. Root integration: update daily parser gates/docs/test wiring, inspect real captured conflicts and verified district/estate mapping. Reprocess frozen original evidence without changing capture time. Private raw evidence stays local. Review implementation before production apply.
4. Activation: rehearse against cloned production with disabled/public-safe policy, examine actual receipts/counts/unchanged existing identities; obtain independent final review. Only then apply approved policy/bootstrap and first immutable import to production. Verify commit receipt and full baseline; provision private evidence release, validate runner target/live access, hand off only old MLS schedule, enable daily02:17HKT. No WhatsApp/CRM schedule edits or real messages. Any automatic approval rejection is a hard boundary until resolved through stated safe alternative or explicit user approval.

## Validation

Python worker suite; Node contract/selection/service; named daily test; dedicated isolated DB tests; MLS/admin regressions; typecheck/build/lint. Review schema need before adding migration: public grouping must preserve aliases and single-property UI. No test result or live provider access is inferred from offline fixtures. Document any remaining blocking operational evidence.