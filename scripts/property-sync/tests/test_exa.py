"""Exercise the Exa adapter using HTTP-boundary doubles, never a paid API."""
import copy
import importlib
import io
import json
import sys
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from http.client import HTTPException, IncompleteRead

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
URL = "https://www.property.hk/asking_detail/00101.html"
URL2 = "https://www.property.hk/asking_detail/00102.html"
NOW = datetime(2026, 10, 16, tzinfo=timezone.utc)


def module():
    assert (Path(__file__).parents[1] / "scraping/exa.py").exists(), "Exa adapter missing"
    return importlib.import_module("scraping.exa")


def scope():
    return {
        "query_id": "q1", "branch_id": "SYNTHETIC-A", "branch_labels": ["SYNTHETIC-A"],
        "estate_terms": ["Synthetic Gardens"], "district_terms": ["Synthetic District"],
        "query_terms": ["SYNTHETIC-A", "Synthetic Gardens"],
    }


def envelope(urls=(URL,)):
    return {
        "requestId": "synthetic-request",
        "results": [{"id": f"opaque-document-{i}", "url": url, "text": "# Listing details\nEstate: Synthetic",
                     "publishedDate": "2026-10-01T00:00:00Z"} for i, url in enumerate(urls)],
        "statuses": [{"id": url, "status": "success", "source": "crawled"} for url in urls],
        "costDollars": {"total": len(urls) / 1000},
    }


def client_for(payload=None, *, token=None, status=200, headers=None, request=None, **kwargs):
    recorded = []

    def fake(endpoint, body, given_token, *, timeout_seconds, max_bytes):
        recorded.append((endpoint, json.loads(body)))
        assert given_token == token and timeout_seconds <= 20 and max_bytes <= 2097152
        if request:
            return request(endpoint, body, given_token, timeout_seconds=timeout_seconds, max_bytes=max_bytes)
        body = payload if payload is not None else envelope(json.loads(body).get("urls", [URL]))
        return status, headers or {"x-request-id": "synthetic-header"}, body if isinstance(body, bytes) else json.dumps(body).encode()

    m = module()
    client = m.ExaClient(request=fake, now=lambda: NOW, monotonic=lambda: 0.0, sleep=lambda _: None,
                         limits={}, token=token, **kwargs)
    return client, recorded


def test_request_shapes_and_separate_discovery_contents():
    client, recorded = client_for()
    discovery = client.discover(scope())
    assert recorded[0] == ("https://api.exa.ai/search", {
        "query": "SYNTHETIC-A Synthetic Gardens", "type": "fast",
        "includeDomains": ["property.hk"], "numResults": 5,
    })
    assert discovery["results"][0]["source_advertisement_id"] == "00101"
    assert "text" not in discovery["results"][0]
    result = client.contents([URL])
    assert recorded[1] == ("https://api.exa.ai/contents", {
        "urls": [URL], "text": True, "maxAgeHours": 0, "subpages": 0,
    })
    assert result["pages"][0]["text"].startswith("# Listing details")
    assert result["pages"][0]["provider"]["provider_document_id"] == "opaque-document-0"


def test_contents_checks_each_url_not_http_200():
    payload = json.loads((Path(__file__).parent / "fixtures/propertyhk-exa/provider/contents-partial.json").read_text())
    client, _ = client_for(payload)
    result = client.contents([URL, URL2])
    assert [x["status"] for x in result["pages"]] == ["success", "error"]
    assert result["pages"][1]["text"] is None
    assert result["stop_reason"] is None


@pytest.mark.parametrize("change", ["missing_status", "duplicate_status", "missing_result", "duplicate_result", "empty_text", "wrong_id", "foreign"])
def test_missing_duplicate_or_mismatched_output_never_becomes_text(change):
    payload = envelope()
    if change == "missing_status":
        payload["statuses"] = []
    elif change == "duplicate_status":
        payload["statuses"] *= 2
    elif change == "missing_result":
        payload["results"] = []
    elif change == "duplicate_result":
        payload["results"] *= 2
    elif change == "empty_text":
        payload["results"][0]["text"] = ""
    elif change == "wrong_id":
        payload["results"][0]["url"] = URL2
    else:
        payload["results"][0]["url"] = "https://evil.invalid/asking_detail/00101.html"
    client, _ = client_for(payload)
    assert client.contents([URL])["pages"][0]["text"] is None


