"""Synthetic identity cases: no source access or provider credentials."""
import copy
import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
URL = "https://www.property.hk/asking_detail/00101.html"


def module():
    assert (Path(__file__).parents[1] / "scraping/propertyhk_candidates.py").exists(), "Candidate validator missing"
    return importlib.import_module("scraping.propertyhk_candidates")


def scope(branch="SYNTHETIC-A", query="q1"):
    return {
        "query_id": query, "branch_id": branch, "branch_labels": [branch],
        "estate_terms": ["Synthetic Gardens"], "district_terms": ["Synthetic District"],
        "query_terms": [branch, "Synthetic Gardens"],
    }


def field(value, state="valid"):
    return {"value": value, "state": state, "raw": [], "evidence": [], "alternatives": []}


def fields(branch="SYNTHETIC-A", ad="00101"):
    return {
        "source_advertisement_id": field(ad), "branch": field(branch),
        "source_property_number": field("SYN-P-01"), "agency_reference": field("SYN-A-01"),
    }


def observation(branch="SYNTHETIC-A", language="zh-Hant", amount="7100000"):
    return {
        "identity": {
            "state": "verified", "branch_id": branch, "source_advertisement_id": "00101",
            "source_property_number": "SYN-P-01", "agency_reference": "SYN-A-01",
            "review_key": ["propertyhk", branch, "00101"], "reasons": [],
        },
        "language": language, "fields": {"price": field(amount)}, "query_scopes": [scope(branch)],
        "content_sha256": language, "detail": {"normalized_url": URL},
    }


def test_native_url_keeps_advertisement_digits():
    actual = module().normalize_detail_url("https://property.hk/asking_detail/00101.html")
    assert actual["normalized_url"] == URL
    assert actual["source_advertisement_id"] == "00101"
    assert actual["original_url"] == "https://property.hk/asking_detail/00101.html"


@pytest.mark.parametrize("url", [
    "http://www.property.hk/asking_detail/101.html",
    "https://www.property.hk.evil.invalid/asking_detail/101.html",
    "https://other.property.hk/asking_detail/101.html",
    "https://user@www.property.hk/asking_detail/101.html",
    "https://www.property.hk:443/asking_detail/101.html",
    URL + "?tracking=1", URL + "?", URL + "#", URL + "#other",
    URL.replace("/asking_detail/", "/../asking_detail/"),
    URL.replace("/asking_detail/", "/%2e%2e/asking_detail/"),
    URL.replace("/asking_detail/", "/asking_detail%2f"),
    URL.replace("00101", "\uff11\uff10\uff11"),
    URL.replace("00101", "1e3"),
    URL.replace("www.property.hk/", "www.property.hk\\"),
    "\n" + URL, URL + "\t", URL.replace("00101", "10\n1"),
    URL.replace("asking_detail", "eng/asking_detail"),
    URL.replace("00101.html", "00101.html/"),
    None, 101,
])
def test_url_rejects_ambiguous_forms(url):
    m = module()
    with pytest.raises(m.CandidateError, match="url_not_allowed"):
        m.normalize_detail_url(url)


def test_fixture_alias_preserves_fetch_route_and_is_rejected_online():
    m = module()
    alias = "https://property.hk/fixture-en/asking_detail/00101.html"
    aliases = {"/fixture-en/asking_detail/{id}.html": "en"}
    actual = m.normalize_detail_url(alias, fixture_aliases=aliases)
    assert actual["source_advertisement_id"] == "00101"
    assert actual["normalized_url"] == "https://www.property.hk/fixture-en/asking_detail/00101.html"
    assert actual["language"] == "en"
    with pytest.raises(m.CandidateError):
        m.normalize_detail_url(alias, fixture_aliases=aliases, online=True)


