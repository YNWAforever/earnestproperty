"""Native agent.php collection through the real CLI; all identities are synthetic."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest
from test_propertyhk_agent_index import fixture, URL

SCRIPT = Path(__file__).parents[1] / "crawl_propertyhk.py"
ORIGIN = "https://www.property.hk"
PAGE2 = ORIGIN + "/agent.php?p=2&dt=NTM&agent=EPS&sid=SYNTHETIC"


def page2():
    html = fixture(2, 2)
    for ident in ("101", "102", "103"):
        html = html.replace(ident, "2" + ident)
    return html


def invoke(tmp_path, overrides=None, entries=None, extra=()):
    responses = {ORIGIN + "/robots.txt": {"html": "User-agent: *\nAllow: /"},
                 URL: {"html": fixture()}, PAGE2: {"html": page2()}}
    responses.update(overrides or {})
    (tmp_path / "responses.json").write_text(json.dumps(responses), encoding="utf-8")
    (tmp_path / "entries.json").write_text(json.dumps(entries or {"EPS-NTM": URL}), encoding="utf-8")
    output = tmp_path / "output"
    # Existing accepted baseline and outbound receipt must not change.
    output.mkdir(exist_ok=True)
    (output / "baseline.json").write_text('{"accepted":"keep"}', encoding="utf-8")
    (output / "receipt.json").write_text('{"receipt_id":"keep"}', encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCRIPT), "--index-only", "--entries",
                             str(tmp_path / "entries.json"), "--fixtures",
                             str(tmp_path / "responses.json"), "--root", str(output),
                             "--dry-run", *extra], capture_output=True, text=True, encoding="utf-8")
    return result, output


def report(result):
    assert result.stdout, result.stderr
    return json.loads(result.stdout)


def no_authority(result, output):
    for name in ("full_snapshot", "details_verified", "id_scope_verified",
                 "full_branch_scope_verified", "eligible_for_absence", "publish_allowed",
                 "baseline_advanced"):
        assert result[name] is False
    assert result["production_writes"] == 0
    assert result["sync_status"] == "blocked_detail_verification"
    assert not list(output.rglob("request.json"))
    assert json.loads((output / "baseline.json").read_text()) == {"accepted": "keep"}
    assert json.loads((output / "receipt.json").read_text()) == {"receipt_id": "keep"}


def test_native_cli_collects_published_terminal_and_preserves_observation_identity(tmp_path):
    result, output = invoke(tmp_path)
    assert result.returncode == 0, result.stderr
    data = report(result)
    assert data["status"] == "index_complete" and data["success"] is True
    assert data["entries"]["EPS-NTM"] == {
        "index_pages": 2, "listed_pages": 2, "advertisements": 6, "offers": 8,
        "unclassified_advertisements": 0, "complete_index_pages": True, "error": None}
    no_authority(data, output)
    run = Path(data["collection"])
    rows = list(csv.DictReader((run / "observations.csv").open(encoding="utf-8-sig", newline="")))
    assert len(rows) == 8
    assert {(r["branch_code"], r["district_filter"], r["observation_kind"]) for r in rows} == {("EPS", "NTM", "index_only")}
    assert rows[0]["price"] == "9200000"
    assert rows[0]["source_updated_date"] == "2026-10-01"
    assert rows[0]["observed_page"] == "1" and rows[-1]["observed_page"] == "2"
    assert len((run / "observations.jsonl").read_text(encoding="utf-8").splitlines()) == 8
    manifest = json.loads((run / "capture-manifest.json").read_text())
    assert [r["url"] for r in manifest] == [ORIGIN + "/robots.txt", URL, PAGE2]
    assert all(hashlib.sha256((run / r["file"]).read_bytes()).hexdigest() == r["sha256"] for r in manifest)
    assert "SYNTHETIC" not in result.stdout and "Synthetic home" not in result.stdout


def test_ad_with_no_quoted_offer_is_preserved_without_aborting_later_pages(tmp_path):
    result, output = invoke(tmp_path, {URL: {"html": fixture().replace("920 <i>萬</i>", "--")}})
    assert result.returncode == 0
    data = report(result)
    scope = data["entries"]["EPS-NTM"]
    assert scope["advertisements"] == 6 and scope["offers"] == 7
    assert scope["unclassified_advertisements"] == 1
    unknown = [json.loads(r) for r in (Path(data["collection"]) / "unclassified-advertisements.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(unknown) == 1 and unknown[0]["property_id"] == "101"
    assert unknown[0]["reason"] == "no_quoted_offer"
    assert unknown[0]["price"] is None and unknown[0]["rent"] is None
    assert "deal_type" not in unknown[0] and "source_status" not in unknown[0]
    no_authority(data, output)


def test_unknown_offer_ad_still_participates_in_duplicate_page_gate(tmp_path):
    first = fixture().replace("920 <i>萬</i>", "--")
    second = page2().replace("2101", "101").replace("920 <i>萬</i>", "--")
    result, output = invoke(tmp_path, {URL: {"html": first}, PAGE2: {"html": second}})
    assert result.returncode == 1
    data = report(result)
    assert data["entries"]["EPS-NTM"]["error"] == "repeated_index_advertisement"
    no_authority(data, output)


@pytest.mark.parametrize("override,error", [
    ({"status": 403, "html": "denied"}, "blocked"),
    ({"html": page2().replace('value="NTM"', 'value="NTW"')}, "pagination_identity"),
    ({"html": fixture(2, 2)}, "repeated_index_advertisement"),
    ({"html": page2().replace("共 2 頁", "共 3 頁")}, "pagination_count_changed"),
    ({"html": page2().replace('</form>', '<input name="prop" value="changed" type="hidden"></form>')}, "pagination_identity"),
])
def test_partial_page_retains_valid_observations_without_sync_or_absence(tmp_path, override, error):
    result, output = invoke(tmp_path, {PAGE2: override})
    assert result.returncode == 1
    data = report(result)
    assert data["status"] == "index_partial"
    assert data["entries"]["EPS-NTM"]["error"] == error
    assert data["entries"]["EPS-NTM"]["complete_index_pages"] is False
    no_authority(data, output)
    run = Path(data["collection"])
    assert len((run / "observations.jsonl").read_text(encoding="utf-8").splitlines()) == 4
    manifest = json.loads((run / "response-manifest.json").read_text())
    assert len([r for r in manifest if r["url"] == PAGE2]) == 1


def test_page_ceiling_is_partial_not_terminal(tmp_path):
    result, output = invoke(tmp_path, extra=("--max-pages", "1"))
    assert result.returncode == 1
    data = report(result)
    assert data["entries"]["EPS-NTM"]["error"] == "page_limit"
    no_authority(data, output)
    manifest = json.loads((Path(data["collection"]) / "capture-manifest.json").read_text())
    assert len(manifest) == 2


def test_blocked_source_stops_before_other_entry_and_never_relabels_district(tmp_path):
    ept = URL.replace("EPS", "EPT")
    result, output = invoke(tmp_path, {URL: {"status": 403, "html": "denied"}},
                            {"EPS-NTM": URL, "EPT-NTM": ept})
    assert result.returncode == 1
    data = report(result)
    assert data["status"] == "index_failed"
    assert data["entries"]["EPT-NTM"]["error"] == "source_stopped"
    manifest = json.loads((Path(data["collection"]) / "capture-manifest.json").read_text())
    assert ept not in [r["url"] for r in manifest]
    no_authority(data, output)


def test_redirect_is_not_followed_and_remains_private_failure_evidence(tmp_path):
    result, output = invoke(tmp_path, {URL: {"status": 302, "html": "",
                            "headers": {"Location": URL + "&prop=changed"}}})
    assert result.returncode == 1
    data = report(result)
    assert data["entries"]["EPS-NTM"]["error"] == "index_redirect"
    assert data["source_calls"] == 2  # robots plus the single rejected redirect
    no_authority(data, output)


def test_independent_districts_preserve_same_ad_and_offer_without_global_dedup(tmp_path):
    url = URL.replace("NTM", "NTW")
    html = fixture(1, 1).replace('value="NTM"', 'value="NTW"')
    result, output = invoke(tmp_path, {URL: {"html": fixture(1, 1)}, url: {"html": html}},
                            {"EPS-NTM": URL, "EPS-NTW": url})
    assert result.returncode == 0
    data = report(result)
    rows = [json.loads(r) for r in (Path(data["collection"]) / "observations.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 8
    assert {(r["property_id"], r["district_filter"]) for r in rows if r["property_id"] == "101"} == {("101", "NTM"), ("101", "NTW")}
    no_authority(data, output)


@pytest.mark.parametrize("entries", [
    {"EPS-NTW": URL}, {"EPS-NTM": URL + "&p=9"},
    {"EPS-NTM": URL + "&agent=EPT"},
    {"EPS-NTM": URL.replace("www.property.hk", "other.invalid")},
    {"EPS-NTM": URL.replace("SYNTHETIC", "")},
    {"EPS-NTM": URL + "&unknown=1"},
])
def test_unapproved_or_nonfirst_scope_rejects_before_artifact_or_network(tmp_path, entries):
    result, output = invoke(tmp_path, entries=entries)
    assert result.returncode == 1
    data = report(result)
    assert data["status"] == "worker_failed"
    assert "SYNTHETIC" not in result.stdout
    assert not list(output.rglob("*.raw"))
