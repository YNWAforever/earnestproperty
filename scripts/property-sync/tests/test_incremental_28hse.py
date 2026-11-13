"""Offline contract tests for index-delta-v1; no paid transport or production writes."""
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import tarfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping import incremental_28hse as inc
from scraping import worker

FIXTURES = Path(__file__).parent / "fixtures"
BEFORE = "2026-11-10T16:10:53.372064Z"
TODAY = "2026-11-11T16:10:53.372064Z"


def index(deal="sale", ident="1001", price="500", total=1, terminal=False):
    html = (FIXTURES / "28hse-incremental-index.sanitized.html").read_text(encoding="utf-8")
    html = html.replace("1001", ident).replace("$500", "$" + price)
    html = html.replace("共有 1 個", f"共有 {total} 個")
    if deal == "rent":
        html = (html.replace("/buy/", "/rent/").replace("放售樓盤", "放租樓盤")
                .replace("售 $", "租 $").replace("floated red large", "floated green large"))
    if terminal:
        html = html[:html.index('<div class="item property_item"')] + "沒有找到任何資料</body></html>"
    return html


def detail(deal="sale", ident="1001", price="500"):
    path = "buy" if deal == "sale" else "rent"
    url = f"{inc.ORIGIN}/{path}/apartment/property-{ident}"
    label, marker = ("售價", "售") if deal == "sale" else ("每月租金", "租")
    return f'''<!doctype html><html><head>
<meta property="og:url" content="{url}"><meta property="al:web:url" content="{url}">
<script type="application/ld+json">{{"dateModified":"2020-01-02","mainEntity":{{}}}}</script>
</head><body><h1>測試屋苑 {marker}${price}萬</h1><table class="tablePair">
<tr><td>{label}</td><td><div class="pairValue">{marker} ${price} 萬元</div></td></tr>
<tr><td>實用面積</td><td><div class="pairValue">500 平方呎</div></td></tr>
<tr><td>物業編號</td><td>A123456 (代理提供)</td></tr>
</table></body></html>'''


def fixtures():
    return {
        inc.ORIGIN + "/robots.txt": {"html": "User-agent: *\nAllow: /"},
        inc.index_url("sale", 1): {"html": index()},
        inc.index_url("sale", 2): {"html": index(terminal=True)},
        inc.index_url("rent", 1): {"html": index("rent", "2001")},
        inc.index_url("rent", 2): {"html": index("rent", "2001", terminal=True)},
        inc.ORIGIN + "/buy/apartment/property-1001": {"html": detail()},
        inc.ORIGIN + "/rent/apartment/property-2001": {"html": detail("rent", "2001")},
    }


def collected_cache():
    payload, report, evidence, cache = inc.collect_incremental(fixtures=fixtures(), now=BEFORE)
    assert report["success"], report
    return cache


def selected(payload):
    return payload["meta"]["incremental"]["selected_candidates"]


def test_unchanged_skips_all_detail_network_and_preserves_historical_raw_cache():
    cache = collected_cache()
    original = deepcopy(cache)
    source = fixtures()
    source.pop(inc.ORIGIN + "/buy/apartment/property-1001")
    source.pop(inc.ORIGIN + "/rent/apartment/property-2001")
    payload, report, evidence, proposed = inc.collect_incremental(cache, fixtures=source, now=TODAY)
    assert report["success"] is True
    assert report["unchanged_count"] == 2
    assert payload["listings"] == selected(payload) == []
    assert all("/property-" not in entry["url"] for entry in evidence["requests"])
    assert cache == original  # collection cannot advance an accepted cache
    for key, before in cache["entries"].items():
        after = proposed["entries"][key]
        assert after["detail_fetched_at"] == BEFORE
        assert after["detail_evidence"] == before["detail_evidence"]
        assert after["detail_record"] == before["detail_record"]
        assert after["index_seen_at"] == TODAY
        assert "last_error" not in after
        assert not after["pending_retry"]