def test_provider_metadata_does_not_impersonate_origin():
    payload = envelope()
    payload["statuses"][0]["source"] = "cached"
    client, _ = client_for(payload)
    page = client.contents([URL])["pages"][0]
    provider = page["provider"]
    assert provider["status_source"] == "cached"
    assert provider["body_request_id"] == "synthetic-request"
    assert provider["header_request_id"] == "synthetic-header"
    assert provider["provider_estimated_published_date"] == "2026-10-01T00:00:00Z"
    assert "origin_status" not in provider and "html" not in page
    assert "provider_request_id_mismatch" in page["reasons"]


def test_discovery_filters_foreign_urls_and_does_not_follow_links():
    payload = envelope()
    payload["results"] += [{"url": "https://evil.invalid/x", "text": "follow me", "links": [URL2]}]
    client, recorded = client_for(payload)
    result = client.discover(scope())
    assert len(result["results"]) == 1 and len(result["rejected_results"]) == 1
    assert len(recorded) == 1 and "text" not in result["results"][0]


@pytest.mark.parametrize("raw", [
    b'{"requestId":"one","requestId":"two","results":[],"statuses":[]}',
    b'[]', b'{"results":true,"statuses":[]}', b'{"results":[],"statuses":false}',
    b'{"results":[],"statuses":[],"costDollars":{"total":NaN}}',
])
def test_strict_json_never_accepts_malformed_envelopes(raw):
    client, _ = client_for(raw)
    result = client.contents([URL])
    assert result["pages"][0]["text"] is None
    assert result["stop_reason"] is not None


@pytest.mark.parametrize("location", ["text", "request_id", "header", "exception", "error_body"])
def test_credential_echo_is_discarded_and_never_returned(location):
    token = "synthetic-" + secrets.token_hex(16)
    payload = envelope()
    headers, status, request = None, 200, None
    if location == "text":
        payload["results"][0]["text"] = token
    elif location == "request_id":
        payload["requestId"] = token
    elif location == "header":
        headers = {"x-request-id": token}
    elif location == "exception":
        def request(*args, **kwargs):
            raise OSError(token)
    else:
        payload, status = {"error": token}, 403
    client, _ = client_for(payload, token=token, headers=headers, status=status, request=request)
    result = client.contents([URL])
    assert token not in json.dumps(result)
    assert result["pages"][0]["text"] is None and result["stop_reason"] == "credential_echo"


def test_boolean_http_code_is_not_a_success():
    client, _ = client_for(status=True)
    assert client.contents([URL])["stop_reason"] == "provider_response_invalid"


def test_offline_client_cannot_instantiate_live_transport():
    m = module()
    with pytest.raises(m.ExaError, match="offline_transport_forbidden"):
        m.ExaClient(request=m.exa_http_request, now=lambda: NOW, monotonic=lambda: 0, sleep=lambda _: None, limits={})


def test_http_boundary_has_fixed_origin_tls_no_redirect_and_size_timeout_bounds(monkeypatch):
    m = module()
    token = "synthetic-" + secrets.token_hex(16)
    with pytest.raises(m.ExaError):
        m.exa_http_request("https://evil.invalid/contents", b"{}", token, timeout_seconds=20, max_bytes=2097152)
    calls = []

    class Response(io.BytesIO):
        status = 200
        headers = {"x-request-id": "synthetic"}

    class Opener:
        def open(self, request, timeout):
            calls.append((request, timeout))
            return Response(b"{}")

    handlers = []
    def build(*given):
        handlers.extend(given)
        return Opener()
    monkeypatch.setattr(m, "build_opener", build)
    assert m.exa_http_request("https://api.exa.ai/search", b"{}", token, timeout_seconds=20, max_bytes=2097152)[0] == 200
    assert calls[0][1] == 20 and calls[0][0].get_header("X-api-key") == token
    tls = next(x for x in handlers if isinstance(x, m.HTTPSHandler))
    assert tls._context.check_hostname is True
    redirect = next(x for x in handlers if isinstance(x, m.HTTPRedirectHandler))
    assert redirect.redirect_request(calls[0][0], None, 302, "redirect", {}, "https://evil.invalid") is None
    class LargeOpener:
        def open(self, *args, **kwargs):
            return Response(b"x" * 20)
    monkeypatch.setattr(m, "build_opener", lambda *args: LargeOpener())
    with pytest.raises(m.ExaError, match="provider_response_too_large"):
        m.exa_http_request("https://api.exa.ai/contents", b"{}", token, timeout_seconds=20, max_bytes=10)


