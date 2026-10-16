"""Bounded Exa provider operations; text never becomes an origin HTML response."""
import json
import re
import ssl
from datetime import timezone
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from .propertyhk_candidates import CandidateError, normalize_detail_url, validate_query_plan

API_ORIGIN = "https://api.exa.ai"
DEFAULT_LIMITS = {
    "max_queries": 4, "max_search_requests": 4, "max_results_per_search": 5,
    "max_unique_urls": 20, "batch_size": 5, "max_attempts": 3,
    "max_contents_requests": 12, "max_total_requests": 16, "max_cost_usd": "0.20",
    "timeout_seconds": 20, "max_elapsed_seconds": 120,
    "max_response_bytes": 2097152, "max_retry_after_seconds": 30,
}


class ExaError(ValueError):
    def __init__(self, code, *, retryable=False, retry_after=None):
        super().__init__(code)
        self.code, self.retryable, self.retry_after = code, retryable, retry_after


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def exa_http_request(endpoint: str, payload: bytes, token: str | None, *,
                     timeout_seconds: float, max_bytes: int) -> tuple[int, dict[str, str], bytes]:
    if endpoint not in (API_ORIGIN + "/search", API_ORIGIN + "/contents"):
        raise ExaError("api_origin_not_allowed")
    if not isinstance(token, str) or not token or len(token) > 1024 or re.search(r"\s", token):
        raise ExaError("api_key_required")
    opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    request = Request(endpoint, data=payload, method="POST",
                      headers={"x-api-key": token, "Content-Type": "application/json"})
    try:
        response = opener.open(request, timeout=timeout_seconds)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise ExaError("provider_response_too_large")
        return response.status, dict(response.headers), raw


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError
            result[key] = value
        return result

    def invalid_constant(_):
        raise ValueError

    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_float=Decimal, parse_constant=invalid_constant)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ExaError("provider_json_invalid") from None


def _identifier(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:/-]{1,200}", value) else None


