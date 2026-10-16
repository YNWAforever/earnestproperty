"""Deterministic provider-text observations, independent of the HTML collector."""
import copy
import hashlib
import re
from datetime import date, datetime
from decimal import Decimal

from .propertyhk_candidates import semantic_value, validate_review_identity

PARSER_VERSION = "propertyhk-exa-text-v1"
ALIASES = {
    "source_advertisement_id": ("Advertisement ID", "\u5ee3\u544a\u7de8\u865f"),
    "source_property_number": ("Property number", "\u7269\u696d\u7de8\u865f"),
    "agency_reference": ("Agency reference", "\u4ee3\u7406\u76e4\u865f"),
    "branch": ("Branch", "\u5206\u884c"), "estate": ("Estate", "\u5c4b\u82d1"),
    "district": ("District", "\u5730\u5340"), "address": ("Address", "\u5730\u5740"),
    "block": ("Block", "\u5ea7\u6578"), "floor": ("Floor", "\u6a13\u5c64"),
    "unit": ("Unit", "\u5ba4\u865f"),
    "sale": ("Sale price", "\u552e\u50f9"), "rent": ("Rent", "\u79df\u91d1"),
    "saleable_area": ("Usable area", "\u5be6\u7528\u9762\u7a4d"),
    "gross_area": ("Gross area", "\u5efa\u7bc9\u9762\u7a4d"),
    "source_updated": ("Source updated", "\u66f4\u65b0\u65e5\u671f"),
    "source_published": ("Published", "\u520a\u767b\u65e5\u671f"),
    "contacts": ("Contact", "\u806f\u7d61\u4eba"),
    "observed_source_status": ("Status", "\u72c0\u614b"),
    "language": ("Language", "\u8a9e\u8a00"),
}
LABELS = {label.casefold(): name for name, labels in ALIASES.items() for label in labels}
HEADINGS = {"listing details": "en", "\u6a13\u76e4\u8a73\u60c5": "zh-Hant"}
NUMBER = r"(?:[0-9]{1,3}(?:,[0-9]{3}){1,4}|[0-9]{1,15})(?:\.[0-9]{1,6})?"


def _empty():
    return {"value": None, "state": "missing", "raw": [], "evidence": [], "alternatives": []}


def _assign(field, value, raw, evidence):
    field["raw"].append(raw)
    field["evidence"].append(evidence)
    if len(field["raw"]) == 1:
        field["value"] = value
        field["state"] = "valid" if value is not None else "unparsed"
    elif semantic_value(value) != semantic_value(field["value"]) or field["state"] == "conflict":
        if not field["alternatives"]:
            field["alternatives"].append({"value": field["value"], "evidence": field["evidence"][:-1]})
        field["alternatives"].append({"value": value, "evidence": [evidence]})
        field["value"], field["state"] = None, "conflict"


def _money(raw, deal, evidence):
    period_match = re.search(r"\s*(?:/\s*(?:month|\u6708)|per month)\s*$", raw, re.I)
    period = "month" if period_match else None
    value = raw[:period_match.start()].strip() if period_match else raw
    match = re.fullmatch(r"(HK\$|HKD)\s*(" + NUMBER + r")\s*(\u842c|[mM])?", value)
    amount, raw_unit, raw_currency = None, None, None
    if match:
        raw_currency, number, raw_unit = match.groups()
        amount = Decimal(number.replace(",", ""))
        amount *= Decimal("10000") if raw_unit == "\u842c" else Decimal("1000000") if raw_unit else Decimal(1)
        amount = format(amount.normalize(), "f") if amount > 0 else None
    if deal == "rent" and period is None:
        amount = None
    if deal == "sale" and period is not None:
        amount = None
    return {"deal_type": deal, "amount": amount, "currency": "HKD" if match else None,
            "unit": "HKD" if match else None, "period": period, "raw_currency": raw_currency,
            "raw_unit": raw_unit, "raw": raw, "evidence": [evidence]}


def _area(raw):
    match = re.fullmatch(r"(approx\.\s*|\u7d04\s*)?(" + NUMBER +
                         r")\s*(sq\s*ft|sq\s*m|\u544e|\u5e73\u65b9\u544e|\u5e73\u65b9\u7c73|\u33a1)", raw, re.I)
    if not match:
        return None
    approximate, amount, unit = match.groups()
    return {"amount": format(Decimal(amount.replace(",", "")).normalize(), "f"),
            "unit": "sq_ft" if unit.lower().replace(" ", "") in ("sqft", "\u544e", "\u5e73\u65b9\u544e") else "sq_m",
            "approximate": bool(approximate)}


