"""Standalone candidate review. Offline synthetic fixtures are the default."""
import argparse
import copy
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping

from scraping.exa import ExaClient, ExaError, exa_http_request, strict_json, validated_limits
from scraping.propertyhk_candidates import normalize_detail_url, validate_query_plan
from scraping.propertyhk_review import build_review_report, evidence_path, load_reference, write_review_artifacts
from scraping.propertyhk_text import PARSER_VERSION, parse_provider_text


def _read_json(path):
    with path.open("rb") as source:
        raw = source.read(2097153)
    if len(raw) > 2097152:
        raise ValueError("input_too_large")
    return strict_json(raw)


def config_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def load_review_config(path: Path, *, online: bool) -> dict:
    value = _read_json(path)
    keys = {"kind", "synthetic", "query_plan", "fixture_aliases", "limits", "approval_refs"}
    if (not isinstance(value, dict) or set(value) != keys or value["kind"] != "propertyhk-exa-config/v1"
            or type(value["synthetic"]) is not bool or value["synthetic"] == online
            or not isinstance(value["fixture_aliases"], dict)
            or online and value["fixture_aliases"]
            or not isinstance(value["approval_refs"], dict)
            or set(value["approval_refs"]) != {"query_plan", "source_access", "content_reuse", "online_trial"}):
        raise ValueError("config_invalid")
    value["query_plan"] = validate_query_plan(value["query_plan"], synthetic=value["synthetic"])
    value["limits"] = validated_limits(value["limits"])
    if len(value["query_plan"]) > value["limits"]["max_queries"]:
        raise ValueError("query_plan_limit")
    normalize_detail_url("https://www.property.hk/asking_detail/0.html",
                         fixture_aliases=value["fixture_aliases"], online=online)
    return value


def validate_online_approval(config: dict, environ: Mapping[str, str]) -> str:
    if (environ.get("PROPERTYHK_EXA_ONLINE_ENABLED") != "true"
            or config.get("synthetic") is not False or config.get("fixture_aliases")):
        raise ValueError("online_not_approved")
    refs = config.get("approval_refs", {})
    for name in ("query_plan", "source_access", "content_reuse", "online_trial"):
        entry = refs.get(name)
        if (not isinstance(entry, dict) or entry.get("approved") is not True
                or entry.get("hostname") != "property.hk" or not isinstance(entry.get("reference"), str)
                or not entry["reference"].strip()):
            raise ValueError("online_not_approved")
    query_hash, limits_hash = config_digest(config["query_plan"]), config_digest(config["limits"])
    if (refs["query_plan"].get("query_plan_sha256") != query_hash
            or refs["online_trial"].get("query_plan_sha256") != query_hash
            or refs["online_trial"].get("limits_sha256") != limits_hash):
        raise ValueError("online_approval_changed")
    token = environ.get("EXA_API_KEY", "")
    if not isinstance(token, str) or not token or len(token) > 1024 or re.search(r"\s", token):
        raise ValueError("api_key_required")
    return token


class _FixtureRequest:
    def __init__(self, bundle_dir):
        manifest = _read_json(bundle_dir / "manifest.json")
        if (not isinstance(manifest, dict) or manifest.get("kind") != "propertyhk-exa-fixtures/v1"
                or manifest.get("synthetic") is not True or not isinstance(manifest.get("artifacts"), dict)
                or set(manifest["artifacts"]) != {"discovery", "contents", "query_plan"}):
            raise ValueError("fixture_manifest_invalid")
        documents = {name: _read_json(evidence_path(bundle_dir, relative))
                     for name, relative in manifest["artifacts"].items()}
        expected = {"discovery": "propertyhk-exa-discovery-fixtures/v1",
                    "contents": "propertyhk-exa-contents-fixtures/v1", "query_plan": "propertyhk-exa-query-fixtures/v1"}
        if any(not isinstance(value, dict) or value.get("synthetic") is not True or value.get("kind") != expected[name]
               for name, value in documents.items()):
            raise ValueError("fixture_provenance_invalid")
        self.query_plan = validate_query_plan(documents["query_plan"]["query_plan"], synthetic=True)
        self.discovery = {}
        for query in documents["discovery"]["queries"]:
            if query["query"] in self.discovery:
                raise ValueError("fixture_duplicate_query")
            self.discovery[query["query"]] = query["response"]
        self.pages = {}
        for item in documents["contents"]["pages"]:
            if item["url"] in self.pages:
                raise ValueError("fixture_duplicate_url")
            row = copy.deepcopy(item)
            if "text_file" in row:
                raw_path = evidence_path(bundle_dir, row.pop("text_file"))
                with raw_path.open("rb") as source:
                    raw = source.read(2097153)
                if len(raw) > 2097152:
                    raise ValueError("fixture_text_too_large")
                row["text"] = raw.decode("utf-8")
            self.pages[row["url"]] = row
        self._now = datetime.fromisoformat(manifest["retrieved_at"])
        if self._now.tzinfo is None:
            raise ValueError("fixture_time_invalid")
        self._seconds = 0.0

    def now(self):
        return self._now + timedelta(seconds=self._seconds)

    def monotonic(self):
        return self._seconds

    def sleep(self, seconds):
        self._seconds += seconds

    def __call__(self, endpoint, payload, token, *, timeout_seconds, max_bytes):
        if token is not None:
            raise ExaError("fixture_credentials_forbidden")
        options = strict_json(payload)
        if endpoint == "https://api.exa.ai/search":
            response = self.discovery.get(options.get("query"))
            if response is None:
                raise ExaError("fixture_query_missing")
        elif endpoint == "https://api.exa.ai/contents":
            response = {"requestId": "synthetic-contents", "results": [], "statuses": [],
                        "costDollars": {"total": len(options["urls"]) / 1000}}
            for url in options["urls"]:
                row = self.pages.get(url)
                if row is None:
                    raise ExaError("fixture_url_missing")
                response["statuses"].append(row["status"])
                if row["status"]["status"] == "success":
                    response["results"].append({"id": row.get("provider_document_id"), "url": url, "text": row["text"]})
        else:
            raise ExaError("fixture_endpoint_invalid")
        return 200, {}, json.dumps(response, ensure_ascii=False, default=float, allow_nan=False).encode("utf-8")


