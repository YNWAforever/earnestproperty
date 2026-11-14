"""Reparse frozen 28Hse HTML offline; emit only a digest-bound semantic proof.

No source fetching, provider calls, database access or credential handling belongs here.
The caller verifies that these exact input bytes are the trusted native collection bundle.
"""
import argparse
import base64
from datetime import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit

from scraping.checkpoint import atomic_bytes
from scraping.incremental_28hse import card_fingerprint
from scraping.worker import WorkerError, clean_id, parse_28_detail, parse_28_index, text

PROOF_VERSION = "28hse-authority-semantic-v1"
PARSER_VERSION = "python-v2.2"
DIGEST = re.compile(r"^[a-f0-9]{64}$")
MAX_INPUT_BYTES = 128 * 1024 * 1024
MAX_HTML_BYTES = 2 * 1024 * 1024
NUMERIC_FIELDS = (
    "price", "rent", "gross_area", "saleable_area", "gross_unit_price", "saleable_unit_price",
)
TEXT_FIELDS = ("title", "floor", "orientation", "estate", "district", "phase", "block", "unit", "description", "promotion_tier_raw")
INTEGER_FIELDS = ("bedrooms", "bathrooms")


class AuthorityVerificationError(Exception):
    """A fixed safe code, without property values, URLs, HTML or contacts."""


def fail(code):
    raise AuthorityVerificationError(code)


def sha256(value):
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def identity(row):
    if not isinstance(row, dict) or row.get("deal_type") not in ("sale", "rent"):
        fail("AUTHORITY_IDENTITY_INVALID")
    try:
        ident = clean_id(row.get("property_id"), "28hse")
    except WorkerError:
        fail("AUTHORITY_IDENTITY_INVALID")
    return ident, row["deal_type"]


