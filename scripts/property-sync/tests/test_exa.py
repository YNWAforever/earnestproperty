"""Exercise the Exa adapter using HTTP-boundary doubles, never a paid API."""
import copy
import importlib
import io
import json
import sys
import secrets
from datetime import datetime, timezone
from pathlib import Path

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
