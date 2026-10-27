# 黃金必走盤 inventory refresh (27 October 2026 HKT)

## Root cause, confirmed read-only

On `dawn-meadow-79190048` / production `br-polished-sea-aom4i1ct` / `neondb`,
all saved agent/540 promotion tiers stop at `2026-10-11T23:56:29.894Z`.
The latest healthy full python-v2.2 run is `2026-10-11T23:57:28.097Z`.
The 22 and 24 October runs were partial; 52 healthy owner-publication runs on
25 October did not refresh promotion evidence. These were SELECTs only.

The daily owner job republishes a single hash-pinned capture. Its publisher did
not write promotion tiers. PR #280 reads those historical tiers through active
source links; with absence inference disabled, missing adverts can remain active
there indefinitely. Within each grade it used our collector's first-seen time,
not the current agent index order. The public CDN caches for 60 seconds plus
300 seconds stale-while-revalidate: that does not account for weeks of stale data.

Willy's report of about 196 sale adverts is the source target, not a hardcoded
count or a claim that this branch has collected or published those adverts.

## Repair

An approved, complete **sale index** snapshot becomes the homepage membership
boundary. Existing `listing_sync_runs`, `listing_source_observations`, and
`mls_source_promotion_tiers` store it atomically. No migration is required.

- Match the immutable observation's company reference plus sale to the current
  public offering. Reused numeric advert IDs cannot transfer a promotion to an
  old property. The new evidence namespace never rebinds old links or source state.
- Use only the newest complete healthy snapshot. Gold precedes pinned; source
  index order breaks ties before the six-card limit. Repeated company references
  produce one card using the strongest observed grade and that grade's position.
- Only source badge values are normalized. Exact `黃金置頂` / `黃金置頂盤` aliases
  mean gold; `置頂盤` means pinned. Titles containing these words do not qualify.
- Validate source, scope, sale, complete count, unique advert IDs, company refs,
  every observed badge, explicit original UTC capture time and freshness. A missing
  badge field is rejected; explicit null means a card was observed without a badge.
- Empty full inventory retires homepage membership without deleting historical
  evidence or withdrawing canonical listings. Older captures and same-time changed
  captures are rejected. Exact latest replay changes no capture dates.
- A snapshot expires after 36 hours. No snapshot, incomplete evidence, or an
  expired latest snapshot produces no gold cards; historical links never refill it.
  Existing public status, withdrawal, current-offering, corridor, and media gates
  remain in force. Ordinary inventory never fills this paid band.
- Property.hk exclusions use the same current paid membership. Public titles remain
  only「黃金必走盤」and「荀盤推介」; `src/routes/index.tsx` is unchanged.

## Refresh after merge: new approved input is required

**Merging code alone does not fetch today's inventory.** Prepare a fresh full
agent/540 sale index through the owner's existing licensed/manual capture path.
Do not introduce Firecrawl, direct HTTP, or another collector into the schedule.
The index must include every advertised sale card, not just the current six cards,
the paid subset, or the old 55-record publication capture. Reconcile its actual
count against the index (about 196 when Willy reported this).

The frozen `import_ready.frozen.json` can now contain this envelope:

```json
{
  "listings": [],
  "homepage_inventory": {
    "schema_version": 1,
    "source": "28hse_agent_540",
    "scope": "agent:540",
    "deal_type": "sale",
    "complete": true,
    "captured_at": "2026-10-27T01:00:00.000Z",
    "advertised_count": 2,
    "entries": [
      {
        "source_id": "1234567",
        "agent_listing_ref": "A000001",
        "promotion_tier_raw": "黃金置頂盤"
      },
      { "source_id": "1234568", "agent_listing_ref": "A000002", "promotion_tier_raw": null }
    ]
  }
}
```

This is synthetic format documentation, not production evidence. Use actual IDs,
references, badges, order, timestamp and count from the same complete capture.
`listings` may contain normal owner-publication records and their existing local
photos, or be empty for an inventory-only refresh. Index evidence does not create
or reactivate properties, refresh their prices/photos, clear staff decisions, or
replace listing-publication prerequisites. A newly advertised property needs its
normal approved content publication before it can appear publicly.

The SHA-256 confirmation covers the **whole envelope**, including index metadata.
Use the existing `import:28hse-owner` read-only dry-run first, then its approved
apply path with the exact same frozen input/hash and dedicated `IMPORT_*` target
and Blob settings. Inventory-only mode retains those existing authorization gates.
The report shows inventory capture time, count, grades, fingerprint and apply/replay
run ID. Index persistence commits independently before per-listing publication;
partial listing holds remain visible in the normal report. A lost COMMIT response
is an unknown outcome: reconcile with a read-only check before retrying.

For the existing 09:00 HKT job, include the envelope in the private
`owner-capture-<sha256>.tar.gz` bundle. Update the existing reviewed
`OWNER_PUBLICATION_INPUT_SHA256` and `OWNER_PUBLICATION_CAPTURE_ASSET` settings to
the new approved bundle using the established runbook. Keep all operator gates.
The scheduled CLI now requires inventory evidence and rejects missing/stale input
before constructing a database client. Legacy array captures remain supported for
manual listing publication but cannot refresh the homepage inventory.

The job **consumes** fresh owner evidence; it does not generate it. Continuing
freshness requires supplying a new approved full capture at least daily. Replaying
one old bundle daily cannot discover changes and fails its freshness check after
36 hours. With no fresh snapshot installed, this PR intentionally leaves the gold
band empty instead of asserting old paid inventory is current. Stage a valid bundle
and plan its first approved application with the rollout.

No production apply, scheduled dispatch, variable/secret changes, migration,
merge or deployment was performed in this task. Production remains unchanged.

## Verification

Local regression suites: MLS 649/649, property-sync 331/331, daily 73/73,
listing-priority 54/54, homepage 46/46, saved/owner import 31/31; zero skips.
TypeScript passes. ESLint has zero errors and nine existing component warnings.
The tests use synthetic fixtures and in-memory PGlite, including a real offline
writer → real homepage SQL flow, stale/empty/reused-ID snapshots, exact replay,
batch boundaries, late rollback and unknown commit acknowledgement.

The original selection regression failed with `GOLD-OLD` instead of the current
promoted `NORMAL` fixture before the repair. Full badge aliases and owner envelope
regressions also failed before implementation. No live refresh is claimed.