class ExaClient:
    def __init__(self, *, request, now, monotonic, sleep, limits: dict, token: str | None = None,
                 fixture_aliases: dict[str, str] | None = None, online: bool = False):
        if request is exa_http_request and not online:
            raise ExaError("offline_transport_forbidden")
        self.request, self.now, self.monotonic, self.sleep = request, now, monotonic, sleep
        self.token, self.fixture_aliases, self.online = token, fixture_aliases, online
        self.limits = {**DEFAULT_LIMITS, **limits}
        self.stop_reason = None
        self._last_error = None
        self._metrics = {"search_requests": 0, "contents_requests": 0, "raw_results": 0,
                         "rejected_urls": 0, "queries_attempted": 0, "queries_completed": 0,
                         "pages_succeeded": 0, "pages_failed": 0}

    @property
    def metrics(self):
        return dict(self._metrics)

    def _detail(self, url):
        return normalize_detail_url(url, fixture_aliases=self.fixture_aliases, online=self.online)

    def _call_once(self, operation, payload):
        endpoint = API_ORIGIN + ("/search" if operation == "search" else "/contents")
        try:
            status, headers, raw = self.request(
                endpoint, json.dumps(payload, ensure_ascii=False).encode("utf-8"), self.token,
                timeout_seconds=self.limits["timeout_seconds"], max_bytes=self.limits["max_response_bytes"],
            )
        except OSError as error:
            if self.token and self.token in str(error):
                raise ExaError("credential_echo") from None
            raise ExaError("provider_network_failed", retryable=True) from None
        if (type(status) is not int or not 100 <= status <= 599 or not isinstance(headers, dict)
                or not isinstance(raw, bytes)):
            raise ExaError("provider_response_invalid")
        if len(raw) > self.limits["max_response_bytes"]:
            raise ExaError("provider_response_too_large")
        if self.token and (self.token.encode() in raw or any(
            self.token in str(value) or self.token in str(key) for key, value in headers.items()
        )):
            raise ExaError("credential_echo")
        lowered = {str(key).lower(): value for key, value in headers.items()}
        if status != 200:
            raise ExaError("api_http_" + str(status), retryable=status == 429 or 500 <= status < 600,
                           retry_after=lowered.get("retry-after"))
        data = strict_json(raw)
        if (not isinstance(data, dict) or not isinstance(data.get("results"), list)
                or (operation == "contents" and not isinstance(data.get("statuses"), list))):
            raise ExaError("provider_response_invalid")
        return data, lowered

    def _request(self, operation, payload):
        if self.stop_reason:
            return None
        self._metrics[operation + "_requests"] += 1
        try:
            return self._call_once(operation, payload)
        except ExaError as error:
            self._last_error = self.stop_reason = error.code
            return None

    def _metadata(self, data, headers, *, operation, document=None, status=None):
        document, status = document or {}, status or {}
        body_id, header_id = _identifier(data.get("requestId")), _identifier(headers.get("x-request-id"))
        provider = {
            "provider": "exa", "endpoint": operation,
            "body_request_id": body_id, "header_request_id": header_id,
            "provider_document_id": _identifier(document.get("id")),
            "status": status.get("status"), "status_source": status.get("source"),
            "provider_estimated_published_date": document.get("publishedDate")
            if isinstance(document.get("publishedDate"), str) else None,
            "provider_retrieval_time": None,
            "retrieved_at": self.now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "attempt": 1,
        }
        return provider, ["provider_request_id_mismatch"] if body_id and header_id and body_id != header_id else []

    def discover(self, scope: dict) -> dict:
        validate_query_plan([scope], synthetic=not self.online)
        output = {"query_id": scope["query_id"], "results": [], "rejected_results": [],
                  "request_ids": [], "errors": []}
        self._metrics["queries_attempted"] += 1
        response = self._request("search", {
            "query": " ".join(scope["query_terms"]), "type": "fast",
            "includeDomains": ["property.hk"], "numResults": self.limits["max_results_per_search"],
        })
        if response is None:
            output["errors"] = [self.stop_reason]
            return output
        data, headers = response
        self._metrics["queries_completed"] += 1
        metadata, _ = self._metadata(data, headers, operation="search")
        output["request_ids"].append(metadata)
        for item in data["results"]:
            self._metrics["raw_results"] += 1
            try:
                if not isinstance(item, dict):
                    raise CandidateError("url_not_allowed")
                detail = self._detail(item.get("url"))
                output["results"].append({**detail, "provider": self._metadata(
                    data, headers, operation="search", document=item)[0]})
            except CandidateError:
                self._metrics["rejected_urls"] += 1
                output["rejected_results"].append({"reason": "url_not_allowed", "original_url":
                    item.get("url") if isinstance(item, dict) and isinstance(item.get("url"), str) else None})
        return output

    def _failure(self, detail, reason, provider=None):
        return {"detail": detail, "status": "error", "text": None, "provider": provider or {},
                "attempts": 1, "reasons": [reason]}

    def _pages(self, details, data, headers):
        requested = {detail["normalized_url"]: detail for detail in details}
        statuses, documents = {}, {}
        for name, target in (("statuses", statuses), ("results", documents)):
            for item in data[name]:
                if not isinstance(item, dict):
                    raise ExaError("provider_response_invalid")
                try:
                    key = self._detail(item.get("id") if name == "statuses" else item.get("url"))["normalized_url"]
                except CandidateError:
                    raise ExaError("provider_identity_mismatch") from None
                if key not in requested:
                    raise ExaError("provider_identity_mismatch")
                target.setdefault(key, []).append(item)
        pages = []
        for url, detail in requested.items():
            states, results = statuses.get(url, []), documents.get(url, [])
            if len(states) != 1 or states[0].get("status") not in ("success", "error"):
                pages.append(self._failure(detail, "contents_status_integrity"))
                continue
            state = states[0]
            if state.get("source") not in (None, "cached", "crawled"):
                raise ExaError("provider_response_invalid")
            provider, reasons = self._metadata(data, headers, operation="contents",
                                               document=results[0] if len(results) == 1 else {}, status=state)
            if state["status"] == "error":
                error = state.get("error") or {}
                if not isinstance(error, dict):
                    raise ExaError("provider_response_invalid")
                code, tag = error.get("httpStatusCode"), error.get("tag")
                if (code is not None and (type(code) is not int or not 100 <= code <= 599)
                        or tag is not None and not isinstance(tag, str)):
                    raise ExaError("provider_response_invalid")
                denied = code in (401, 402, 403) or (tag and any(
                    x in tag.upper() for x in ("ROBOTS", "LOGIN", "DENIED", "BLOCKED", "QUOTA", "BUDGET")
                ))
                if denied:
                    self.stop_reason = "source_access_denied"
                failed = self._failure(detail, "source_access_denied" if denied else "contents_fetch_failed", provider)
                failed["provider"].update(error_http_status=code, error_tag=_identifier(tag))
                pages.append(failed)
            elif len(results) != 1 or not isinstance(results[0].get("text"), str) or not results[0]["text"].strip():
                pages.append(self._failure(detail, "contents_result_integrity", provider))
            else:
                pages.append({"detail": detail, "status": "success", "text": results[0]["text"],
                              "provider": provider, "attempts": 1, "reasons": reasons})
        return pages

    def contents(self, urls: list[str]) -> dict:
        if not isinstance(urls, list):
            raise ExaError("contents_input_invalid")
        details = {item["normalized_url"]: item for item in (self._detail(url) for url in urls)}
        if len(details) > self.limits["max_unique_urls"]:
            raise ExaError("unique_url_limit")
        pages, request_ids = [], []
        values = list(details.values())
        for offset in range(0, len(values), self.limits["batch_size"]):
            batch = values[offset:offset + self.limits["batch_size"]]
            response = self._request("contents", {"urls": [x["normalized_url"] for x in batch],
                                                  "text": True, "maxAgeHours": 0, "subpages": 0})
            if response is None:
                pages.extend(self._failure(x, self.stop_reason) for x in batch)
                continue
            data, headers = response
            try:
                pages.extend(self._pages(batch, data, headers))
                request_ids.append(self._metadata(data, headers, operation="contents")[0])
            except ExaError as error:
                self.stop_reason = error.code
                pages.extend(self._failure(x, error.code) for x in batch)
        self._metrics["pages_succeeded"] += sum(x["status"] == "success" for x in pages)
        self._metrics["pages_failed"] += sum(x["status"] != "success" for x in pages)
        return {"pages": pages, "request_ids": request_ids, "stop_reason": self.stop_reason}