def test_identity_requires_main_id_and_observed_branch():
    m = module()
    detail = m.normalize_detail_url(URL)
    values = fields()
    values["branch"] = field(None, "missing")
    assert m.validate_review_identity(detail, values, scope())["state"] == "missing"
    binding = {
        "normalized_url": URL, "source_advertisement_id": "00101",
        "branch_id": "SYNTHETIC-A", "evidence": {"reference": "synthetic-index"},
    }
    good = m.validate_review_identity(detail, values, scope(), native_index=binding)
    assert good["review_key"] == ["propertyhk", "SYNTHETIC-A", "00101"]
    assert good["source_property_number"] == "SYN-P-01"
    assert good["agency_reference"] == "SYN-A-01"
    values["source_advertisement_id"] = field(None, "missing")
    assert m.validate_review_identity(detail, values, scope(), native_index=binding)["state"] == "missing"
    values["source_advertisement_id"] = field("999")
    bad = m.validate_review_identity(detail, values, scope(), native_index=binding)
    assert bad["state"] == "conflict" and bad["review_key"] is None


@pytest.mark.parametrize("change", ["wrong_branch", "conflicting_branch", "wrong_index", "conflicting_property"])
def test_identity_conflicts_never_become_verified(change):
    m = module()
    values, binding = fields(), None
    if change == "wrong_branch":
        values["branch"] = field("SYNTHETIC-B")
    if change == "conflicting_branch":
        values["branch"] = field(None, "conflict")
    if change == "wrong_index":
        binding = {"normalized_url": URL, "source_advertisement_id": "999", "branch_id": "SYNTHETIC-A", "evidence": {}}
    if change == "conflicting_property":
        values["source_property_number"] = field(None, "conflict")
    actual = m.validate_review_identity(m.normalize_detail_url(URL), values, scope(), native_index=binding)
    assert actual["state"] == "conflict"
    assert actual["review_key"] is None


def test_query_terms_are_approved_and_bounded():
    m = module()
    assert m.validate_query_plan([scope()], synthetic=True)[0]["query_id"] == "q1"
    bad = []
    for key, value in [
        ("query_id", ""), ("branch_labels", []), ("query_terms", ["unapproved estate"]),
        ("extra", True), ("branch_id", True),
    ]:
        item = scope()
        item[key] = value
        bad.append([item])
    bad += [[scope(), scope()], [scope(query=f"q{x}") for x in range(5)]]
    for entries in bad:
        with pytest.raises(m.CandidateError, match="query_plan_invalid"):
            m.validate_query_plan(entries, synthetic=True)


def test_language_grouping_is_scoped_and_preserves_conflicts():
    m = module()
    zh, en, other = observation(), observation(language="en"), observation("SYNTHETIC-B")
    grouped = m.group_language_observations([other, en, zh])
    assert len(grouped) == 2
    assert len(grouped[0]["observations"]) == 2
    assert grouped[1]["review_key"] == ["propertyhk", "SYNTHETIC-B", "00101"]
    conflict = copy.deepcopy(en)
    conflict["identity"]["source_property_number"] = "OTHER-P"
    grouped = m.group_language_observations([zh, conflict])
    assert len(grouped) == 2
    assert all("language_identity_conflict" in x["reasons"] for x in grouped)
    conflict = observation(language="en", amount="7200000")
    grouped = m.group_language_observations([zh, conflict])
    assert len(grouped) == 1
    assert "field_conflict:price" in grouped[0]["reasons"]
    assert {x["fields"]["price"]["value"] for x in grouped[0]["observations"]} == {"7100000", "7200000"}


def test_language_evidence_is_not_a_normalized_value_conflict():
    zh, en = observation(), observation(language="en")
    for item, raw in [(zh, "HK$ 710 \u842c"), (en, "HK$ 7.1M")]:
        item["fields"] = {"offers": field([{
            "deal_type": "sale", "amount": "7100000", "currency": "HKD",
            "unit": "HKD", "period": None, "raw": raw, "evidence": [{"raw": raw}],
        }])}
    grouped = module().group_language_observations([en, zh])
    assert len(grouped) == 1 and grouped[0]["reasons"] == []
