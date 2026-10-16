"""Offline comparison/evidence and CLI behavior using labelled synthetic inputs."""
import copy
import hashlib
import importlib
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
NOW = "2026-10-16T00:00:00Z"


def module():
    assert (Path(__file__).parents[1] / "scraping/propertyhk_review.py").exists(), "Review reporter missing"
    return importlib.import_module("scraping.propertyhk_review")


def observation(ad="00101", price="HK$710\u842c", *, branch="SYNTHETIC-A", extra=""):
    from scraping.propertyhk_candidates import normalize_detail_url
    from scraping.propertyhk_text import parse_provider_text
    text = (f"# Listing details\nAdvertisement ID: {ad}\nBranch: {branch}\n"
            f"Estate: Synthetic Gardens\nSale price: {price}\nRent: HK$22,000 / month\n" + extra)
    return parse_provider_text(text, detail=normalize_detail_url(f"https://www.property.hk/asking_detail/{ad}.html"),
                               scope={"query_id": "q1", "branch_id": branch, "branch_labels": [branch]},
                               provider={"provider": "exa", "retrieved_at": NOW})


def reference(*observations):
    return {
        "kind": "propertyhk-exa-known/v1", "synthetic": True,
        "provenance": {"source": "propertyhk", "kind": "synthetic", "reference": "synthetic-reference"},
        "entries": [{
            "review_key": x["identity"]["review_key"],
            "source_property_number": x["identity"]["source_property_number"],
            "agency_reference": x["identity"]["agency_reference"],
            "fields": copy.deepcopy(x["fields"]), "observed_at": NOW,
            "evidence": {"reference": "synthetic-reference", "content_sha256": x["content_sha256"]},
        } for x in observations],
    }


def report(observations=None, known=None):
    return module().build_review_report(
        observations if observations is not None else [observation()], known=known, metrics={},
        stop_reason=None, mode="fixture", retrieved_at=NOW, synthetic=True,
    )


def six_groups():
    values = [observation(), observation("00102"), observation("00103"), observation("00104"), observation("00105"), observation("00106")]
    values[3]["parse_state"], values[3]["identity"]["state"] = "unparsed", "missing"
    values[3]["identity"]["review_key"] = None
    values[4]["identity"].update(state="conflict", review_key=None, reasons=["main_advertisement_id_mismatch"])
    values[5].update(parse_state="fetch_failed", text=None, content_sha256=None, fields={})
    return values, reference(observation(price="HK$700\u842c"), observation("00103"))


def test_report_cannot_confer_apply_or_absence_authority():
    values, known = six_groups()
    actual = report(values, known)
    assert actual["kind"] == "propertyhk-exa-review/v1" and actual["synthetic"] is True
    for name in ("full_snapshot", "ingestion_allowed", "eligible_for_absence", "publish_allowed", "baseline_advanced"):
        assert actual[name] is False
    assert actual["production_writes"] == 0
    assert {key: len(value) for key, value in actual["groups"].items()} == {
        "field_differences": 1, "new_candidates": 1, "known_candidates": 1,
        "insufficient_data": 1, "identity_conflicts": 1, "fetch_failures": 1,
    }


def test_diffs_show_old_candidate_and_evidence_without_null_deletions():
    old = observation(price="HK$700\u842c", extra="Floor: 10\nUsable area: 700 sq ft\n")
    result = report(known=reference(old))["groups"]["field_differences"][0]
    assert len(result["differences"]) == 1
    diff = result["differences"][0]
    assert diff["field"] == "offers.sale.amount" and diff["reference"] == "7000000" and diff["candidate"] == "7100000"
    assert diff["reference_evidence"] and diff["candidate_evidence"]
    assert "floor" in result["missing_fields"] and "saleable_area" in result["missing_fields"]


def test_incomparable_units_are_insufficient_and_reference_absence_is_not_withdrawal():
    current = observation(extra="Usable area: 70 sq m\n")
    old = observation(extra="Usable area: 700 sq ft\n")
    actual = report([current], reference(old, observation("00999")))
    assert len(actual["groups"]["insufficient_data"]) == 1
    assert actual["reference"]["sample_size"] == 2 and actual["reference"]["matched_review_identities"] == 1
    assert sum(len(x) for x in actual["groups"].values()) == 1


def test_no_reference_does_not_claim_production_absence():
    actual = report()
    assert actual["comparison_performed"] is False
    assert actual["reference"] is None and actual["limitations"]
    assert len(actual["groups"]["new_candidates"]) == 1


