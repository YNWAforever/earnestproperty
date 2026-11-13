"""Periodic cache verification must roll forward within the daily request budget."""
from copy import deepcopy
from datetime import timedelta

from test_incremental_28hse import collected_cache, fixtures, index, BEFORE
from scraping import incremental_28hse as inc


def test_simultaneously_expired_cache_rolls_across_successful_days_without_full_refetch():
    original = collected_cache()
    before = deepcopy(original)
    first = "2026-11-19T16:10:53.372064Z"
    payload, report, _, cache = inc.collect_incremental(
        original, fixtures=fixtures(), now=first, max_detail=1, max_refresh=1)
    assert report["success"] is True
    assert report["fetched_count"] == 1
    assert report["candidate_counts"] == {"new": 0, "changed": 0, "retry": 0, "cache_expired": 1}
    assert report["sale_ids_seen"] == report["rent_ids_seen"] == 1
    assert report["index_pages_verified"] == 4
    assert report["last_fresh_detail_at"] == first
    assert report["pending_count"] == 0
    assert report["deferred_refresh_count"] == 1
    assert original == before
    assert sorted(entry["detail_fetched_at"] for entry in cache["entries"].values()) == [BEFORE, first]
    second = "2026-11-20T16:10:53.372064Z"
    next_payload, next_report, _, next_cache = inc.collect_incremental(
        cache, fixtures=fixtures(), now=second, max_detail=1, max_refresh=1)
    assert next_report["success"] is True
    assert next_report["fetched_count"] == 1
    assert next_report["deferred_refresh_count"] == 0
    assert payload["listings"][0]["property_id"] != next_payload["listings"][0]["property_id"]
    assert all(entry["detail_fetched_at"] != BEFORE for entry in next_cache["entries"].values())


def test_changed_rent_has_priority_over_unchanged_periodic_sale_verification():
    source = fixtures()
    source[inc.index_url("rent", 1)]["html"] = index("rent", "2001", price="480")
    payload, report, _, cache = inc.collect_incremental(collected_cache(), fixtures=source,
        now="2026-11-19T16:10:53.372064Z", max_detail=1, max_refresh=1)
    assert report["success"] is True
    assert [(row["property_id"], row["deal_type"]) for row in payload["listings"]] == [("2001", "rent")]
    assert report["deferred_refresh_count"] == 1
    assert cache["entries"]["28hse:agent:540:sale:1001"]["detail_fetched_at"] == BEFORE


def test_reappearing_unchanged_card_fetches_fresh_detail_before_cache_expiry():
    original = collected_cache()
    missing = fixtures()
    missing[inc.index_url("sale", 1)]["html"] = index(terminal=True, total=0)
    for url in list(missing):
        if "/property-" in url:
            del missing[url]
    first = (inc.instant(BEFORE) + timedelta(days=1)).isoformat()
    _, absent_report, _, absent_cache = inc.collect_incremental(original, fixtures=missing, now=first)
    assert absent_report["success"] is True
    assert absent_report["fetched_count"] == 0
    assert absent_report["withdrawal_candidate_count"] == 1
    assert absent_cache["entries"]["28hse:agent:540:sale:1001"]["detail_record"] == original["entries"]["28hse:agent:540:sale:1001"]["detail_record"]

    returned = fixtures()
    returned[inc.ORIGIN + "/buy/apartment/property-1001"]["html"] = returned[inc.ORIGIN + "/buy/apartment/property-1001"]["html"].replace("$500", "$495")
    second = (inc.instant(BEFORE) + timedelta(days=2)).isoformat()
    payload, report, evidence, cache = inc.collect_incremental(absent_cache, fixtures=returned,
        now=second, max_detail=1, max_refresh=0)
    assert report["success"] is True
    assert report["candidate_counts"] == {"new": 0, "changed": 0, "retry": 1, "cache_expired": 0}
    assert [(row["property_id"], row["deal_type"]) for row in payload["listings"]] == [("1001", "sale")]
    assert sum("/property-" in row["url"] for row in evidence["requests"]) == 1
    assert float(payload["listings"][0]["price"]) == 4_950_000
    assert inc.instant(cache["entries"]["28hse:agent:540:sale:1001"]["detail_fetched_at"]) == inc.instant(second)
    assert cache["entries"]["28hse:agent:540:rent:2001"]["detail_fetched_at"] == BEFORE
    _, next_report, _, _ = inc.collect_incremental(cache, fixtures=returned,
        now=(inc.instant(BEFORE) + timedelta(days=3)).isoformat(), max_refresh=0)
    assert next_report["selected_count"] == 0