class Clock:
    def __init__(self):
        self.seconds, self.delays = 0.0, []

    def now(self):
        return NOW + timedelta(seconds=self.seconds)

    def sleep(self, seconds):
        self.delays.append(seconds)
        self.seconds += seconds


def retry_client(outcomes, *, limits=None, retry_after=None):
    clock, recorded = Clock(), []
    m = module()

    def request(endpoint, body, token, **kwargs):
        options = json.loads(body)
        recorded.append(options)
        assert client.ledger.snapshot()["total_requests"] == len(recorded)
        outcome = outcomes[min(len(recorded) - 1, len(outcomes) - 1)]
        if isinstance(outcome, Exception):
            raise outcome
        payload = outcome(options) if callable(outcome) else envelope(options.get("urls", [URL]))
        status = outcome if type(outcome) is int else 200
        headers = {"retry-after": retry_after} if retry_after is not None else {}
        return status, headers, json.dumps(payload).encode()

    client = m.ExaClient(request=request, now=clock.now, monotonic=lambda: clock.seconds, sleep=clock.sleep,
                         limits=limits or {})
    return client, recorded, clock


def test_unknown_outcome_keeps_reservation():
    client, recorded, clock = retry_client([TimeoutError(), 200])
    result = client.discover(scope())
    assert result["results"] and len(recorded) == 2 and clock.delays == [2]
    assert client.ledger.snapshot()["search_requests"] == 2
    assert client.ledger.snapshot()["reserved_usd"] == "0.014"


@pytest.mark.parametrize("operation", ["search", "contents"])
@pytest.mark.parametrize("outcome", [429, 503, TimeoutError()])
def test_every_attempt_reserves_before_request(operation, outcome):
    client, recorded, clock = retry_client([outcome])
    if operation == "search":
        client.discover(scope())
    else:
        client.contents([URL])
    assert len(recorded) == 3 and clock.delays == [2, 4]
    assert client.ledger.snapshot()["reserved_usd"] == ("0.021" if operation == "search" else "0.030")


def test_retry_only_failed_urls():
    def partial(options):
        payload = envelope(options["urls"])
        payload["results"] = payload["results"][:1]
        payload["statuses"][1] = {"id": URL2, "status": "error", "error": {"httpStatusCode": 503}}
        return payload
    client, recorded, _ = retry_client([partial, 200])
    result = client.contents([URL, URL2, URL])
    assert recorded[1]["urls"] == [URL2]
    assert [x["status"] for x in result["pages"]] == ["success", "success"]
    assert client.ledger.snapshot()["url_attempts"] == {URL: 1, URL2: 2}


@pytest.mark.parametrize("header,delays", [
    ("3", [3]), ("Fri, 16 Oct 2026 00:00:05 GMT", [5]),
    ("31", []), ("nonsense", []), ("-1", []),
])
def test_retry_after_is_respected_or_deferred(header, delays):
    client, recorded, clock = retry_client([429, 200], retry_after=header)
    client.discover(scope())
    assert clock.delays == delays
    assert len(recorded) == (2 if delays else 1)
    assert (client.stop_reason is None) == bool(delays)


def test_all_global_caps_are_enforced_before_http():
    client, recorded, _ = retry_client([200])
    for index in range(5):
        entry = scope()
        entry["query_id"] = f"q{index}"
        client.discover(entry)
    assert len(recorded) == 4 and client.stop_reason == "search_request_limit"
    client, recorded, _ = retry_client([200])
    with pytest.raises(module().ExaError, match="unique_url_limit"):
        client.contents([f"https://www.property.hk/asking_detail/{x}.html" for x in range(21)])
    assert recorded == []
    client, recorded, _ = retry_client([TimeoutError()])
    client.contents([f"https://www.property.hk/asking_detail/{x}.html" for x in range(20)])
    assert len(recorded) == 12 and all(len(x["urls"]) <= 5 for x in recorded)
    assert set(client.ledger.snapshot()["url_attempts"].values()) == {3}
    assert client.ledger.snapshot()["reserved_usd"] == "0.120"
    client, recorded, _ = retry_client([200], limits={"max_cost_usd": "0.006"})
    client.discover(scope())
    assert recorded == [] and client.stop_reason == "cost_reservation_limit"
    ledger = module().AttemptLedger({}, monotonic=lambda: 0.0)
    for index in range(4):
        ledger.reserve("search", (f"q{index}",))
    for attempt in range(3):
        for batch in range(4):
            ledger.reserve("contents", tuple(f"url{x}" for x in range(batch * 5, batch * 5 + 5)))
    assert ledger.snapshot()["total_requests"] == 16
    assert ledger.snapshot()["reserved_usd"] == "0.148"
    with pytest.raises(module().ExaError):
        ledger.reserve("contents", ("url0",))