def test_relative_age_views_rank_and_card_order_are_not_fingerprint_facts():
    first = worker.parse_28_index(index(), "sale")[0][0]
    changed_html = index().replace("1 小時前", "3 日前").replace("瀏覽 12 次", "瀏覽 999 次").replace('data-rank="1"', 'data-rank="99"')
    second = worker.parse_28_index(changed_html, "sale")[0][0]
    assert inc.card_fingerprint(first) == inc.card_fingerprint(second)
    source = fixtures()
    source[inc.index_url("sale", 1)]["html"] = changed_html
    assert inc.collect_incremental(collected_cache(), fixtures=source, now=TODAY)[1]["selected_count"] == 0


@pytest.mark.parametrize("old,new", [
    ("$500", "$480"), ("500 呎", "510 呎"), ("測試屋苑 高層", "測試屋苑 有匙"),
    ("1座 高層", "1座 中層"), ("私人屋苑", "連天台"), ("置頂", "黃金"),
])
def test_observable_card_changes_select_existing_id(old, new):
    source = fixtures()
    source[inc.index_url("sale", 1)]["html"] = index().replace(old, new)
    payload, report, evidence, proposed = inc.collect_incremental(collected_cache(), fixtures=source, now=TODAY)
    assert report["success"]
    assert [(row["property_id"], row["deal_type"]) for row in payload["listings"]] == [("1001", "sale")]
    assert selected(payload)[0]["reasons"] == ["changed"]
    assert sum("/property-" in entry["url"] for entry in evidence["requests"]) == 1
    assert proposed["entries"][inc.key_for(payload["listings"][0])]["detail_fetched_at"] == TODAY


def test_changed_rent_green_price_fetches_existing_advertisement():
    source = fixtures()
    source[inc.index_url("rent", 1)]["html"] = index("rent", "2001", price="480")
    payload, report, _, _ = inc.collect_incremental(collected_cache(), fixtures=source, now=TODAY)
    assert report["success"]
    assert [(row["property_id"], row["deal_type"]) for row in payload["listings"]] == [("2001", "rent")]
    assert selected(payload)[0]["reasons"] == ["changed"]


def test_new_ids_and_sale_rent_same_ad_id_remain_distinct():
    cache = collected_cache()
    source = fixtures()
    source[inc.index_url("rent", 1)]["html"] = index("rent", "1001")
    source[inc.ORIGIN + "/rent/apartment/property-1001"] = {"html": detail("rent", "1001")}
    payload, report, evidence, proposed = inc.collect_incremental(cache, fixtures=source, now=TODAY)
    assert report["success"]
    assert [(row["property_id"], row["deal_type"]) for row in payload["listings"]] == [("1001", "rent")]
    assert selected(payload)[0]["reasons"] == ["new"]
    assert inc.key_for({"property_id": "1001", "deal_type": "sale"}) in proposed["entries"]
    assert inc.key_for({"property_id": "1001", "deal_type": "rent"}) in proposed["entries"]
    assert payload["meta"]["incremental"]["withdrawal_candidates"][0]["property_id"] == "2001"
    assert payload["meta"]["eligible_for_absence"] is False


def test_duplicate_listing_across_distinct_pages_fetches_detail_once():
    source = fixtures()
    two = index(total=2)
    card = index(ident="1002")[index().index('<div class="item property_item"'):].replace("</body></html>", "")
    source[inc.index_url("sale", 1)]["html"] = two.replace("</body></html>", card + "</body></html>")
    source[inc.index_url("sale", 2)]["html"] = index(total=2)
    source[inc.index_url("sale", 3)] = {"html": index(total=2, terminal=True)}
    source[inc.ORIGIN + "/buy/apartment/property-1002"] = {"html": detail(ident="1002")}
    payload, report, evidence, _ = inc.collect_incremental(fixtures=source, now=TODAY)
    assert report["success"]
    detail_urls = [entry["url"] for entry in evidence["requests"] if "/property-" in entry["url"]]
    assert len(detail_urls) == len(set(detail_urls)) == 3
    assert len(next(row for row in payload["listings"] if row["property_id"] == "1001")["occurrences"]) == 2