def test_equivalent_raw_units_can_group_but_conflicts_cannot():
    a, b = observation(), observation(price="HK$7.1M")
    b["language"] = "zh-Hant"
    actual = report([b, a])
    assert len(actual["groups"]["new_candidates"]) == 1
    assert len(actual["groups"]["new_candidates"][0]["observations"]) == 2
    different = observation(price="HK$720\u842c")
    different["language"] = "zh-Hant"
    assert len(report([a, different])["groups"]["insufficient_data"]) == 1


def test_known_property_identity_conflict_is_not_a_field_update():
    old = reference(observation())
    old["entries"][0]["source_property_number"] = "OTHER-P"
    current = observation(extra="Property number: SYN-P-01\n")
    assert len(report([current], old)["groups"]["identity_conflicts"]) == 1


@pytest.mark.parametrize("change", ["kind", "duplicate", "unscoped", "staff_field", "bad_amount"])
def test_reference_is_explicit_scoped_and_not_a_snapshot(tmp_path, change):
    value = reference(observation())
    if change == "kind":
        value["kind"] = "full_snapshot"
    elif change == "duplicate":
        value["entries"] *= 2
    elif change == "unscoped":
        value["entries"][0]["review_key"] = ["propertyhk", "", "00101"]
    elif change == "staff_field":
        value["entries"][0]["fields"]["staff_id"] = {"value": "fake"}
    else:
        value["entries"][0]["fields"]["offers"]["value"][0]["amount"] = True
    path = tmp_path / "known.json"
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError):
        module().load_reference(path)


@pytest.mark.parametrize("artifact", ["../outside.txt", "/outside.txt", "C:/outside.txt", "sub\\outside.txt"])
def test_reference_rejects_artifact_traversal(tmp_path, artifact):
    value = reference(observation())
    value["entries"][0]["evidence"]["artifact"] = artifact
    path = tmp_path / "known.json"
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError):
        module().load_reference(path)


def test_reference_rejects_duplicate_json_keys_and_symlink_escape(tmp_path):
    path = tmp_path / "known.json"
    path.write_text('{"kind":"one","kind":"two"}')
    with pytest.raises(ValueError):
        module().load_reference(path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "text.txt").write_text("synthetic")
    inside = tmp_path / "reference"
    inside.mkdir()
    link = inside / "link"
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(outside), str(link))
    else:
        link.symlink_to(outside, target_is_directory=True)
    value = reference(observation())
    value["entries"][0]["evidence"]["artifact"] = "link/text.txt"
    path = inside / "known.json"
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError):
        module().load_reference(path)


def test_artifact_hashes_markdown_safety_and_collision(tmp_path):
    value = observation(extra="Address: <script>alert(1)</script> [bad](javascript:bad)\n")
    actual = report([value], reference(observation(extra="Address: Old\n")))
    output = tmp_path / "new"
    paths = module().write_review_artifacts(actual, output)
    assert paths["json"] == output / "report.json"
    manifest = json.loads((output / "evidence/manifest.json").read_text())
    assert manifest["synthetic"] is True
    for item in manifest["files"]:
        raw = (output / item["path"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item["sha256"] and len(raw) == item["bytes"]
    markdown = (output / "report.md").read_text(encoding="utf-8")
    assert "<script>" not in markdown and "[bad](javascript:bad)" not in markdown
    assert "Reference" in markdown and "Candidate" in markdown and "Evidence" in markdown
    before = (output / "report.json").read_bytes()
    with pytest.raises(ValueError):
        module().write_review_artifacts(actual, output)
    assert (output / "report.json").read_bytes() == before
    actual["full_snapshot"] = True
    with pytest.raises(ValueError):
        module().write_review_artifacts(actual, tmp_path / "bad-authority")
    actual["full_snapshot"] = False
    actual["groups"]["field_differences"][0]["observations"][0]["content_sha256"] = "../bad"
    with pytest.raises(ValueError):
        module().write_review_artifacts(actual, tmp_path / "bad-hash")


def test_rerun_is_identical_with_same_clock_and_order_independent_inputs(tmp_path):
    values, known = six_groups()
    first, second = report(values, known), report(list(reversed(values)), known)
    assert first == second
    module().write_review_artifacts(first, tmp_path / "a")
    module().write_review_artifacts(second, tmp_path / "b")
    assert (tmp_path / "a/report.json").read_bytes() == (tmp_path / "b/report.json").read_bytes()
    raw = json.dumps(first)
    assert '"staff_id"' not in raw and '"canonical_id"' not in raw and '"receipt_id"' not in raw