def load_fixture_request(bundle_dir: Path):
    try:
        return _FixtureRequest(bundle_dir)
    except (KeyError, TypeError, UnicodeError):
        raise ValueError("fixture_invalid") from None


def _failed_observation(page, scopes):
    detail = page["detail"]
    return {
        "detail": detail, "query_scopes": scopes, "identity": {
            "state": "missing", "review_key": None, "branch_id": None,
            "source_advertisement_id": detail["source_advertisement_id"],
            "source_property_number": None, "agency_reference": None, "reasons": page["reasons"],
        },
        "language": detail.get("language"), "fields": {}, "provider": page["provider"],
        "text": None, "content_sha256": None, "parser_version": PARSER_VERSION,
        "content_format": "provider_text", "parse_state": "fetch_failed", "reasons": page["reasons"],
    }


def run_review(config: dict, *, client: ExaClient, known: dict | None, now) -> dict:
    discovered, observations, discovery_reports = {}, [], []
    for scope in config["query_plan"]:
        if client.stop_reason:
            break
        discovery = client.discover(scope)
        discovery_reports.append(discovery)
        for result in discovery["results"]:
            item = discovered.setdefault(result["normalized_url"], {"detail": result, "scopes": {}})
            item["scopes"][scope["query_id"]] = scope
    contents = client.contents(list(discovered))
    for page in contents["pages"]:
        scopes = list(discovered[page["detail"]["normalized_url"]]["scopes"].values())
        if page["status"] != "success":
            observations.append(_failed_observation(page, scopes))
            continue
        by_branch = {}
        for scope in scopes:
            by_branch.setdefault(scope["branch_id"], []).append(scope)
        for branch, branch_scopes in sorted(by_branch.items()):
            index = next((item for item in (known or {}).get("native_index", [])
                          if item["normalized_url"] == page["detail"]["normalized_url"] and item["branch_id"] == branch), None)
            parsed = parse_provider_text(page["text"], detail=page["detail"], scope=branch_scopes[0],
                                         provider=page["provider"], native_index=index)
            parsed["query_scopes"] = branch_scopes
            parsed["reasons"] += page["reasons"]
            observations.append(parsed)
    report = build_review_report(
        observations, known=known, metrics={**client.metrics, "queries_planned": len(config["query_plan"]),
                                            "unique_discovered_urls": len(discovered)},
        stop_reason=client.stop_reason, mode="fixture" if config["synthetic"] else "online",
        retrieved_at=now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), synthetic=config["synthetic"],
    )
    report["discovery"] = discovery_reports
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fixture-bundle", type=Path)
    mode.add_argument("--online", action="store_true")
    parser.add_argument("--known", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists() or args.output.is_symlink():
            raise ValueError("output_directory_exists")
        config = load_review_config(args.config, online=args.online)
        known = load_reference(args.known) if args.known else None
        if args.online:
            token = validate_online_approval(config, os.environ)
            request, now, monotonic, sleep = exa_http_request, lambda: datetime.now(timezone.utc), time.monotonic, time.sleep
        else:
            if args.fixture_bundle is None:
                raise ValueError("offline_fixture_required")
            token = None
            request = load_fixture_request(args.fixture_bundle)
            if request.query_plan != config["query_plan"]:
                raise ValueError("fixture_query_plan_mismatch")
            now, monotonic, sleep = request.now, request.monotonic, request.sleep
        client = ExaClient(request=request, now=now, monotonic=monotonic, sleep=sleep,
                           limits=config["limits"], token=token,
                           fixture_aliases=config["fixture_aliases"], online=args.online)
        report = run_review(config, client=client, known=known, now=now)
        paths = write_review_artifacts(report, args.output)
        print(json.dumps({"synthetic": report["synthetic"], "report": str(paths["json"]),
                          "groups": {name: len(items) for name, items in report["groups"].items()},
                          "stop_reason": report["stop_reason"]}, sort_keys=True))
        return 3 if report["stop_reason"] else 0
    except (ValueError, OSError) as error:
        reason = str(error) if re.fullmatch(r"[a-z_]{1,80}", str(error)) else "input_or_output_invalid"
        print("Property.hk review failed: " + reason, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