def test_failed_fetch_retains_known_raw_detail_and_retries_unchanged_next_run():
    cache = collected_cache()
    key = inc.key_for({"property_id": "1001", "deal_type": "sale"})
    source = fixtures()
    source[inc.index_url("sale", 1)]["html"] = index(price="480")
    source[inc.ORIGIN + "/buy/apartment/property-1001"] = {"status": 403}
    payload, report, _, failed = inc.collect_incremental(cache, fixtures=source, now=TODAY)
    assert report["success"] is False
    assert selected(payload)[0]["status"] == "error"
    assert failed["entries"][key]["detail_fetched_at"] == BEFORE
    assert failed["entries"][key]["detail_record"] == cache["entries"][key]["detail_record"]
    source[inc.ORIGIN + "/buy/apartment/property-1001"] = {"html": detail(price="480")}
    payload, report, _, retried = inc.collect_incremental(failed, fixtures=source, now=TODAY)
    assert report["success"]
    assert selected(payload)[0]["reasons"] == ["changed", "retry"]
    assert retried["entries"][key]["pending_retry"] is False
    assert "last_error" not in retried["entries"][key]


def test_rolling_ttl_selects_only_entries_expiring_at_boundary_and_is_configurable():
    cache = collected_cache()
    sale_key = inc.key_for({"property_id": "1001", "deal_type": "sale"})
    cache["entries"][sale_key]["detail_fetched_at"] = "2026-11-04T16:10:53.372064Z"
    payload, report, _, _ = inc.collect_incremental(cache, fixtures=fixtures(), now=TODAY)
    assert report["success"]
    assert len(selected(payload)) == 1
    assert selected(payload)[0]["reasons"] == ["cache_expired"]
    assert inc.collect_incremental(cache, fixtures=fixtures(), now=TODAY, ttl_days=8)[1]["selected_count"] == 0


@pytest.mark.parametrize("failure", ["missing_terminal", "count_mismatch", "count_changed", "company", "loop"])
def test_incomplete_index_blocks_detail_and_full_authority(failure):
    source = fixtures()
    if failure == "missing_terminal":
        source.pop(inc.index_url("rent", 2))
    elif failure == "count_mismatch":
        for page in (1, 2):
            source[inc.index_url("sale", page)]["html"] = index(total=2, terminal=page == 2)
    elif failure == "count_changed":
        source[inc.index_url("sale", 2)]["html"] = index(total=2, terminal=True)
    elif failure == "company":
        source[inc.index_url("sale", 1)]["html"] = index().replace("C-018613", "C-000000")
    elif failure == "loop":
        source[inc.index_url("sale", 2)]["html"] = index()
    payload, report, evidence, proposed = inc.collect_incremental(fixtures=source, now=TODAY)
    assert not report["success"]
    assert not report["index_complete"]
    assert not payload["meta"]["crawl_complete"]
    assert not payload["meta"]["full_snapshot"]
    assert not payload["meta"]["eligible_for_absence"]
    assert not worker.collection_page_proof(payload)
    assert payload["listings"] == []
    assert not any("/property-" in entry["url"] for entry in evidence["requests"])
    assert payload["meta"]["incremental"]["withdrawal_candidates"] == []


def test_unrecognized_card_price_structure_fails_closed_before_detail_fetches():
    source = fixtures()
    source[inc.index_url("rent", 1)]["html"] = index("rent", "2001").replace("floated green large label", "floated changed-template")
    payload, report, evidence, _ = inc.collect_incremental(collected_cache(), fixtures=source, now=TODAY)
    assert not report["success"]
    assert not report["index_complete"]
    assert any(error["reason"] == "index_card_price_unobserved" for error in report["errors"])
    assert not payload["listings"]
    assert not any("/property-" in entry["url"] for entry in evidence["requests"])