@pytest.mark.parametrize("status", [401, 402, 403])
def test_auth_failure_never_retries_or_switches_service(status):
    client, recorded, _ = retry_client([status, 200])
    client.contents([URL, URL2])
    client.discover(scope())
    assert len(recorded) == 1 and client.stop_reason == f"api_http_{status}"


@pytest.mark.parametrize("error,stop", [
    ({"httpStatusCode": 403}, "source_access_denied"),
    ({"tag": "ROBOTS_DENIED"}, "source_access_denied"),
    ({"tag": "LOGIN_REQUIRED"}, "source_access_denied"),
    ({"httpStatusCode": 503, "tag": "NEW_UNKNOWN_TAG"}, None),
    ({"httpStatusCode": 503, "tag": "new provider tag?"}, None),
    ({"httpStatusCode": 404}, None),
])
def test_source_denial_or_unknown_errors_fail_closed(error, stop):
    def partial(options):
        payload = envelope(options["urls"])
        if len(options["urls"]) == 1:
            return payload
        payload["statuses"][1] = {"id": URL2, "status": "error", "error": error}
        payload["results"] = payload["results"][:1]
        return payload
    client, recorded, _ = retry_client([partial])
    result = client.contents([URL, URL2])
    assert len(recorded) == 1 and result["stop_reason"] == stop
    assert result["pages"][0]["status"] == "success" and result["pages"][1]["text"] is None


@pytest.mark.parametrize("limits", [
    {"max_attempts": True}, {"max_attempts": 4}, {"max_total_requests": 17},
    {"max_cost_usd": "NaN"}, {"max_cost_usd": "Infinity"}, {"max_cost_usd": "-1"},
    {"max_cost_usd": True}, {"tariff": 0}, {"batch_size": 0},
])
def test_invalid_limits_never_open_capacity(limits):
    with pytest.raises(module().ExaError, match="limits_invalid"):
        retry_client([200], limits=limits)


@pytest.mark.parametrize("cost", [True, -1, "0.001", 0.011, float("inf")])
def test_invalid_or_excess_cost_stops_without_refund(cost):
    payload = envelope()
    payload["costDollars"]["total"] = cost
    client, _ = client_for(payload)
    result = client.contents([URL])
    assert result["stop_reason"] is not None
    assert client.ledger.snapshot()["reserved_usd"] == "0.010"


def test_elapsed_budget_blocks_retry_before_sleep():
    client, recorded, clock = retry_client([503], limits={"max_elapsed_seconds": 1})
    client.contents([URL])
    assert len(recorded) == 1 and clock.delays == []
    assert client.stop_reason == "elapsed_budget_exhausted"


def test_interruption_during_backoff_stops_without_new_request():
    client, recorded, clock = retry_client([503, 200])
    def interrupted_sleep(seconds):
        raise KeyboardInterrupt
    client.sleep = interrupted_sleep
    try:
        client.discover(scope())
    except KeyboardInterrupt:
        pytest.fail("Backoff interruption escaped instead of stopping safely")
    assert len(recorded) == 1 and client.stop_reason == "interrupted"


@pytest.mark.parametrize("kind", ["incomplete", "http_error", "message_echo", "partial_echo"])
def test_http_protocol_exceptions_are_sanitized_and_preserve_reservations(kind):
    token = "synthetic-" + secrets.token_hex(16)
    def request(*args, **kwargs):
        if kind == "incomplete":
            raise IncompleteRead(b"synthetic truncated response")
        if kind == "partial_echo":
            raise IncompleteRead(token.encode())
        raise HTTPException(token if kind == "message_echo" else "synthetic invalid header")
    client, recorded = client_for(request=request, token=token)
    try:
        result = client.contents([URL])
    except HTTPException:
        pytest.fail("HTTP protocol exception bypassed sanitized partial-report path")
    assert token not in json.dumps(result)
    if kind == "incomplete":
        assert len(recorded) == 3 and client.ledger.snapshot()["reserved_usd"] == "0.030"
        assert result["stop_reason"] == "contents_retries_exhausted"
    else:
        assert len(recorded) == 1 and client.ledger.snapshot()["reserved_usd"] == "0.010"
        assert result["stop_reason"] == ("credential_echo" if kind.endswith("echo") else "provider_transport_failed")
