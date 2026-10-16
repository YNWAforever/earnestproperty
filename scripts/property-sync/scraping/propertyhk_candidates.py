"""Conservative identities for review only; never canonical listing authority."""
import copy
import json
import re
from urllib.parse import urlsplit


class CandidateError(ValueError):
    """Only a fixed reason code may leave a validation boundary."""


def normalize_detail_url(raw_url: str, *, fixture_aliases: dict[str, str] | None = None,
                         online: bool = False) -> dict:
    try:
        if (not isinstance(raw_url, str) or len(raw_url) > 2048
                or any(ord(c) <= 32 or ord(c) == 127 for c in raw_url)
                or any(c in raw_url for c in "\\%?#") or not raw_url.startswith("https://")):
            raise ValueError
        parsed = urlsplit(raw_url)
        if parsed.netloc.lower() not in ("property.hk", "www.property.hk"):
            raise ValueError
        match = re.fullmatch(r"/asking_detail/([0-9]+)\.html", parsed.path)
        language = None
        if fixture_aliases:
            if online or not isinstance(fixture_aliases, dict):
                raise ValueError
            for template, lang in fixture_aliases.items():
                if (not isinstance(template, str) or template.count("{id}") != 1
                        or not template.startswith("/") or "//" in template
                        or any(x in template for x in ("..", "\\", "%", "?", "#"))
                        or not isinstance(lang, str) or not re.fullmatch(r"[a-zA-Z-]{2,20}", lang)):
                    raise ValueError
                alias = re.fullmatch(re.escape(template).replace(r"\{id\}", r"([0-9]+)"), parsed.path)
                if alias:
                    if match is not None:
                        raise ValueError
                    match, language = alias, lang
        if match is None:
            raise ValueError
        return {"original_url": raw_url, "normalized_url": "https://www.property.hk" + parsed.path,
                "source_advertisement_id": match.group(1), "language": language}
    except (ValueError, TypeError, AttributeError):
        raise CandidateError("url_not_allowed") from None


def validate_query_plan(entries: list[dict], *, synthetic: bool) -> list[dict]:
    keys = {"query_id", "branch_id", "branch_labels", "estate_terms", "district_terms", "query_terms"}
    try:
        if not isinstance(entries, list) or not 1 <= len(entries) <= 4 or type(synthetic) is not bool:
            raise ValueError
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != keys:
                raise ValueError
            for key in ("query_id", "branch_id"):
                value = entry[key]
                if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", value):
                    raise ValueError
            if entry["query_id"] in seen:
                raise ValueError
            seen.add(entry["query_id"])
            for key in ("branch_labels", "estate_terms", "district_terms", "query_terms"):
                values = entry[key]
                if not isinstance(values, list) or len(values) > 16 or any(
                    not isinstance(v, str) or not v.strip() or len(v) > 160
                    or any(ord(c) < 32 for c in v) for v in values
                ):
                    raise ValueError
                if len(set(values)) != len(values):
                    raise ValueError
            approved = set(entry["branch_labels"] + entry["estate_terms"] + entry["district_terms"])
            if not entry["branch_labels"] or not entry["query_terms"] or not set(entry["query_terms"]) <= approved:
                raise ValueError
        return copy.deepcopy(entries)
    except (ValueError, TypeError, KeyError):
        raise CandidateError("query_plan_invalid") from None


def validate_review_identity(detail: dict, fields: dict, scope: dict, *,
                             native_index: dict | None = None) -> dict:
    def value(name):
        item = fields.get(name, {})
        return item.get("value") if item.get("state") == "valid" else None

    reasons, conflicts = [], []
    ad = value("source_advertisement_id")
    branch = value("branch")
    for name in ("source_advertisement_id", "branch", "source_property_number", "agency_reference"):
        if fields.get(name, {}).get("state") == "conflict":
            conflicts.append("identity_field_conflict:" + name)
    if ad is None:
        reasons.append("main_advertisement_id_missing")
    elif ad != detail["source_advertisement_id"]:
        conflicts.append("main_advertisement_id_mismatch")
    branch_id = None
    if branch is not None:
        if branch not in scope["branch_labels"]:
            conflicts.append("branch_scope_mismatch")
        else:
            branch_id = scope["branch_id"]
    if native_index is not None:
        if (native_index.get("normalized_url") != detail["normalized_url"]
                or native_index.get("source_advertisement_id") != detail["source_advertisement_id"]
                or native_index.get("branch_id") != scope["branch_id"]
                or not isinstance(native_index.get("evidence"), dict)
                or not native_index["evidence"]):
            conflicts.append("native_index_identity_mismatch")
        elif branch_id is None and branch is None:
            branch_id = scope["branch_id"]
    if branch_id is None:
        reasons.append("observed_branch_missing")
    state = "conflict" if conflicts else ("missing" if reasons else "verified")
    return {
        "state": state, "branch_id": branch_id, "source_advertisement_id": detail["source_advertisement_id"],
        "source_property_number": value("source_property_number"), "agency_reference": value("agency_reference"),
        "review_key": ["propertyhk", branch_id, detail["source_advertisement_id"]] if state == "verified" else None,
        "reasons": sorted(set(conflicts + reasons)),
    }


def semantic_value(value):
    """Remove evidence presentation when comparing observed normalized values."""
    if isinstance(value, dict):
        return {k: semantic_value(v) for k, v in value.items()
                if k not in ("raw", "evidence") and not k.startswith("raw_")}
    if isinstance(value, list):
        result = [semantic_value(x) for x in value]
        return sorted(result, key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
    return value


def group_language_observations(observations: list[dict]) -> list[dict]:
    grouped, unresolved = {}, []
    ordered = sorted(observations, key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
    for observation in ordered:
        identity = observation["identity"]
        key = identity.get("review_key")
        if identity.get("state") != "verified" or key is None:
            unresolved.append({"review_key": None, "observations": [observation],
                               "reasons": list(identity.get("reasons", []))})
        else:
            grouped.setdefault(tuple(key), []).append(observation)
    result = []
    for key, items in sorted(grouped.items()):
        inconsistent = any(len({x["identity"].get(name) for x in items if x["identity"].get(name) is not None}) > 1
                           for name in ("source_property_number", "agency_reference"))
        if inconsistent:
            result.extend({"review_key": list(key), "observations": [x], "reasons": ["language_identity_conflict"]}
                          for x in items)
            continue
        reasons = []
        for name in sorted({name for x in items for name in x.get("fields", {})}):
            if name in ("branch", "source_advertisement_id"):
                continue
            values = {json.dumps(semantic_value(x["fields"][name]["value"]), sort_keys=True, ensure_ascii=False)
                      for x in items if x.get("fields", {}).get(name, {}).get("value") is not None}
            if len(values) > 1:
                reasons.append("field_conflict:" + name)
        result.append({"review_key": list(key), "observations": items, "reasons": reasons})
    return result + unresolved