def test_daily_membership_does_not_claim_source_updated_timestamp():
    payload, report, _, cache = inc.collect_incremental(fixtures=fixtures(), now=TODAY)
    assert report["success"]
    for row in payload["listings"]:
        assert row["source_updated_at"] is None
        assert row["raw_payload"]["incremental"]["source_updated_at_status"] == "unknown"
        assert row["raw_payload"]["json_ld"]["dateModified"] == "2020-01-02"
        assert row["agency_property_no"] == "A123456"
        assert row["detail_fetched_at"] == row["index_seen_at"] == TODAY
    assert all(entry["source_updated_at"] is None for entry in cache["entries"].values())


def test_detail_cap_carries_pending_and_does_not_refetch_accepted_first_batch():
    payload, report, evidence, proposed = inc.collect_incremental(fixtures=fixtures(), now=TODAY, max_detail=1)
    assert report["index_complete"]
    assert not report["success"]
    assert report["fetched_count"] == report["pending_count"] == 1
    assert report["full_snapshot"] is False
    assert len([entry for entry in evidence["requests"] if "/property-" in entry["url"]]) == 1
    assert any(row.get("reason") == "max_detail_cap" for row in selected(payload))
    payload, report, _, _ = inc.collect_incremental(proposed, fixtures=fixtures(), now=TODAY, max_detail=1)
    assert report["success"]
    assert report["fetched_count"] == report["unchanged_count"] == 1


def test_provider_budget_counts_internal_attempts_and_stops_before_paid_request():
    calls = []
    budget = inc.RequestBudget(2, lambda *args, **kwargs: calls.append(args) or (402, {}, b"{}"))
    budget("https://provider.invalid")
    budget("https://provider.invalid")
    with pytest.raises(worker.WorkerError, match="request_budget_exhausted"):
        budget("https://provider.invalid")
    assert len(calls) == budget.used == 2


def test_network_budget_bounds_whole_collector_without_provider_credentials():
    calls = []
    source = fixtures()
    def request(url, *args, **kwargs):
        calls.append(url)
        return 200, {}, source[url]["html"].encode()
    payload, report, _, _ = inc.collect_incremental(now=TODAY, transport="http", request=request,
                                                   sleep=lambda _: None, max_requests=3)
    assert len(calls) == report["requests_used"] == 3
    assert not report["success"]
    assert report["fetched_count"] == 0
    assert any(error["reason"] == "request_budget_exhausted" for error in report["errors"])


def baseline_and_raw():
    payload, report, evidence, _ = inc.collect_incremental(fixtures=fixtures(), now=BEFORE)
    assert report["success"]
    # Historical approved full payload has every detail plus original page proof.
    baseline = deepcopy(payload)
    baseline["meta"].pop("incremental")
    baseline["meta"]["full_snapshot"] = True
    baseline["meta"]["eligible_for_absence"] = True
    for page in baseline["meta"]["pages"]:
        page["details_complete"] = True
    return baseline, evidence


def test_bootstrap_reuses_original_capture_time_and_never_fakes_a_fresh_snapshot():
    baseline, raw = baseline_and_raw()
    cache = inc.bootstrap_cache(baseline, raw)
    assert cache["bootstrap"]["detail_fetched_at"] == BEFORE
    assert len(cache["entries"]) == 2
    for entry in cache["entries"].values():
        assert entry["detail_fetched_at"] == entry["index_seen_at"] == BEFORE
        assert entry["detail_record"]["agency_property_no"] == "A123456"
        assert len(entry["detail_evidence"]["body_sha256"]) == 64
    payload, report, _, proposed = inc.collect_incremental(cache, fixtures=fixtures(), now=TODAY)
    assert report["success"]
    assert payload["listings"] == []
    assert all(entry["detail_fetched_at"] == BEFORE for entry in proposed["entries"].values())
    assert not payload["meta"]["full_snapshot"]