def instant(stamp):
    if not isinstance(stamp, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", stamp):
        fail("AUTHORITY_CAPTURE_INVALID")
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        fail("AUTHORITY_CAPTURE_INVALID")


def decimal_value(value):
    if value is None or value == "" or value == "面議":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        fail("AUTHORITY_FACTS_MISMATCH")
    raw = str(value).strip()
    if not re.fullmatch(r"\d{1,16}(?:\.\d{1,8})?", raw):
        fail("AUTHORITY_FACTS_MISMATCH")
    try:
        return Decimal(raw)
    except InvalidOperation:
        fail("AUTHORITY_FACTS_MISMATCH")


def string_value(value):
    if value is None:
        return None
    if not isinstance(value, str):
        fail("AUTHORITY_FACTS_MISMATCH")
    return text(value) or None


def provider_html(evidence, url, html):
    """Bind source text to the actual returned provider URL and raw HTML bytes."""
    responses = [item for item in evidence["provider_requests"]
                 if isinstance(item, dict) and isinstance(item.get("request"), dict)
                 and item["request"].get("url") == url and item.get("provider_status") == 200]
    if len(responses) != 1:
        fail("AUTHORITY_PROVIDER_AMBIGUOUS")
    response = responses[0]
    try:
        encoded = response["body_base64"]
        if not isinstance(encoded, str) or len(encoded) > 24 * 1024 * 1024:
            raise ValueError
        body = base64.b64decode(encoded, validate=True)
        if (base64.b64encode(body).decode("ascii") != encoded
                or len(body) > 16 * 1024 * 1024
                or sha256(body) != response["body_sha256"]):
            raise ValueError
        result = json.loads(body)
        data = result["data"]
        metadata = data["metadata"]
        fields = [field for field in ("rawHtml", "html") if field in data]
        if (result.get("success") is not True or not isinstance(data, dict)
                or not isinstance(metadata, dict) or metadata.get("url") != url
                or metadata.get("sourceURL") != url or metadata.get("statusCode") != 200
                or metadata.get("error") or data.get("warning")
                or metadata.get("cached") is True
                or str(metadata.get("cacheState", "")).lower() == "hit" or not fields
                or any(not isinstance(data[field], str) or data[field] != html for field in fields)):
            raise ValueError
    except (KeyError, TypeError, ValueError, UnicodeError):
        fail("AUTHORITY_PROVIDER_MISMATCH")


def source_bodies(evidence):
    bodies = {}
    for response in evidence["requests"]:
        if not isinstance(response, dict) or response.get("status") != 200:
            continue
        url, html = response.get("url"), response.get("html")
        if not isinstance(url, str) or not isinstance(html, str):
            fail("AUTHORITY_HTML_INVALID")
        if not html.strip() or len(html.encode("utf-8")) > MAX_HTML_BYTES:
            fail("AUTHORITY_HTML_INVALID")
        if url in bodies and bodies[url] != html:
            fail("AUTHORITY_HTML_AMBIGUOUS")
        bodies[url] = html
    return bodies


def index_deal(url):
    try:
        parsed = urlsplit(url)
    except ValueError:
        fail("AUTHORITY_IDENTITY_INVALID")
    if parsed.scheme != "https" or parsed.netloc != "www.28hse.com" or parsed.path != "/agent/540" or parsed.fragment:
        return None
    query = parse_qs(parsed.query, keep_blank_values=True)
    if (set(query) != {"buyRent", "page", "plan_id", "propertyDoSearchVersion"}
            or query["buyRent"] not in (["buy"], ["rent"])
            or query["plan_id"] != ["540"] or query["propertyDoSearchVersion"] != ["2.0"]
            or len(query["page"]) != 1 or not re.fullmatch(r"[1-9]\d{0,3}", query["page"][0])
            or int(query["page"][0]) > 1000):
        return None
    return "sale" if query["buyRent"] == ["buy"] else "rent"


def index_records(bodies, evidence):
    records = {}
    for url, html in bodies.items():
        deal = index_deal(url)
        if deal is None:
            continue
        provider_html(evidence, url, html)
        try:
            rows, _, _ = parse_28_index(html, deal)
        except (WorkerError, ValueError, TypeError):
            fail("AUTHORITY_INDEX_PARSE_FAILED")
        for row in rows:
            key = identity(row)
            if key in records and card_fingerprint(records[key]) != card_fingerprint(row):
                fail("AUTHORITY_INDEX_AMBIGUOUS")
            records[key] = row
    return records


def compare_facts(accepted, parsed):
    if accepted.get("agency_property_no") != parsed.get("agency_property_no"):
        fail("AUTHORITY_FACTS_MISMATCH")
    for field in NUMERIC_FIELDS:
        if decimal_value(accepted.get(field)) != decimal_value(parsed.get(field)):
            fail("AUTHORITY_FACTS_MISMATCH")
    for field in TEXT_FIELDS:
        if string_value(accepted.get(field)) != string_value(parsed.get(field)):
            fail("AUTHORITY_FACTS_MISMATCH")
    for field in INTEGER_FIELDS:
        actual = accepted.get(field)
        if actual is not None and (type(actual) is not int or not 0 <= actual <= 100):
            fail("AUTHORITY_FACTS_MISMATCH")
        if actual != parsed.get(field):
            fail("AUTHORITY_FACTS_MISMATCH")
    if (accepted.get("source_status", "active") != parsed["source_status"]
            or accepted.get("source_status_reason") != parsed["source_status_reason"]):
        fail("AUTHORITY_FACTS_MISMATCH")
    publication = accepted.get("publication")
    if (not isinstance(publication, dict)
            or set(publication) != {"description", "images"}
            or publication != parsed["publication"]):
        fail("AUTHORITY_PUBLICATION_MISMATCH")
    if accepted.get("raw_payload", {}).get("source_conflicts", []) != parsed["raw_payload"]["source_conflicts"]:
        fail("AUTHORITY_CONFLICTS_MISMATCH")


def verify_authority_facts(request, evidence):
    """Verify all selected facts against reparsed frozen HTML; return the record count."""
    meta = request.get("meta", {}) if isinstance(request, dict) else {}
    if (not isinstance(request, dict) or request.get("source") != "28hse"
            or not isinstance(meta, dict) or meta.get("schema_version") != "2.0"
            or meta.get("parser_version") != PARSER_VERSION
            or meta.get("scope_id") != "agent:540" or meta.get("policy_version") != "no-hermes-v2"
            or not isinstance(meta.get("incremental"), dict)
            or meta["incremental"].get("mode") != "index-delta-v1"
            or not isinstance(request.get("listings"), list) or len(request["listings"]) > 10000
            or not isinstance(evidence, dict) or evidence.get("errors") != []
            or not isinstance(evidence.get("selected_candidates"), list)
            or not isinstance(evidence.get("requests"), list)
            or not isinstance(evidence.get("provider_requests"), list)):
        fail("AUTHORITY_INPUT_INVALID")
    start = instant(meta["incremental"].get("index_started_at"))
    finish = instant(request.get("scraped_at"))
    if start > finish:
        fail("AUTHORITY_CAPTURE_INVALID")
    candidates = {}
    for candidate in evidence["selected_candidates"]:
        key = identity(candidate)
        if key in candidates or candidate.get("status") != "fetched":
            fail("AUTHORITY_CANDIDATES_INVALID")
        candidates[key] = candidate
    listing_keys = [identity(row) for row in request["listings"]]
    if len(set(listing_keys)) != len(listing_keys) or set(listing_keys) != set(candidates):
        fail("AUTHORITY_CANDIDATES_INVALID")
    if not listing_keys:
        return 0
    bodies = source_bodies(evidence)
    indexes = index_records(bodies, evidence)
    for accepted in request["listings"]:
        key = identity(accepted)
        candidate, row = candidates[key], indexes.get(key)
        if row is None or accepted.get("source_url") != row["source_url"] or candidate.get("source_url") != row["source_url"]:
            fail("AUTHORITY_IDENTITY_INVALID")
        stamp = accepted.get("captured_at")
        if accepted.get("observation_kind") in ("index_only", "cached"):
            fail("AUTHORITY_CAPTURE_INVALID")
        if not start <= instant(stamp) <= finish:
            fail("AUTHORITY_CAPTURE_INVALID")
        raw = accepted.get("raw_payload")
        delta = raw.get("incremental") if isinstance(raw, dict) else None
        if (not isinstance(delta, dict) or delta.get("mode") != "index-delta-v1"
                or candidate.get("detail_fetched_at") != stamp
                or delta.get("detail_fetched_at") != stamp
                or ("detail_fetched_at" in accepted and accepted["detail_fetched_at"] != stamp)):
            fail("AUTHORITY_CAPTURE_INVALID")
        url = row["source_url"]
        html = bodies.get(url)
        digest = candidate.get("detail_body_sha256")
        if (not isinstance(digest, str) or not DIGEST.fullmatch(digest) or html is None
                or sha256(html) != digest or delta.get("detail_body_sha256") != digest):
            fail("AUTHORITY_HTML_DIGEST_MISMATCH")
        fingerprint = card_fingerprint(row)
        if candidate.get("index_fingerprint") != fingerprint or delta.get("index_fingerprint") != fingerprint:
            fail("AUTHORITY_INDEX_FINGERPRINT_MISMATCH")
        provider_html(evidence, url, html)
        try:
            parsed = parse_28_detail(html, row, require_live_identity=True)
        except (WorkerError, ValueError, TypeError):
            fail("AUTHORITY_DETAIL_PARSE_FAILED")
        compare_facts(accepted, parsed)
    return len(listing_keys)


def verify_files(request_path, evidence_path):
    """Read each immutable input once and bind the proof to its exact bytes."""
    try:
        request_bytes = Path(request_path).read_bytes()
        evidence_bytes = Path(evidence_path).read_bytes()
        if len(request_bytes) > MAX_INPUT_BYTES or len(evidence_bytes) > MAX_INPUT_BYTES:
            fail("AUTHORITY_INPUT_TOO_LARGE")
        request = json.loads(request_bytes)
        evidence = json.loads(evidence_bytes)
    except (OSError, ValueError, UnicodeError):
        fail("AUTHORITY_INPUT_UNREADABLE")
    count = verify_authority_facts(request, evidence)
    return {"version": PROOF_VERSION, "status": "verified", "request_sha256": sha256(request_bytes),
            "evidence_sha256": sha256(evidence_bytes), "parser_version": PARSER_VERSION,
            "record_count": count}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.output.resolve() in (args.request.resolve(), args.evidence.resolve()):
        print(json.dumps({"version": PROOF_VERSION, "status": "rejected"}))
        return 1
    try:
        proof = verify_files(args.request, args.evidence)
    except AuthorityVerificationError:
        atomic_bytes(args.output, (json.dumps({"version": PROOF_VERSION, "status": "rejected"}) + "\n").encode())
        print(json.dumps({"version": PROOF_VERSION, "status": "rejected"}))
        return 1
    atomic_bytes(args.output, (json.dumps(proof, sort_keys=True) + "\n").encode())
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
