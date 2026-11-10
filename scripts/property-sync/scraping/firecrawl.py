"""Opt-in, bounded Firecrawl basic transport for the approved 28Hse scope."""
import base64
import hashlib
import json
import os
import re
import time
from urllib.parse import parse_qs, urlsplit
from urllib.error import URLError

from .worker import TransportError, WorkerError, checked_url, http_request

API_URL = "https://api.firecrawl.dev/v2/scrape"
ORIGIN = "https://www.28hse.com"
SOURCE_BODY_LIMIT = 2 * 1024 * 1024
PROVIDER_BODY_LIMIT = 16 * 1024 * 1024
# A plan's credits can run out mid-run; the numbered backups let a collection continue on
# another approved key instead of failing the whole sync.
KEY_ENV_SUFFIXES = ("", "_2", "_3", "_4", "_5")
# Firecrawl's plan rate limit is per minute; one collection run is many requests, so a 429 is
# waited out rather than aborting the page. Bounded so a persistent limit still fails closed.
RATE_LIMIT_ATTEMPTS = 2
RATE_LIMIT_SLEEP_SECONDS = 60


def firecrawl_tokens():
    """The approved Firecrawl key pool.

    `FIRECRAWL_API_KEYS` (comma separated) wins; otherwise `FIRECRAWL_API_KEY` plus the
    numbered backups `FIRECRAWL_API_KEY_2`..`_5`. Invalid entries are ignored, never used.
    """
    raw = os.environ.get("FIRECRAWL_API_KEYS", "")
    values = [part.strip() for part in raw.split(",")] if raw else []
    values += [os.environ.get(f"FIRECRAWL_API_KEY{suffix}", "") for suffix in KEY_ENV_SUFFIXES]
    tokens = []
    for token in values:
        if token and token not in tokens and len(token) <= 1024 and not re.search(r"\s", token):
            tokens.append(token)
    return tokens



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
        # A key that answers 402 stays out for the rest of the run: retrying it on every
        # request would double the provider call rate and trip the plan's rate limit.
        self.exhausted = set()

    def _fetch(self, url, options, token):
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
        return status, raw

    def __call__(self, url):
        approved_url(url)
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
        status, raw = None, b""
        for token in firecrawl_tokens():
            if token in self.exhausted:
                continue
            for attempt in range(RATE_LIMIT_ATTEMPTS):
                status, raw = self._fetch(url, options, token)
                if status == 429 and attempt + 1 < RATE_LIMIT_ATTEMPTS:
                    time.sleep(RATE_LIMIT_SLEEP_SECONDS)
                    continue
                break
            # 402 means this key's plan credits are exhausted; the next pooled key may still
            # have its own allowance. Any other status is final for this request.
            if status == 402:
                self.exhausted.add(token)
                continue
            break
        if status is None:
            raise WorkerError("firecrawl_key_required")
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