@pytest.mark.parametrize("mutation", ["missing_raw", "wrong_id", "incomplete", "missing_detail"])
def test_bootstrap_refuses_unverified_or_mismatched_evidence(mutation):
    baseline, raw = baseline_and_raw()
    if mutation == "missing_raw":
        raw["requests"] = [entry for entry in raw["requests"] if "/agent/540" not in entry["url"]]
    elif mutation == "wrong_id":
        raw["requests"][1]["html"] = index(ident="9999")
    elif mutation == "incomplete":
        baseline["meta"]["crawl_complete"] = False
    elif mutation == "missing_detail":
        raw["requests"] = [entry for entry in raw["requests"] if "/property-" not in entry["url"]]
    with pytest.raises(worker.WorkerError, match="bootstrap_"):
        inc.bootstrap_cache(baseline, raw)


def test_cli_writes_four_outputs_and_never_overwrites_accepted_cache(tmp_path):
    accepted = tmp_path / "accepted.json"
    contents = json.dumps(collected_cache())
    accepted.write_text(contents, encoding="utf-8")
    fixture = tmp_path / "fixtures.json"
    fixture.write_text(json.dumps(fixtures()), encoding="utf-8")
    output = tmp_path / "output"
    assert inc.cli(["--cache", str(accepted), "--fixtures", str(fixture), "--output-dir", str(output),
                    "--now", TODAY]) == 0
    assert {path.name for path in output.iterdir()} == {"request.json", "report.json", "evidence.json", "cache-next.json"}
    assert json.loads((output / "request.json").read_text(encoding="utf-8"))["listings"] == []
    assert accepted.read_text(encoding="utf-8") == contents


@pytest.mark.parametrize("name", ["request.json", "report.json", "evidence.json", "cache-next.json"])
def test_cli_rejects_output_collision_without_mutating_accepted_cache(tmp_path, name):
    accepted = tmp_path / name
    contents = json.dumps(collected_cache())
    accepted.write_text(contents, encoding="utf-8")
    assert inc.cli(["--cache", str(accepted), "--output-dir", str(tmp_path)]) == 1
    assert accepted.read_text(encoding="utf-8") == contents


@pytest.mark.parametrize("limit", [1, 2, 5, 6])
def test_fixture_budget_counts_robots_and_every_source_attempt(limit):
    _, report, evidence, _ = inc.collect_incremental(fixtures=fixtures(), now=TODAY, max_requests=limit)
    assert report["requests_used"] <= limit
    assert len(evidence["requests"]) <= limit
    assert report["success"] is False


def test_explicit_pending_error_retries_even_when_observable_card_is_unchanged():
    cache = collected_cache()
    entry = cache["entries"][inc.key_for({"property_id": "1001", "deal_type": "sale"})]
    entry["pending_retry"] = True
    entry["last_error"] = {"reason": "network_failed", "attempted_at": BEFORE}
    payload, report, _, _ = inc.collect_incremental(cache, fixtures=fixtures(), now=TODAY)
    assert report["success"]
    assert selected(payload)[0]["reasons"] == ["retry"]


def test_archive_reader_uses_bounded_members_without_extraction(tmp_path):
    baseline, raw = baseline_and_raw()
    archive_path = tmp_path / "accepted.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        data = json.dumps(baseline).encode()
        member = tarfile.TarInfo("baseline/request.json")
        member.size = len(data)
        archive.addfile(member, io.BytesIO(data))
        malicious = tarfile.TarInfo("../outside.json")
        malicious.size = 2
        archive.addfile(malicious, io.BytesIO(b"{}"))
    assert inc.read_json_input(archive_path) == baseline
    with pytest.raises(worker.WorkerError, match="unsafe_bootstrap_archive_member"):
        inc.read_json_input(archive_path, archive_member="../outside.json")
    assert not (tmp_path / "outside.json").exists()