def _date(raw):
    try:
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw):
            return {"iso": date.fromisoformat(raw).isoformat(), "precision": "date", "timezone": None}
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+(?:Z|[+-][0-9]{2}:[0-9]{2})?", raw):
            parsed = datetime.fromisoformat(raw)
            return {"iso": raw, "precision": "datetime", "timezone": parsed.strftime("%z") or None}
    except ValueError:
        pass
    return None


def parse_provider_text(text: str, *, detail: dict, scope: dict, provider: dict,
                        native_index: dict | None = None) -> dict:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    names = set(ALIASES) - {"sale", "rent", "language"}
    fields = {name: _empty() for name in names | {"offers"}}
    result = {"detail": copy.deepcopy(detail), "query_scopes": [copy.deepcopy(scope)],
              "identity": {}, "language": detail.get("language"), "fields": fields,
              "provider": copy.deepcopy(provider), "text": text, "content_sha256": digest,
              "content_format": "provider_text", "parser_version": PARSER_VERSION,
              "parse_state": "unparsed", "reasons": []}
    lines = list(text.splitlines(keepends=True))
    headings = []
    for index, line in enumerate(lines):
        match = re.fullmatch(r"\s*#{1,3}\s+(.+?)\s*", line.rstrip("\r\n"))
        if match:
            headings.append((index, match.group(1).casefold()))
    main = [(index, name) for index, name in headings if name in HEADINGS]
    if (len(main) != 1 or len(text.encode("utf-8")) > 2 * 1024 * 1024
            or any(index < main[0][0] for index, name in headings if name not in HEADINGS)):
        result["reasons"].append("main_block_unrecognized")
    else:
        start, title = main[0]
        end = next((index for index, _ in headings if index > start), len(lines))
        result["parse_state"] = "parsed"
        result["language"] = result["language"] or HEADINGS[title]
        offset, offers = 0, {}
        for line_number, line in enumerate(lines):
            content = line.rstrip("\r\n")
            match = re.fullmatch(r"\s*(?P<label>[^:\uff1a]+?)\s*[:\uff1a]\s*(?P<value>.*?)\s*", content)
            if start < line_number < end and match:
                name = LABELS.get(match.group("label").casefold())
                raw = match.group("value")
                evidence = {
                    "kind": "source_text", "content_sha256": digest,
                    "line_start": line_number + 1, "line_end": line_number + 1,
                    "char_start": offset + match.start("value"), "char_end": offset + match.end("value"), "raw": raw,
                }
                if name == "language":
                    if raw in ("en", "zh-Hant", "zh-Hans"):
                        result["language"] = raw
                elif name in ("sale", "rent"):
                    offer = _money(raw, name, evidence)
                    offers.setdefault(name, []).append(offer)
                elif name in fields:
                    value = raw or None
                    if name == "source_advertisement_id" and not re.fullmatch(r"[0-9]+", raw):
                        value = None
                    elif name in ("saleable_area", "gross_area"):
                        value = _area(raw)
                    elif name in ("source_updated", "source_published"):
                        value = _date(raw)
                    elif name == "contacts":
                        parts = raw.split(" | ")
                        value = [{"name": parts[0], "phone": parts[1], "role": parts[2],
                                  "raw": raw, "evidence": [evidence]}] if len(parts) == 3 and all(parts) else None
                    _assign(fields[name], value, raw, evidence)
            offset += len(line)
        if offers:
            all_offers = [item for deal in ("sale", "rent") for item in offers.get(deal, [])]
            target = fields["offers"]
            target["raw"] = [item["raw"] for item in all_offers]
            target["evidence"] = [span for item in all_offers for span in item["evidence"]]
            conflict = any(len({(x["amount"], x["currency"], x["period"]) for x in values}) > 1
                           for values in offers.values())
            if conflict:
                target.update(state="conflict", alternatives=all_offers)
            else:
                target["value"] = [values[0] for values in offers.values()]
                target["state"] = "valid" if all(x["amount"] is not None for x in all_offers) else "unparsed"
    result["identity"] = validate_review_identity(detail, fields, scope, native_index=native_index)
    result["reasons"] += result["identity"]["reasons"]
    result["reasons"] += sorted(name + "_" + item["state"] for name, item in fields.items()
                                if item["state"] in ("unparsed", "conflict"))
    return result
