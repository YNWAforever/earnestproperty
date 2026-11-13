"""28Hse agent-540 index delta collector. Collection never accepts its own cache.

Cache files and raw evidence are private artifacts. Only freshly fetched, identity-checked
records enter the request; index membership never supplies detail or absence authority.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile
import uuid

from .checkpoint import atomic_bytes
from .worker import (
    Fetcher, WorkerError, collection_page_proof, http_request,
    parse_28_detail, parse_28_index,
)

ORIGIN = "https://www.28hse.com"
MODE = "index-delta-v1"
CACHE_VERSION = "28hse-index-cache-v1"
FINGERPRINT_VERSION = "observable-card-v1"
PATHS = [r"/agent/540", r"/(buy|rent)/[^/%]+/property-\d+/?"]


def timestamp(value=None):
    if value is None:
        value = datetime.now(timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise WorkerError("invalid_timestamp")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def instant(value):
    return datetime.fromisoformat(timestamp(value).replace("Z", "+00:00"))


def key_for(row):
    from .worker import clean_id
    ident = clean_id(row["property_id"], "28hse")
    deal = row["deal_type"]
    if deal not in ("sale", "rent"):
        raise WorkerError("invalid_deal_type")
    return f"28hse:agent:540:{deal}:{ident}"


def index_url(deal, page):
    return (f'{ORIGIN}/agent/540?buyRent={"buy" if deal == "sale" else "rent"}'
            f'&page={page}&plan_id=540&propertyDoSearchVersion=2.0')


def card_fingerprint(row):
    """Canonical facts only: no page, rank, age, views or source update assertion."""
    facts = {
        "version": FINGERPRINT_VERSION,
        "identity": key_for(row),
        "source_url": row["source_url"],
        "promotion_tier_raw": row.get("promotion_tier_raw", ""),
        "observable": row.get("index_observation", {"title": row.get("title")}),
    }
    return hashlib.sha256(json.dumps(facts, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def empty_cache():
    return {"schema_version": CACHE_VERSION, "source": "28hse", "scope_id": "agent:540",
            "fingerprint_version": FINGERPRINT_VERSION, "entries": {}}


def validate_cache(cache):
    if (not isinstance(cache, dict) or cache.get("schema_version") != CACHE_VERSION
            or cache.get("source") != "28hse" or cache.get("scope_id") != "agent:540"
            or cache.get("fingerprint_version") != FINGERPRINT_VERSION
            or not isinstance(cache.get("entries"), dict)):
        raise WorkerError("invalid_incremental_cache")
    for key, entry in cache["entries"].items():
        if not isinstance(entry, dict) or key_for(entry) != key:
            raise WorkerError("invalid_incremental_cache_identity")
        validate_detail_url(entry)
    return cache


def validate_detail_url(row):
    from .firecrawl import approved_url
    approved_url(row["source_url"])
    expected = "/buy/" if row["deal_type"] == "sale" else "/rent/"
    if (not row["source_url"].startswith(ORIGIN + expected)
            or not row["source_url"].rstrip("/").endswith("/property-" + row["property_id"])):
        raise WorkerError("invalid_incremental_cache_identity")


def validate_index_card(row):
    validate_detail_url(row)
    if not row.get("index_observation", {}).get("price_text"):
        raise WorkerError("index_card_price_unobserved")


def candidate_reasons(row, prior, now, ttl_days, previous_index_at=None):
    if not prior:
        return ["new"]
    reasons = []
    if prior.get("detail_index_fingerprint") != card_fingerprint(row):
        reasons.append("changed")
    reappeared = previous_index_at is not None and prior.get("index_seen_at") != previous_index_at
    if prior.get("pending_retry") or not prior.get("detail_record") or reappeared:
        reasons.append("retry")
    fetched = prior.get("detail_fetched_at")
    try:
        expired = (fetched is None or instant(fetched) > instant(now)
                   or instant(now) - instant(fetched) >= timedelta(days=ttl_days))
    except (ValueError, WorkerError):
        expired = True
    if expired:
        reasons.append("cache_expired")
    return reasons


class RequestBudget:
    """Count actual provider HTTP attempts, including key failover and retries."""
    def __init__(self, limit, request=None):
        self.limit = limit
        self.used = 0
        self.request = request or http_request

    def take(self):
        if self.used >= self.limit:
            raise WorkerError("request_budget_exhausted")
        self.used += 1

    def __call__(self, *args, **kwargs):
        self.take()
        return self.request(*args, **kwargs)


class FixtureBudget:
    def __init__(self, fixtures, budget):
        self.fixtures, self.budget = fixtures, budget

    def get(self, url):
        self.budget.take()
        return self.fixtures.get(url)


def collect_incremental(cache=None, *, fixtures=None, now=None, run_id=None,
                        max_pages=100, max_detail=60, max_requests=120,
                        ttl_days=7, max_refresh=40, transport="firecrawl-basic", request=None, sleep=None):
    """Return (request, report, evidence, proposed_cache); inputs remain unchanged."""
    if (type(max_pages) is not int or not 1 <= max_pages <= 1000
            or type(max_detail) is not int or not 0 <= max_detail <= 10000
            or type(max_requests) is not int or not 1 <= max_requests <= 100000
            or type(max_refresh) is not int or not 0 <= max_refresh <= 10000
            or not isinstance(ttl_days, (int, float)) or isinstance(ttl_days, bool)
            or not 0 < ttl_days <= 365):
        raise WorkerError("invalid_incremental_limits")
    if transport not in ("http", "firecrawl-basic"):
        raise WorkerError("configuration_transport")
    fixed_clock = now is not None
    now = timestamp(now)
    def observed_at():
        return now if fixed_clock else max(now, timestamp())
    cache = validate_cache(cache) if cache is not None else empty_cache()
    proposed = deepcopy(cache)
    budget = RequestBudget(max_requests, request)
    provider = None
    if transport == "firecrawl-basic" and fixtures is None:
        from .firecrawl import FirecrawlBasic
        provider = FirecrawlBasic(request=budget)
    bounded_fixtures = FixtureBudget(fixtures, budget) if fixtures is not None else None
    fetch = Fetcher(ORIGIN, PATHS, fixtures=bounded_fixtures, transport=provider or budget, sleep=sleep)

    def get(url):
        return fetch.get(url)

    pages, errors, members, completed = [], [], {}, []
    for deal in ("sale", "rent"):
        seen, signatures, totals = set(), set(), set()
        for page in range(1, max_pages + 1):
            proof = {"scope": deal, "page": page, "ids": [], "status": "failed",
                     "index_complete": False, "details_complete": False}
            try:
                url = index_url(deal, page)
                html = get(url)
                rows, terminal, total = parse_28_index(html, deal)
                totals.add(total)
                if len(totals) != 1:
                    raise WorkerError("advertised_count_changed")
                ids = sorted({row["property_id"] for row in rows})
                proof.update(ids=ids, advertised_total=total, source_url=url,
                             body_sha256=hashlib.sha256(html.encode()).hexdigest())
                if terminal:
                    proof.update(status="terminal", observed_distinct_total=len(seen))
                    if len(seen) != total:
                        raise WorkerError("advertised_count_mismatch")
                    proof["index_complete"] = True
                    completed.append(deal)
                    pages.append(proof)
                    break
                signature = tuple(ids)
                if signature in signatures:
                    raise WorkerError("pagination_loop")
                signatures.add(signature)
                seen.update(ids)
                for row in rows:
                    validate_index_card(row)
                    key = key_for(row)
                    fingerprint = card_fingerprint(row)
                    if key in members:
                        if members[key]["index_fingerprint"] != fingerprint:
                            raise WorkerError("conflicting_index_duplicate")
                        members[key]["occurrences"].append({"scope": deal, "page": page,
                                                          "source_url": row["source_url"]})
                    else:
                        members[key] = {**row, "index_fingerprint": fingerprint,
                                        "index_seen_at": now,
                                        "occurrences": [{"scope": deal, "page": page,
                                                         "source_url": row["source_url"]}]}
                proof.update(status="listings", index_complete=True)
                pages.append(proof)
            except (WorkerError, UnicodeError) as error:
                reason = str(error) if isinstance(error, WorkerError) else "invalid_source_encoding"
                proof.update(status="blocked" if reason in ("blocked", "robots_disallowed")
                             else "parser_error", error=reason)
                pages.append(proof)
                errors.append({"stage": "index", "scope": deal, "page": page, "reason": reason})
                break
        else:
            errors.append({"stage": "index", "scope": deal, "reason": "page_ceiling"})

    index_finished_at = observed_at()
    index_complete = completed == ["sale", "rent"] and not errors
    candidates, unchanged = [], []
    previous_index_at = cache.get("proposed_at") if cache.get("index_complete") else None
    for key, row in sorted(members.items()):
        prior = cache["entries"].get(key)
        # A retained detail may predate the last complete membership even within TTL.
        # Reappearing offers need fresh status/details; absence itself still changes no facts.
        reasons = candidate_reasons(row, prior, now, ttl_days, previous_index_at)
        current = deepcopy(prior) if prior else {}
        current.update({field: deepcopy(row[field]) for field in (
            "property_id", "deal_type", "source_url", "index_fingerprint", "index_seen_at",
            "index_observation") if field in row})
        current["source_updated_at"] = None
        current["source_updated_at_status"] = "unknown"
        proposed["entries"][key] = current
        if reasons:
            candidates.append({"property_id": row["property_id"], "deal_type": row["deal_type"],
                               "source_url": row["source_url"], "index_fingerprint": row["index_fingerprint"],
                               "reasons": reasons, "status": "pending", "detail_fetched_at": None})
        else:
            unchanged.append(key)

    # Changed/new/retry work takes priority. Periodic verification of index-unchanged
    # records rolls across days, so a cache seeded at one timestamp cannot cause a
    # weekly all-detail burst or permanently hit the hard request ceiling.
    urgent = [c for c in candidates if any(r != "cache_expired" for r in c["reasons"])]
    refresh = [c for c in candidates if c["reasons"] == ["cache_expired"]]
    refresh.sort(key=lambda c: cache["entries"][key_for(c)].get("detail_fetched_at", ""))
    refresh_limit = min(max_refresh, max(0, max_detail - len(urgent)))
    deferred_refresh = refresh[refresh_limit:]
    candidates = urgent + refresh[:refresh_limit]
    unchanged.extend(key_for(c) for c in deferred_refresh)

    # No paid details until both indexes are proven complete. This preserves budget and
    # prevents a partial index run from appearing to be a complete daily observation.
    listings, fetched_urls = [], set()
    for candidate in candidates:
        key = key_for(candidate)
        entry = proposed["entries"][key]
        entry["pending_retry"] = True
        entry.setdefault("pending_since", now)
        if not index_complete:
            candidate["reason"] = "incomplete_index"
            continue
        if len(fetched_urls) >= max_detail:
            candidate["reason"] = "max_detail_cap"
            continue
        url = candidate["source_url"]
        if url in fetched_urls:
            candidate["reason"] = "duplicate_detail_url"
            continue
        fetched_urls.add(url)
        try:
            detail = get(url)
            row = members[key]
            record = parse_28_detail(detail, row, require_live_identity=True)
            digest = hashlib.sha256(detail.encode()).hexdigest()
            fetched_at = observed_at()
            detail_evidence = {"source_url": url, "body_sha256": digest, "fetched_at": fetched_at,
                               "detail_identity": record["raw_payload"]["detail_identity"]}
            record["raw_payload"]["incremental"] = {
                "mode": MODE, "detail_fetched_at": fetched_at, "index_seen_at": now,
                "index_fingerprint": row["index_fingerprint"], "detail_body_sha256": digest,
                "source_updated_at": None, "source_updated_at_status": "unknown",
            }
            # These are independent evidence times, even when equal on a fresh fetch.
            record["detail_fetched_at"] = fetched_at
            record["index_seen_at"] = now
            record["source_updated_at"] = None
            listings.append(record)
            entry.update(detail_record=deepcopy(record), detail_fetched_at=fetched_at,
                         detail_evidence=detail_evidence,
                         detail_index_fingerprint=row["index_fingerprint"], pending_retry=False)
            entry.pop("last_error", None)
            entry.pop("pending_since", None)
            candidate.update(status="fetched", detail_fetched_at=fetched_at, detail_body_sha256=digest)
        except (WorkerError, UnicodeError) as error:
            reason = str(error) if isinstance(error, WorkerError) else "invalid_source_encoding"
            candidate.update(status="error", reason=reason)
            entry["last_error"] = {"reason": reason, "attempted_at": now}
            errors.append({"stage": "detail", "property_id": candidate["property_id"],
                           "deal_type": candidate["deal_type"], "reason": reason})

    pending = [deepcopy(c) for c in candidates if c["status"] != "fetched"]
    missing = []
    if index_complete:
        for key in sorted(set(cache["entries"]) - set(members)):
            prior = cache["entries"][key]
            missing.append({"property_id": prior["property_id"], "deal_type": prior["deal_type"],
                            "source_url": prior["source_url"], "status": "withdrawal_candidate",
                            "last_index_seen_at": prior.get("index_seen_at")})
    complete = index_complete and not pending and not errors
    incremental = {
        "mode": MODE, "fingerprint_version": FINGERPRINT_VERSION,
        "index_complete": index_complete, "index_seen_at": now,
        "index_started_at": now, "index_finished_at": index_finished_at,
        "deferred_refresh": deferred_refresh,
        "index_membership": [deepcopy(row) for _, row in sorted(members.items())],
        "selected_candidates": candidates, "pending_candidates": pending,
        "withdrawal_candidates": missing, "unchanged_count": len(unchanged),
        "cache_ttl_days": ttl_days, "max_detail": max_detail,
        "max_requests": max_requests,
        "requests_used": budget.used,
    }
    payload = {
        "source": "28hse", "branches": [], "id_scope": None, "scraped_at": observed_at(),
        "listings": listings,
        "meta": {"schema_version": "2.0", "run_id": run_id or str(uuid.uuid4()),
                 "scope_id": "agent:540", "policy_version": "no-hermes-v2",
                 "parser_version": "python-v2.2", "crawl_complete": complete,
                 "full_snapshot": False, "eligible_for_absence": False,
                 "pages_failed": sum(p["status"] not in ("listings", "terminal") for p in pages),
                 "worker_rejected_count": 0, "rejected_records": [],
                 "completed_branches": [], "pages": pages, "incremental": incremental},
    }
    reason_counts = dict.fromkeys(("new", "changed", "retry", "cache_expired"), 0)
    for candidate in candidates:
        for reason in reason_counts:
            if reason in candidate["reasons"]:
                reason_counts[reason] += 1
                break
    report = {"success": complete, "mode": MODE, "run_id": payload["meta"]["run_id"],
              "index_complete": index_complete, "membership_count": len(members),
              "selected_count": len(candidates), "fetched_count": len(listings),
              "sale_ids_seen": sum(row["deal_type"] == "sale" for row in members.values()),
              "rent_ids_seen": sum(row["deal_type"] == "rent" for row in members.values()),
              "index_pages_verified": sum(row["status"] in ("listings", "terminal") for row in pages),
              "candidate_counts": reason_counts,
              "index_started_at": now, "index_finished_at": index_finished_at,
              "last_fresh_detail_at": max((row["detail_fetched_at"] for row in listings), default=None),
              "unchanged_count": len(unchanged), "pending_count": len(pending),
              "deferred_refresh_count": len(deferred_refresh),
              "withdrawal_candidate_count": len(missing), "eligible_for_absence": False,
              "full_snapshot": False, "errors": errors,
              "requests_used": incremental["requests_used"],
              "cache_status": "proposed_only_requires_acceptance"}
    proposed.update(proposed_at=now, run_id=payload["meta"]["run_id"],
                    index_complete=index_complete, pending_candidates=pending)
    evidence = {"requests": fetch.evidence, "errors": errors, "index_pages": pages,
                "selected_candidates": deepcopy(candidates)}
    if provider is not None:
        evidence["provider_requests"] = provider.evidence
    return payload, report, evidence, proposed


def read_json_input(path, *, archive_member=None):
    """Read one bounded regular archive member, without extracting any archive paths."""
    path = Path(path)
    if tarfile.is_tarfile(path):
        with tarfile.open(path, "r:gz") as archive:
            names = archive.getnames()
            if archive_member is None:
                archive_member = "baseline/request.json"
            if archive_member not in names:
                raise WorkerError("bootstrap_archive_member_missing")
            member = archive.getmember(archive_member)
            if (not member.isfile() or member.size > 128 * 1024 * 1024
                    or PurePosixPath(member.name).is_absolute()
                    or ".." in PurePosixPath(member.name).parts):
                raise WorkerError("unsafe_bootstrap_archive_member")
            return json.load(archive.extractfile(member))
    if path.stat().st_size > 128 * 1024 * 1024:
        raise WorkerError("bootstrap_input_too_large")
    return json.loads(path.read_text(encoding="utf-8"))


def read_raw_input(path, run_id):
    path = Path(path)
    if not tarfile.is_tarfile(path):
        return read_json_input(path)
    # Prefer individual source responses. The legacy combined evidence also contains
    # duplicated provider bodies and can exceed 200 MB when uncompressed.
    prefix = f"checkpoints/28hse/agent-540/{run_id}/responses/"
    bodies, metadata = {}, {}
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            if not member.name.startswith(prefix) or not member.isfile():
                continue
            suffix = member.name[len(prefix):]
            if "/" in suffix or member.size > 2 * 1024 * 1024:
                raise WorkerError("unsafe_bootstrap_archive_member")
            if suffix.endswith(".body"):
                bodies[suffix[:-5]] = archive.extractfile(member).read().decode("utf-8")
            elif suffix.endswith(".json"):
                metadata[suffix[:-5]] = json.load(archive.extractfile(member))
    if not metadata or set(bodies) != set(metadata):
        raise WorkerError("bootstrap_raw_run_mismatch")
    return {"requests": [{**metadata[key], "html": bodies[key]} for key in sorted(metadata)]}


def bootstrap_cache(baseline, raw):
    """Seed historical facts only from a complete payload and its matching raw capture."""
    if (baseline.get("source") != "28hse" or baseline.get("meta", {}).get("scope_id") != "agent:540"
            or baseline.get("meta", {}).get("crawl_complete") is not True
            or not collection_page_proof(baseline)):
        raise WorkerError("bootstrap_requires_complete_baseline")
    fetched_at = timestamp(baseline["scraped_at"])
    requests = raw.get("requests", [])
    if not isinstance(requests, list):
        raise WorkerError("invalid_bootstrap_raw")
    by_url = {}
    for entry in requests:
        if entry.get("status") == 200 and isinstance(entry.get("html"), str):
            by_url[entry["url"]] = entry["html"]
    cache, members = empty_cache(), {}
    for page in baseline["meta"]["pages"]:
        url = index_url(page["scope"], page["page"])
        if url not in by_url:
            raise WorkerError("bootstrap_index_evidence_missing")
        rows, terminal, total = parse_28_index(by_url[url], page["scope"])
        if (sorted(row["property_id"] for row in rows) != sorted(page["ids"])
                or terminal != (page["status"] == "terminal")
                or total != page.get("advertised_total")):
            raise WorkerError("bootstrap_index_evidence_mismatch")
        for row in rows:
            key = key_for(row)
            if key in members and card_fingerprint(members[key]) != card_fingerprint(row):
                raise WorkerError("bootstrap_conflicting_index_duplicate")
            members[key] = row
    for record in baseline["listings"]:
        key = key_for(record)
        if key not in members or members[key]["source_url"] != record["source_url"]:
            raise WorkerError("bootstrap_record_identity_mismatch")
        row = members[key]
        validate_index_card(row)
        html = by_url.get(record["source_url"])
        if html is None:
            raise WorkerError("bootstrap_detail_evidence_missing")
        # Validate live identity, including deal type, without rewriting accepted facts.
        parsed = parse_28_detail(html, row, require_live_identity=True)
        fingerprint = card_fingerprint(row)
        cache["entries"][key] = {
            "property_id": row["property_id"], "deal_type": row["deal_type"],
            "source_url": row["source_url"], "index_fingerprint": fingerprint,
            "detail_index_fingerprint": fingerprint, "index_observation": row["index_observation"],
            "index_seen_at": fetched_at, "detail_fetched_at": fetched_at,
            "detail_record": deepcopy(record), "pending_retry": False,
            "source_updated_at": None, "source_updated_at_status": "unknown",
            "detail_evidence": {"source_url": record["source_url"], "fetched_at": fetched_at,
                                "body_sha256": hashlib.sha256(html.encode()).hexdigest(),
                                "detail_identity": parsed["raw_payload"]["detail_identity"],
                                "bootstrap_run_id": baseline["meta"].get("run_id")},
        }
    if set(members) != set(cache["entries"]):
        raise WorkerError("bootstrap_membership_mismatch")
    cache["bootstrap"] = {"run_id": baseline["meta"].get("run_id"),
                          "detail_fetched_at": fetched_at, "membership_count": len(members)}
    return cache


def cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--bootstrap-baseline", type=Path)
    parser.add_argument("--bootstrap-raw", type=Path)
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--max-detail", type=int, default=60)
    parser.add_argument("--max-requests", type=int, default=120)
    parser.add_argument("--cache-ttl-days", type=float, default=7)
    parser.add_argument("--max-refresh", type=int, default=40)
    parser.add_argument("--transport", choices=("http", "firecrawl-basic"), default="firecrawl-basic")
    parser.add_argument("--now", help="Explicit timezone-aware observation time for offline replay")
    args = parser.parse_args(argv)
    try:
        outputs = {name: (args.output_dir / name).resolve() for name in
                   ("request.json", "report.json", "evidence.json", "cache-next.json")}
        if args.cache and args.cache.resolve() in outputs.values():
            raise WorkerError("accepted_cache_output_collision")
        if bool(args.bootstrap_baseline) != bool(args.bootstrap_raw):
            raise WorkerError("bootstrap_requires_baseline_and_raw")
        if args.cache and args.cache.exists():
            cache = validate_cache(read_json_input(args.cache))
        elif args.bootstrap_baseline:
            baseline = read_json_input(args.bootstrap_baseline)
            cache = bootstrap_cache(baseline, read_raw_input(args.bootstrap_raw, baseline["meta"]["run_id"]))
        elif args.cache:
            raise WorkerError("accepted_cache_missing_requires_bootstrap")
        else:
            cache = empty_cache()
        fixtures = read_json_input(args.fixtures) if args.fixtures else None
        outputs = collect_incremental(
            cache, fixtures=fixtures, now=args.now, max_pages=args.max_pages,
            max_detail=args.max_detail, max_requests=args.max_requests,
            ttl_days=args.cache_ttl_days, max_refresh=args.max_refresh, transport=args.transport,
        )
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for name, data in zip(("request.json", "report.json", "evidence.json", "cache-next.json"), outputs):
            atomic_bytes(args.output_dir / name,
                         (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode())
        print(json.dumps(outputs[1], ensure_ascii=False))
        return 0 if outputs[1]["success"] else 1
    except (WorkerError, OSError, ValueError, KeyError, TypeError) as error:
        report = {"success": False, "mode": MODE,
                  "error": str(error) if isinstance(error, WorkerError) else type(error).__name__}
        report_path = args.output_dir / "report.json"
        if not args.cache or report_path.resolve() != args.cache.resolve():
            args.output_dir.mkdir(parents=True, exist_ok=True)
            atomic_bytes(report_path, (json.dumps(report) + "\n").encode())
        print(json.dumps(report))
        return 1
