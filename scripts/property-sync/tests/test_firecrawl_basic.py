"""Exercise the real provider adapter and collection gates at the HTTP boundary."""
import base64
import copy
import importlib
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping import worker as w
from scraping.checkpoint import Checkpoint

ORIGIN = "https://www.28hse.com"
SALE = ORIGIN + "/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0"
DETAIL = ORIGIN + "/buy/apartment/property-100"
API = "https://api.firecrawl.dev/v2/scrape"
HTML = "<!doctype html><html><head></head><body><h1>Complete source document</h1></body></html>"


def module():
    assert (Path(__file__).parents[1] / "scraping/firecrawl.py").exists(), "Firecrawl basic adapter is missing"
    return importlib.import_module("scraping.firecrawl")


def response(url, html=HTML, source_status=200):
    field = "markdown" if url.endswith("/robots.txt") else "rawHtml"
    return {
        "success": True,
        "data": {
            field: html,
            "metadata": {"sourceURL": url, "url": url, "statusCode": source_status, "proxyUsed": "basic"},
        },
    }


def transport(monkeypatch, data=None, status=200, checkpoint=None):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-only-provider-key")

    def request(endpoint, payload, token):
        assert endpoint == API
        assert token == "test-only-provider-key"
        options = json.loads(payload)
        assert options["proxy"] == "basic"
        assert options["maxAge"] == 0
        assert options["storeInCache"] is False
        assert options["skipTlsVerification"] is False
        assert options["onlyMainContent"] is False
        assert options["formats"] == ["rawHtml"]
        assert options["url"] == SALE
        return status, {}, json.dumps(data if data is not None else response(SALE)).encode()

    return module().FirecrawlBasic(request=request, checkpoint=checkpoint)


def test_basic_transport_returns_full_raw_document_and_keeps_provider_bytes(monkeypatch, tmp_path):
    checkpoint = Checkpoint(tmp_path / "run", source="28hse", scope="agent:540", run_id="test")
    provider = transport(monkeypatch, checkpoint=checkpoint)
    status, headers, body = provider(SALE)
    assert status == 200 and headers == {} and body == HTML.encode()
    raw = json.dumps(response(SALE)).encode()
    assert (tmp_path / "run/provider-responses/000001.body").read_bytes() == raw
    assert base64.b64decode(provider.evidence[0]["body_base64"]) == raw
    assert "test-only-provider-key" not in json.dumps(provider.evidence)
    progress = json.loads((tmp_path / "run/progress.json").read_bytes())
    assert progress["provider_responses"] == 1 and progress["full"] is False


@pytest.mark.parametrize("url", [
    "https://evil.example/agent/540",
    ORIGIN + "/agent/999",
    ORIGIN + "/agent/540?buyRent=buy&page=1&plan_id=999&propertyDoSearchVersion=2.0",
    SALE + "&buyRent=rent",
    SALE + "&search_words_thing=other",
    DETAIL + "?tracking=1",
    ORIGIN + "/robots.txt?other=1",
])
def test_provider_rejects_unapproved_scope_before_http(monkeypatch, url):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-only-key")
    def forbidden(*args):
        pytest.fail("Out-of-scope URL reached provider")
    provider = module().FirecrawlBasic(request=forbidden)
    with pytest.raises(w.WorkerError, match="firecrawl_scope"):
        provider(url)


@pytest.mark.parametrize("key,value", [
    ("sourceURL", ORIGIN + "/agent/999"),
    ("url", SALE + "&page=2"),
    ("url", "https://evil.example/agent/540"),
    ("proxyUsed", "auto"),
    ("proxyUsed", "enhanced"),
    ("proxyUsed", None),
    ("statusCode", True),
    ("statusCode", "200"),
    ("cached", True),
    ("cacheState", "hit"),
    ("error", "Provider failed; test-only-provider-key"),
])
def test_provider_metadata_conflicts_fail_closed_without_losing_raw(monkeypatch, tmp_path, key, value):
    data = response(SALE)
    data["data"]["metadata"][key] = value
    checkpoint = Checkpoint(tmp_path / "run", source="28hse", scope="agent:540", run_id="test")
    provider = transport(monkeypatch, data, checkpoint=checkpoint)
    with pytest.raises(w.WorkerError, match="firecrawl_") as error:
        provider(SALE)
    assert "test-only-provider-key" not in str(error.value)
    assert (tmp_path / "run/provider-responses/000001.body").read_bytes() == json.dumps(data).encode()
    assert not (tmp_path / "run/final.json").exists()


