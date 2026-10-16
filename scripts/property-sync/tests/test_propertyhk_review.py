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


def observation(ad="00101", price="HK$710\u842c", *, branch="SYNTHETIC-A", branch_label=None,
                rent="HK$22,000 / month", extra=""):
    from scraping.propertyhk_candidates import normalize_detail_url
    from scraping.propertyhk_text import parse_provider_text
    label = branch if branch_label is None else branch_label
    text = (f"# Listing details\nAdvertisement ID: {ad}\nBranch: {label}\n"
            f"Estate: Synthetic Gardens\nSale price: {price}\n"
            + (f"Rent: {rent}\n" if rent is not None else "") + extra)
    return parse_provider_text(text, detail=normalize_detail_url(f"https://www.property.hk/asking_detail/{ad}.html"),
                               scope={"query_id": "q1", "branch_id": branch, "branch_labels": [label]},
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
    assert actual["metrics"]["parsed_observations"] == 4
    assert actual["metrics"]["unparsed_observations"] == 1
    assert actual["metrics"]["identity_conflicting_observations"] == 1
    assert actual["metrics"]["comparable_fields"] == 6


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
    assert actual["metrics"]["language_groups"] == 1
    different = observation(price="HK$720\u842c")
    different["language"] = "zh-Hant"
    assert len(report([a, different])["groups"]["insufficient_data"]) == 1


def test_known_property_identity_conflict_is_not_a_field_update():
    old = reference(observation())
    old["entries"][0]["source_property_number"] = "OTHER-P"
    current = observation(extra="Property number: SYN-P-01\n")
    assert len(report([current], old)["groups"]["identity_conflicts"]) == 1


@pytest.mark.parametrize("change", ["kind", "duplicate", "unscoped", "staff_field", "bad_amount", "bad_area", "bad_scalar", "bad_index"])
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
    elif change == "bad_amount":
        value["entries"][0]["fields"]["offers"]["value"][0]["amount"] = True
    elif change == "bad_area":
        value["entries"][0]["fields"]["saleable_area"]["value"] = True
    elif change == "bad_scalar":
        value["entries"][0]["fields"]["estate"]["value"] = {"unexpected": True}
    else:
        value["native_index"] = [True]
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


FIXTURES = Path(__file__).parent / "fixtures/propertyhk-exa"
CONFIG = Path(__file__).parents[1] / "propertyhk-exa.example.json"


def cli():
    assert (Path(__file__).parents[1] / "review_propertyhk_exa.py").exists(), "Review CLI missing"
    return importlib.import_module("review_propertyhk_exa")


def fixture_args(output):
    return ["--config", str(CONFIG), "--fixture-bundle", str(FIXTURES),
            "--known", str(FIXTURES / "known.json"), "--output", str(output)]


def test_fixture_cli_is_complete_without_network_credentials_or_db(monkeypatch, tmp_path, capsys):
    app = cli()
    import socket
    import subprocess
    import urllib.request
    original = type(os.environ).__getitem__
    def guarded(environ, key):
        if key in ("EXA_API_KEY", "DATABASE_URL"):
            pytest.fail("Offline workflow read credentials or DB environment")
        return original(environ, key)
    def forbidden(*args, **kwargs):
        pytest.fail("Offline workflow attempted external I/O")
    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    monkeypatch.setattr(app, "exa_http_request", forbidden)
    output = tmp_path / "report"
    assert app.main(fixture_args(output)) == 0
    actual = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert actual["synthetic"] is True
    assert {key: len(value) for key, value in actual["groups"].items()} == {
        "field_differences": 1, "new_candidates": 1, "known_candidates": 1,
        "insufficient_data": 1, "identity_conflicts": 1, "fetch_failures": 1,
    }
    assert actual["metrics"]["search_requests"] == 4 and actual["metrics"]["contents_requests"] == 2
    assert actual["metrics"]["unique_detail_urls"] == 7
    console = capsys.readouterr()
    assert "Synthetic Gardens" not in console.out and "HK$" not in console.out


def approval_config():
    value = json.loads(CONFIG.read_text())
    value["synthetic"], value["fixture_aliases"] = False, {}
    digest = lambda data: hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    for key in value["approval_refs"]:
        value["approval_refs"][key] = {"reference": "synthetic-test-only", "approved": True, "hostname": "property.hk"}
    value["approval_refs"]["query_plan"]["query_plan_sha256"] = digest(value["query_plan"])
    value["approval_refs"]["online_trial"].update(
        query_plan_sha256=digest(value["query_plan"]), limits_sha256=digest(value["limits"]))
    return value


@pytest.mark.parametrize("missing", ["switch", "query_plan", "source_access", "content_reuse", "online_trial", "key", "changed_query", "changed_limits", "wrong_host"])
def test_online_gate_precedes_transport_creation(tmp_path, monkeypatch, missing):
    app = cli()
    value = approval_config()
    env = {"PROPERTYHK_EXA_ONLINE_ENABLED": "true", "EXA_API_KEY": "synthetic-not-a-real-key"}
    if missing == "switch":
        env.pop("PROPERTYHK_EXA_ONLINE_ENABLED")
    elif missing == "key":
        env.pop("EXA_API_KEY")
    elif missing == "changed_query":
        value["query_plan"][0]["query_terms"].reverse()
    elif missing == "changed_limits":
        value["limits"]["max_cost_usd"] = "0.19"
    elif missing == "wrong_host":
        value["approval_refs"]["source_access"]["hostname"] = "other.invalid"
    else:
        value["approval_refs"][missing] = None
    with pytest.raises(ValueError):
        app.validate_online_approval(value, env)


@pytest.mark.parametrize("change", ["bool_limit", "extra_key", "synthetic_online", "aliases_online", "duplicate_key"])
def test_config_validation_rejects_ambiguous_or_unapproved_inputs(tmp_path, change):
    app = cli()
    value = json.loads(CONFIG.read_text())
    online = change in ("synthetic_online", "aliases_online")
    if change == "bool_limit":
        value["limits"]["max_attempts"] = True
    elif change == "extra_key":
        value["api_key"] = "not-allowed"
    elif change == "aliases_online":
        value["synthetic"] = False
    path = tmp_path / "config.json"
    path.write_text('{"kind":"one","kind":"two"}' if change == "duplicate_key" else json.dumps(value))
    with pytest.raises(ValueError):
        app.load_review_config(path, online=online)


def test_fixture_artifacts_cannot_escape_manifest_root(tmp_path):
    app = cli()
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    root = tmp_path / "bundle"
    root.mkdir()
    manifest["artifacts"]["discovery"] = "../outside.json"
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        app.load_fixture_request(root)


def test_cli_missing_inputs_and_live_default_fail_before_transport(tmp_path, monkeypatch, capsys):
    app = cli()
    def forbidden(*args, **kwargs):
        pytest.fail("Denied configuration reached transport construction")
    monkeypatch.setattr(app, "ExaClient", forbidden)
    assert app.main(["--config", str(CONFIG), "--output", str(tmp_path / "missing")]) == 2
    assert app.main(["--config", str(CONFIG), "--online", "--output", str(tmp_path / "online")]) == 2
    assert "not-a-real-key" not in capsys.readouterr().err


def test_partial_budget_and_interruption_preserve_observations(tmp_path):
    app = cli()
    from scraping.exa import ExaClient
    config = app.load_review_config(CONFIG, online=False)
    request = app.load_fixture_request(FIXTURES)
    count = 0
    def interrupted(endpoint, payload, token, **kwargs):
        nonlocal count
        if endpoint.endswith("/contents"):
            count += 1
            if count == 2:
                raise KeyboardInterrupt
        return request(endpoint, payload, token, **kwargs)
    client = ExaClient(request=interrupted, now=request.now, monotonic=request.monotonic,
                       sleep=request.sleep, limits=config["limits"], fixture_aliases=config["fixture_aliases"])
    try:
        actual = app.run_review(config, client=client, known=module().load_reference(FIXTURES / "known.json"), now=request.now)
    except KeyboardInterrupt:
        pytest.fail("Provider interruption escaped instead of preserving a partial report")
    assert actual["stop_reason"] == "interrupted"
    assert actual["metrics"]["reserved_usd"] == "0.048"
    assert any(x["observations"][0]["text"] is not None for group in actual["groups"].values() for x in group)
    config["limits"]["max_cost_usd"] = "0.008"
    request = app.load_fixture_request(FIXTURES)
    client = ExaClient(request=request, now=request.now, monotonic=request.monotonic, sleep=request.sleep,
                       limits=config["limits"], fixture_aliases=config["fixture_aliases"])
    actual = app.run_review(config, client=client, known=None, now=request.now)
    assert actual["stop_reason"] == "cost_reservation_limit"
    assert actual["metrics"]["total_requests"] == 1 and actual["metrics"]["reserved_usd"] == "0.007"


@pytest.mark.parametrize("noise", ["rent", "area"])
def test_optional_unparsed_field_does_not_hide_threshold_meeting_candidate(noise):
    current = observation(rent="negotiable") if noise == "rent" else observation(extra="Usable area: 700\n")
    actual = report([current])
    assert len(actual["groups"]["new_candidates"]) == 1
    entry = actual["groups"]["new_candidates"][0]
    assert any(reason.endswith("_unparsed") for reason in entry["reasons"])
    assert entry["observations"][0]["identity"]["state"] == "verified"


@pytest.mark.parametrize("side", ["candidate", "reference"])
def test_one_sided_optional_values_are_visible_but_not_claimed_changed(side):
    with_floor, without_floor = observation(extra="Floor: 10\n"), observation()
    current, old = (with_floor, without_floor) if side == "candidate" else (without_floor, with_floor)
    actual = report([current], reference(old))
    entry = actual["groups"]["known_candidates"][0]
    assert entry["differences"] == []
    assert side + "_only:floor" in entry["reasons"]
    one_sided = next(x for x in entry["one_sided_fields"] if x["field"] == "floor")
    assert one_sided["candidate"] == ("10" if side == "candidate" else None)
    assert one_sided["reference"] == ("10" if side == "reference" else None)
    assert actual["metrics"]["comparable_fields"] == 3


def test_new_offer_against_unknown_reference_is_not_a_confirmed_price_change():
    actual = report([observation()], reference(observation(rent=None)))
    entry = actual["groups"]["known_candidates"][0]
    assert "candidate_only:offers.rent" in entry["reasons"]
    assert entry["differences"] == [] and actual["metrics"]["comparable_fields"] == 2


def test_partial_offer_can_compare_complete_sale_without_inventing_rent():
    actual = report([observation(rent="negotiable")], reference(observation(rent=None)))
    assert len(actual["groups"]["known_candidates"]) == 1
    assert actual["metrics"]["comparable_fields"] == 2
    assert "candidate_unparsed:offers.rent" in actual["groups"]["known_candidates"][0]["reasons"]
    existing_rent = report([observation(rent="negotiable")], reference(observation()))
    assert len(existing_rent["groups"]["insufficient_data"]) == 1


@pytest.mark.parametrize("field,value", [
    ("branch", "SYNTHETIC-Z"), ("source_advertisement_id", "999"),
    ("source_property_number", "OTHER-P"), ("agency_reference", "OTHER-A"),
])
def test_reference_identity_fields_cannot_contradict_declared_identity(tmp_path, field, value):
    known = reference(observation(extra="Property number: SYN-P\nAgency reference: SYN-A\n"))
    known["entries"][0]["fields"][field]["value"] = value
    path = tmp_path / "conflict.json"
    path.write_text(json.dumps(known), encoding="utf-8")
    with pytest.raises(ValueError, match="reference_invalid"):
        module().load_reference(path)


def test_reference_branch_label_alias_requires_explicit_mapping(tmp_path):
    label = "\u5408\u6210\u5206\u884c"
    known = reference(observation(branch_label=label))
    path = tmp_path / "known.json"
    path.write_text(json.dumps(known), encoding="utf-8")
    with pytest.raises(ValueError, match="reference_invalid"):
        module().load_reference(path)
    known["entries"][0]["branch_labels"] = [label]
    path.write_text(json.dumps(known), encoding="utf-8")
    loaded = module().load_reference(path)
    assert loaded["entries"][0]["review_key"] == ["propertyhk", "SYNTHETIC-A", "00101"]


def test_observed_branch_aliases_can_group_under_verified_branch_identity():
    original, translated = observation(), observation(branch_label="\u5408\u6210\u5206\u884c")
    translated["language"] = "zh-Hant"
    actual = report([original, translated])
    assert len(actual["groups"]["new_candidates"]) == 1
    assert {item["fields"]["branch"]["value"] for item in actual["groups"]["new_candidates"][0]["observations"]} == {
        "SYNTHETIC-A", "\u5408\u6210\u5206\u884c"
    }
