"""Opt-in, bounded Firecrawl basic transport for the approved 28Hse scope."""
import base64
import hashlib
import json
import os
import re
from urllib.parse import parse_qs, urlsplit
from urllib.error import URLError

from .worker import TransportError, WorkerError, checked_url, http_request

API_URL = "https://api.firecrawl.dev/v2/scrape"
ORIGIN = "https://www.28hse.com"
SOURCE_BODY_LIMIT = 2 * 1024 * 1024
PROVIDER_BODY_LIMIT = 16 * 1024 * 1024


def approved_url(url):
    try:
        checked_url(url, ORIGIN)
        parsed = urlsplit(url)
        if parsed.path == "/robots.txt" and not parsed.query:
            return
        if re.fullmatch(r"/(?:buy|rent)/[^/%?#]+/property-\d+/?", parsed.path) and not parsed.query:
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
        if (
            parsed.path == "/agent/540"
            and set(query) == {"buyRent", "page", "plan_id", "propertyDoSearchVersion"}
            and query["buyRent"] in (["buy"], ["rent"])
            and len(query["page"]) == 1
            and re.fullmatch(r"[1-9]\d{0,3}", query["page"][0])
            and int(query["page"][0]) <= 1000
            and query["plan_id"] == ["540"]
            and query["propertyDoSearchVersion"] == ["2.0"]
        ):
            return
    except (TypeError, ValueError, WorkerError):
        pass
    raise WorkerError("firecrawl_scope")


class FirecrawlBasic:
    def __init__(self, *, request=None, checkpoint=None):
        self.request = http_request if request is None else request
        self.checkpoint = checkpoint
        self.evidence = []

    def __call__(self, url):
        approved_url(url)
        token = os.environ.get("FIRECRAWL_API_KEY", "")
        if not token or len(token) > 1024 or re.search(r"\s", token):
            raise WorkerError("firecrawl_key_required")
        robots = urlsplit(url).path == "/robots.txt"
        field = "markdown" if robots else "rawHtml"
        options = {
            "url": url,
            "formats": [field],
            "proxy": "basic",
            "maxAge": 0,
            "storeInCache": False,
            "skipTlsVerification": False,
            "onlyMainContent": False,
            "timeout": 25000,
        }
        try:
            status, _, raw = self.request(
                API_URL, json.dumps(options).encode(), token, max_bytes=PROVIDER_BODY_LIMIT
            )
        except (URLError, TimeoutError, OSError):
            raise TransportError("firecrawl_provider_network_failed", retryable=True) from None
        except WorkerError as error:
            if str(error) == "response_too_large":
                raise TransportError("firecrawl_provider_response_too_large") from None
            raise
        # Request evidence omits Authorization; provider bytes remain private.
        self.evidence.append({
            "request": options,
            "provider_status": status,
            "body_base64": base64.b64encode(raw).decode("ascii"),
            "body_sha256": hashlib.sha256(raw).hexdigest(),
        })
        if self.checkpoint:
            self.checkpoint.provider_response(url, status, raw)
        if status != 200:
            raise TransportError(
                f"firecrawl_provider_http_{status}",
                retryable=status == 408 or 500 <= status < 600,
            )
        try:
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get("success") is not True:
                raise ValueError
            data = result["data"]
            metadata = data["metadata"]
            if (
                not isinstance(metadata, dict)
                or metadata.get("sourceURL") != url
                or metadata.get("url") != url
                or metadata.get("proxyUsed") != "basic"
                or type(metadata.get("statusCode")) is not int
                or metadata.get("error")
                or data.get("warning")
                or metadata.get("cached") is True
                or str(metadata.get("cacheState", "")).lower() == "hit"
            ):
                raise ValueError
            source_status = metadata["statusCode"]
            if not 100 <= source_status <= 599:
                raise ValueError
            if source_status != 200:
                return source_status, {}, b""
            content = data[field]
            if not isinstance(content, str) or not content.strip():
                raise ValueError
            if re.search(r"(?:tokens?|characters?) truncated", content, re.I):
                raise ValueError
            if robots:
                if re.search(r"<(?:html|head|body|script)\b", content, re.I):
                    raise ValueError
            elif not all(re.search(pattern, content, re.I) for pattern in (
                r"<html(?:\s|>)", r"<head(?:\s|>)", r"<body(?:\s|>)", r"</html\s*>",
            )):
                raise ValueError
            body = content.encode("utf-8")
            if len(body) > SOURCE_BODY_LIMIT:
                raise WorkerError("firecrawl_source_response_too_large")
            return 200, {}, body
        except (KeyError, TypeError, ValueError, UnicodeError):
            raise WorkerError("firecrawl_response_invalid") from None