@pytest.mark.parametrize("data", [
    {"success": False},
    {"success": True, "data": {}},
    {"success": True, "data": {**response(SALE)["data"], "rawHtml": ""}},
    {"success": True, "data": {**response(SALE)["data"], "rawHtml": "<h1>Cleaned excerpt only</h1>"}},
    {"success": True, "data": {**response(SALE)["data"], "rawHtml": HTML.replace("Complete", "100 tokens truncated")}},
    {"success": True, "data": {**response(SALE)["data"], "warning": "Partial document"}},
])
def test_incomplete_or_failed_provider_output_never_becomes_html(monkeypatch, data):
    with pytest.raises(w.WorkerError, match="firecrawl_"):
        transport(monkeypatch, data)(SALE)


def test_missing_key_never_falls_back_to_direct_or_another_proxy(monkeypatch):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    def forbidden(*args):
        pytest.fail("Missing provider key attempted a request")
    with pytest.raises(w.WorkerError, match="firecrawl_key_required"):
        module().FirecrawlBasic(request=forbidden)(SALE)


def provider_crawl(monkeypatch, tmp_path, *, change=None, max_pages=3, cli=False):
    cfg, fixtures = w.synthetic_fixture("28hse")
    cfg.update(transport="firecrawl-basic", max_pages=max_pages)
    # Parser identity is exercised with modern detail bodies, not synthetic roots.
    for deal, source_id in (("sale", "100"), ("rent", "200")):
        path, captured_id = ("buy", "4054123") if deal == "sale" else ("rent", "4048371")
        html = (Path(__file__).parent / "fixtures" / f"28hse-modern-{deal}-structure.html").read_text(encoding="utf-8")
        fixtures[f"{ORIGIN}/{path}/apartment/property-{source_id}"]["html"] = html.replace(captured_id, source_id)
    if change:
        change(fixtures)
    requests = []
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-only-provider-key")
    monkeypatch.setattr(w.time, "sleep", lambda seconds: None)

    def request(endpoint, payload=None, token=None):
        assert endpoint == API, "Firecrawl configuration used direct HTTP"
        assert token == "test-only-provider-key"
        options = json.loads(payload)
        assert options["proxy"] == "basic" and options["maxAge"] == 0
        url = options["url"]
        requests.append(url)
        source = fixtures.get(url, {"status": 403, "html": "<h1>Access denied</h1>"})
        html = source.get("html", "")
        if not url.endswith("/robots.txt") and not html.startswith("<!"):
            html = "<!doctype html><html><head></head><body>" + html + "</body></html>"
        return 200, {}, json.dumps(response(url, html, source.get("status", 200))).encode()

    monkeypatch.setattr(w, "http_request", request)
    monkeypatch.setattr(module(), "http_request", request)
    def no_write(*args, **kwargs):
        pytest.fail("Dry-run reached a submission, publication or baseline writer")
    monkeypatch.setattr(w, "submit", no_write)
    monkeypatch.setattr(w, "replay_bridge", no_write)
    monkeypatch.setattr(w, "advance_baseline", no_write)
    if cli:
        cfg["transport"] = "http"
        config = tmp_path / "config.json"
        config.write_text(json.dumps({"sources": {"28hse": cfg}}), encoding="utf-8")
        monkeypatch.setenv("PROPERTY_SYNC_28HSE_TRANSPORT", "firecrawl-basic")
        monkeypatch.setattr(sys, "argv", ["collector", "--config", str(config), "--root", str(tmp_path / "out"), "--dry-run"])
        assert w.cli("28hse") == 0
        snapshots = list((tmp_path / "out").rglob("request.json"))
        return json.loads(snapshots[0].read_bytes()), requests
    result = w.run("28hse", cfg, tmp_path / "out", dry_run=True)
    payload = json.loads((Path(result["snapshot"]) / "request.json").read_bytes())
    return result, payload, requests


