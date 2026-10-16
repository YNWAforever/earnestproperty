"""Manual candidate comparison and private evidence output, without apply authority."""
import copy
import hashlib
import html
import json
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path, PureWindowsPath

from .exa import strict_json
from .propertyhk_candidates import group_language_observations, normalize_detail_url, semantic_value
from .propertyhk_text import ALIASES

GROUPS = ("fetch_failures", "identity_conflicts", "insufficient_data",
          "field_differences", "known_candidates", "new_candidates")
AUTHORITY = {name: False for name in (
    "full_snapshot", "ingestion_allowed", "eligible_for_absence", "publish_allowed", "baseline_advanced"
)}
FIELD_NAMES = set(ALIASES) - {"sale", "rent", "language"} | {"offers"}


def _validate_reference(value):
    try:
        if (not isinstance(value, dict) or value.get("kind") != "propertyhk-exa-known/v1"
                or type(value.get("synthetic")) is not bool
                or not isinstance(value.get("provenance"), dict)
                or value["provenance"].get("source") != "propertyhk"
                or not value["provenance"].get("reference")
                or not isinstance(value.get("entries"), list)):
            raise ValueError
        seen = set()
        for entry in value["entries"]:
            if not isinstance(entry, dict):
                raise ValueError
            key = entry.get("review_key")
            if (not isinstance(key, list) or len(key) != 3 or key[0] != "propertyhk"
                    or not isinstance(key[1], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", key[1])
                    or not isinstance(key[2], str) or not re.fullmatch(r"[0-9]+", key[2])
                    or tuple(key) in seen):
                raise ValueError
            seen.add(tuple(key))
            for name in ("source_property_number", "agency_reference"):
                if entry.get(name) is not None and not isinstance(entry[name], str):
                    raise ValueError
            datetime.fromisoformat(entry["observed_at"])
            if not isinstance(entry.get("evidence"), dict) or not entry["evidence"].get("reference"):
                raise ValueError
            fields = entry["fields"]
            if not isinstance(fields, dict) or not set(fields) <= FIELD_NAMES:
                raise ValueError
            for name, field in fields.items():
                if (not isinstance(field, dict) or field.get("state") not in ("valid", "missing", "unparsed", "conflict")
                        or not all(isinstance(field.get(k), list) for k in ("raw", "evidence", "alternatives"))):
                    raise ValueError
                observed = field.get("value")
                if observed is not None:
                    if name in ("saleable_area", "gross_area"):
                        if (not isinstance(observed, dict) or observed.get("unit") not in ("sq_ft", "sq_m")
                                or type(observed.get("approximate")) is not bool
                                or not isinstance(observed.get("amount"), str)
                                or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", observed["amount"])):
                            raise ValueError
                    elif name in ("source_updated", "source_published"):
                        if not isinstance(observed, dict) or not isinstance(observed.get("iso"), str):
                            raise ValueError
                        datetime.fromisoformat(observed["iso"])
                    elif name == "contacts":
                        if not isinstance(observed, list) or any(not isinstance(x, dict) for x in observed):
                            raise ValueError
                    elif name != "offers" and not isinstance(observed, str):
                        raise ValueError
                if name == "offers" and field.get("value") is not None:
                    if not isinstance(field["value"], list):
                        raise ValueError
                    deals = set()
                    for offer in field["value"]:
                        if not isinstance(offer, dict) or offer.get("deal_type") not in ("sale", "rent"):
                            raise ValueError
                        if offer["deal_type"] in deals:
                            raise ValueError
                        deals.add(offer["deal_type"])
                        amount = offer.get("amount")
                        if amount is not None and (not isinstance(amount, str)
                                or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", amount) or Decimal(amount) <= 0):
                            raise ValueError
        bindings = value.get("native_index", [])
        if not isinstance(bindings, list):
            raise ValueError
        bound_keys = set()
        for binding in bindings:
            if not isinstance(binding, dict):
                raise ValueError
            detail = normalize_detail_url(binding["normalized_url"])
            if (detail["normalized_url"] != binding["normalized_url"]
                    or detail["source_advertisement_id"] != binding.get("source_advertisement_id")
                    or not isinstance(binding.get("branch_id"), str) or not binding["branch_id"]
                    or not isinstance(binding.get("evidence"), dict) or not binding["evidence"]):
                raise ValueError
            key = (binding["normalized_url"], binding["branch_id"])
            if key in bound_keys:
                raise ValueError
            bound_keys.add(key)
        return value
    except (ValueError, TypeError, KeyError, ArithmeticError):
        raise ValueError("reference_invalid") from None


def evidence_path(root: Path, reference: str) -> Path:
    if (not isinstance(reference, str) or not reference or "\\" in reference
            or PureWindowsPath(reference).drive or Path(reference).is_absolute()
            or any(x in ("", ".", "..") for x in reference.split("/"))):
        raise ValueError("evidence_path_invalid")
    try:
        resolved = (root / reference).resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
        if not resolved.is_file():
            raise ValueError
        return resolved
    except (ValueError, OSError):
        raise ValueError("evidence_path_invalid") from None


def load_reference(path: Path) -> dict:
    try:
        raw = path.read_bytes()
        if len(raw) > 2097152:
            raise ValueError
        value = _validate_reference(strict_json(raw))
        for entry in value["entries"]:
            evidence = entry["evidence"]
            if "artifact" in evidence:
                artifact = evidence_path(path.parent, evidence["artifact"])
                if (not isinstance(evidence.get("sha256"), str)
                        or hashlib.sha256(artifact.read_bytes()).hexdigest() != evidence["sha256"]):
                    raise ValueError
        value = copy.deepcopy(value)
        value["_file_sha256"] = hashlib.sha256(raw).hexdigest()
        return value
    except (ValueError, OSError, TypeError):
        raise ValueError("reference_invalid") from None


def _chosen_fields(items):
    fields = {}
    for item in items:
        for name, field in item.get("fields", {}).items():
            if name not in fields or fields[name].get("value") is None and field.get("value") is not None:
                fields[name] = field
    return fields


def _differences(fields, reference):
    differences, reasons, compared = [], [], 0
    old_fields = reference["fields"]

    def append(name, old, candidate, old_field, candidate_field):
        nonlocal compared
        compared += 1
        if old != candidate:
            differences.append({
                "field": name, "reference": old, "candidate": candidate,
                "reference_raw": old_field.get("raw", []), "candidate_raw": candidate_field.get("raw", []),
                "reference_evidence": old_field.get("evidence", [reference["evidence"]]),
                "candidate_evidence": candidate_field.get("evidence", []),
            })

    for name, field in sorted(fields.items()):
        value = field.get("value")
        old_field = old_fields.get(name, {})
        old = old_field.get("value")
        if value is None or name in ("branch", "source_advertisement_id"):
            continue
        if field.get("state") in ("unparsed", "conflict"):
            reasons.append("comparison_unavailable:" + name)
            continue
        if name == "offers":
            old_offers = {x["deal_type"]: x for x in old or []}
            for offer in value:
                deal = offer["deal_type"]
                previous = old_offers.get(deal)
                if offer.get("amount") is None:
                    reasons.append("comparison_unavailable:offers." + deal)
                elif previous is not None and any(previous.get(k) != offer.get(k) for k in ("currency", "period", "unit")):
                    reasons.append("comparison_unavailable:offers." + deal)
                else:
                    append("offers." + deal + ".amount", previous.get("amount") if previous else None,
                           offer["amount"], old_field, field)
        elif name in ("saleable_area", "gross_area") and old is not None and old.get("unit") != value.get("unit"):
            reasons.append("comparison_unavailable:" + name)
        else:
            append(name, semantic_value(old), semantic_value(value), old_field, field)
    return differences, reasons, compared


def build_review_report(observations: list[dict], *, known: dict | None, metrics: dict,
                        stop_reason: str | None, mode: str, retrieved_at: str, synthetic: bool) -> dict:
    if type(synthetic) is not bool or (mode == "fixture") != synthetic or mode not in ("fixture", "online"):
        raise ValueError("report_provenance_invalid")
    if known is not None:
        _validate_reference(known)
        if known["synthetic"] != synthetic:
            raise ValueError("reference_provenance_mismatch")
    lookup = {tuple(x["review_key"]): x for x in known["entries"]} if known else {}
    matched, groups, compared = set(), {name: [] for name in GROUPS}, 0
    language_groups = group_language_observations(observations)
    for group in language_groups:
        items = group["observations"]
        fields = _chosen_fields(items)
        key = group["review_key"]
        reference = lookup.get(tuple(key)) if key else None
        if reference:
            matched.add(tuple(key))
        reasons = sorted(set(group["reasons"] + [r for x in items for r in x.get("reasons", [])]))
        differences, unavailable, count = _differences(fields, reference) if reference else ([], [], 0)
        compared += count
        reasons = sorted(set(reasons + unavailable))
        identity_conflict = any(x["identity"]["state"] == "conflict" for x in items) or "language_identity_conflict" in reasons
        if reference:
            identity_conflict |= any(
                reference.get(name) is not None and item["identity"].get(name) is not None
                and reference[name] != item["identity"][name]
                for item in items for name in ("source_property_number", "agency_reference")
            )
            if identity_conflict:
                reasons = sorted(set(reasons + ["known_identity_conflict"]))
        offers = fields.get("offers", {}).get("value") or []
        ready = (key is not None and any(fields.get(name, {}).get("value") for name in ("estate", "address"))
                 and any(x.get("amount") is not None and x.get("currency") == "HKD"
                         and (x["deal_type"] == "sale" or x.get("period") is not None) for x in offers))
        if any(x.get("parse_state") == "fetch_failed" for x in items):
            category = "fetch_failures"
        elif identity_conflict:
            category = "identity_conflicts"
        elif (not ready or any(x.get("parse_state") == "unparsed" for x in items) or unavailable
              or any(x.startswith("field_conflict:") or x.endswith(("_conflict", "_unparsed")) for x in reasons)):
            category = "insufficient_data"
        else:
            category = "field_differences" if differences else "known_candidates" if reference else "new_candidates"
        groups[category].append({
            "review_key": key, "observations": copy.deepcopy(items), "reasons": reasons,
            "differences": differences, "missing_fields": sorted(name for name in FIELD_NAMES if fields.get(name, {}).get("value") is None),
            "reference_identity": {name: reference.get(name) for name in ("review_key", "source_property_number", "agency_reference")}
            if reference else None,
        })
    for entries in groups.values():
        entries.sort(key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
    return {
        "kind": "propertyhk-exa-review/v1", "mode": mode, "synthetic": synthetic,
        "retrieved_at": retrieved_at, **AUTHORITY, "production_writes": 0,
        "comparison_performed": known is not None,
        "reference": {"sample_size": len(lookup), "matched_review_identities": len(matched),
                      "provenance": copy.deepcopy(known["provenance"]), "file_sha256": known.get("_file_sha256")} if known else None,
        "groups": groups, "metrics": {
            **copy.deepcopy(metrics),
            "parsed_observations": sum(x.get("parse_state") == "parsed" for x in observations),
            "unparsed_observations": sum(x.get("parse_state") == "unparsed" for x in observations),
            "identity_conflicting_observations": sum(x["identity"].get("state") == "conflict" for x in observations),
            "language_groups": sum(len({x.get("language") for x in group["observations"] if x.get("language")}) > 1
                                   for group in language_groups),
            "comparable_fields": compared,
            "group_counts": {name: len(items) for name, items in groups.items()},
        }, "stop_reason": stop_reason,
        "limitations": ["Discovery is not full inventory coverage or active-listing verification.",
                        "No provided reference means no claim about production absence.",
                        "Source access and reuse rights remain independently required.",
                        "Synthetic evidence does not establish real provider retrieval." if synthetic else
                        "Provider text is not an original source HTTP/HTML response."],
    }


def _markdown(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return re.sub(r"([\\`*_[\]{}()#+.!|>-])", r"\\\1", html.escape(text)).replace("\r", "").replace("\n", " / ")


def _render(report):
    rows = ["# Property.hk candidate review", "",
            "**SYNTHETIC FIXTURE EVIDENCE**" if report["synthetic"] else "Provider text evidence for manual review.",
            "", "No import, publication, absence or baseline authority.", ""]
    rows += [_markdown(x) for x in report["limitations"]]
    for name in GROUPS:
        entries = report["groups"][name]
        rows += ["", "## " + name + " (" + str(len(entries)) + ")", ""]
        for entry in entries:
            rows += ["Review identity: " + _markdown(entry["review_key"]), "",
                     "Reasons: " + _markdown(entry["reasons"]), "",
                     "| Field | Reference | Candidate | Evidence |", "| --- | --- | --- | --- |"]
            for difference in entry["differences"]:
                evidence = {"reference": difference["reference_evidence"], "candidate": difference["candidate_evidence"],
                            "reference_raw": difference["reference_raw"], "candidate_raw": difference["candidate_raw"]}
                rows.append("| " + " | ".join(_markdown(x) for x in (
                    difference["field"], difference["reference"], difference["candidate"], evidence)) + " |")
            for observation in entry["observations"]:
                digest = observation.get("content_sha256")
                if digest:
                    rows += ["", f"Provider text: [SHA-256 {digest}](evidence/text/{digest}.txt)"]
                rows += ["", "Observed fields and evidence: " + _markdown(observation.get("fields", {})), ""]
    rows += ["", "Metrics: " + _markdown(report["metrics"]), "", "Stop: " + _markdown(report["stop_reason"]), ""]
    return "\n".join(rows)


def write_review_artifacts(report: dict, output_dir: Path) -> dict[str, Path]:
    if (report.get("kind") != "propertyhk-exa-review/v1"
            or any(report.get(name) is not False for name in AUTHORITY)
            or type(report.get("production_writes")) is not int or report["production_writes"] != 0):
        raise ValueError("report_authority_invalid")
    texts = {}
    for entries in report["groups"].values():
        for entry in entries:
            for observation in entry["observations"]:
                text, digest = observation.get("text"), observation.get("content_sha256")
                if text is None and digest is None:
                    continue
                if (not isinstance(text, str) or not isinstance(digest, str)
                        or not re.fullmatch(r"[0-9a-f]{64}", digest)
                        or hashlib.sha256(text.encode("utf-8")).hexdigest() != digest):
                    raise ValueError("evidence_hash_invalid")
                texts[digest] = text.encode("utf-8")
    raw_report = (json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    markdown = _render(report).encode("utf-8")
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("output_directory_exists")
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "evidence/text").mkdir(parents=True)
    files = {"report.json": raw_report, "report.md": markdown}
    files.update({f"evidence/text/{digest}.txt": raw for digest, raw in sorted(texts.items())})
    manifest = {"kind": "propertyhk-exa-evidence/v1", "synthetic": report["synthetic"],
                "source": "propertyhk", "provider": "exa", "content_format": "provider_text", "files": []}
    for relative, raw in sorted(files.items()):
        (output_dir / relative).write_bytes(raw)
        manifest["files"].append({"path": relative, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    (output_dir / "evidence/manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return {"json": output_dir / "report.json", "markdown": output_dir / "report.md",
            "manifest": output_dir / "evidence/manifest.json"}
