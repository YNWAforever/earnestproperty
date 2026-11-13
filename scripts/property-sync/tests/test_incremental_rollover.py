"""Periodic cache verification must roll forward within the daily request budget."""
from copy import deepcopy

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