def test_complete_basic_collection_requires_both_terminal_pages_and_keeps_evidence(monkeypatch, tmp_path):
    result, payload, requests = provider_crawl(monkeypatch, tmp_path)
    assert result["status"] == "dry_run" and result["baseline_advanced"] is False
    assert payload["meta"]["crawl_complete"] is True
    assert w.gate(payload, None)["full"] is True
    assert len(payload["listings"]) == 2
    assert {row["price"] for row in payload["listings"] if row["deal_type"] == "sale"} == {"20800000"}
    assert {row["rent"] for row in payload["listings"] if row["deal_type"] == "rent"} == {"18600"}
    assert requests[0] == ORIGIN + "/robots.txt"
    assert len(requests) == 7
    assert not list(tmp_path.rglob("baseline.json"))
    assert len(list(tmp_path.rglob("provider-responses/*.body"))) == 7
    raw = json.loads((Path(result["snapshot"]) / "raw-evidence.json").read_bytes())
    assert len(raw["provider_requests"]) == 7
    assert all(entry["request"]["proxy"] == "basic" for entry in raw["provider_requests"])


@pytest.mark.parametrize("failure", ["detail_403", "missing_rent", "ceiling", "loop", "robots", "structured_excerpt"])
def test_partial_basic_collection_is_not_full_and_cannot_submit(monkeypatch, tmp_path, failure):
    def change(fixtures):
        if failure == "detail_403":
            fixtures[DETAIL]["status"] = 403
        if failure == "missing_rent":
            url = SALE.replace("buyRent=buy", "buyRent=rent")
            fixtures[url]["status"] = 403
        if failure == "loop":
            fixtures[SALE.replace("page=1", "page=2")] = copy.deepcopy(fixtures[SALE])
        if failure == "robots":
            fixtures[ORIGIN + "/robots.txt"]["html"] = "User-agent: *\nDisallow: /"
        if failure == "structured_excerpt":
            fixtures[DETAIL]["html"] = '<main data-listing-detail><table><tr><td>price</td><td>$100</td></tr></table></main>'
    result, payload, requests = provider_crawl(
        monkeypatch, tmp_path, change=change, max_pages=1 if failure == "ceiling" else 3
    )
    assert result["status"] == "rejected_incomplete"
    assert w.gate(payload, None)["allowed"] is False
    assert w.gate(payload, None)["full"] is False
    assert payload["meta"]["eligible_for_absence"] is False
    assert not list(tmp_path.rglob("baseline.json"))
    if failure == "robots":
        assert requests == [ORIGIN + "/robots.txt"]


def test_claimed_complete_metadata_cannot_replace_missing_page_proof(monkeypatch, tmp_path):
    _, payload, _ = provider_crawl(monkeypatch, tmp_path)
    payload["meta"]["pages"] = [p for p in payload["meta"]["pages"] if p["status"] != "terminal"]
    decision = w.gate(payload, None)
    assert decision["allowed"] is False and decision["full"] is False
    assert "incomplete_page_evidence" in decision["reasons"]


def test_cli_transport_override_uses_basic_without_production_writes(monkeypatch, tmp_path):
    payload, requests = provider_crawl(monkeypatch, tmp_path, cli=True)
    assert payload["meta"]["crawl_complete"] is True
    assert len(requests) == 7


@pytest.mark.parametrize("source,value", [("28hse", "auto"), ("28hse", "firecrawl"), ("propertyhk", "firecrawl-basic")])
def test_unsupported_transport_fails_configuration(source, value):
    cfg, _ = w.synthetic_fixture(source)
    cfg["transport"] = value
    with pytest.raises(w.WorkerError, match="configuration_transport"):
        w.validate_config(source, cfg)


@pytest.mark.parametrize("provider_status,attempts", [(401, 1), (403, 1), (429, 1), (503, 3)])
def test_provider_failures_obey_fetcher_attempt_budget_without_fallback(monkeypatch, provider_status, attempts):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-only-key")
    calls = []
    def request(endpoint, payload, token):
        assert endpoint == API
        calls.append(json.loads(payload))
        return provider_status, {}, b'{"success":false,"error":"Unavailable"}'
    provider = module().FirecrawlBasic(request=request)
    fetcher = w.Fetcher(ORIGIN, [r"/agent/540"], sleep=lambda seconds: None, transport=provider)
    with pytest.raises(w.WorkerError, match="blocked|network_failed"):
        fetcher.get(SALE)
    assert len(calls) == attempts
    assert all(options["proxy"] == "basic" for options in calls)
    assert all(options["url"] == ORIGIN + "/robots.txt" for options in calls)
