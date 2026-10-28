import copy
import json
import sys
import shutil
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from propertyhk_index_http import MANIFEST, PacedHttp, collect, parse_index
import select_price_status_capture as selector
from select_price_status_capture import complete, newest_complete
from daily_artifacts import accepted_name, freeze_manifest, make_baseline

FIXTURES = Path(__file__).parent / "fixtures"
URL = "https://www.property.hk/agentblog/eps/ruby/"


def capture():
    return json.loads((FIXTURES / "t5-phase0.json").read_text())["capture"]


def html():
    return (FIXTURES / "propertyhk-agentblog.html").read_text()


def test_newest_complete_uses_capture_clock_not_upload_or_iteration_order():
    old, new, partial = capture(), capture(), capture()
    old["scraped_at"] = "2026-10-27T12:00:00Z"
    partial["scraped_at"] = "2026-10-29T12:00:00Z"
    partial["meta"]["crawl_complete"] = False
    assert newest_complete([("reuploaded-old", old), ("new", new), ("partial", partial)])[0] == "new"
    assert newest_complete([("new", new), ("old", old)])[0] == "new"
    with pytest.raises(ValueError):
        newest_complete([("partial", partial)])


def test_full_flag_alone_cannot_replace_sale_rent_pagination_proof():
    data = capture()
    assert complete(data)
    data["meta"]["pages"].pop()
    assert not complete(data)
    data = capture()
    data["meta"]["pages"][0]["ids"] = ["wrong"]
    assert not complete(data)


def test_conflicting_capture_clocks_fail_closed_and_partial_owner_arrays_reject():
    data, conflict = capture(), capture()
    conflict["listings"][0]["price"] = "1"
    with pytest.raises(ValueError, match="conflicting_capture_timestamp"):
        newest_complete([("one", data), ("two", conflict)])
    assert not complete({"listings": []})


def test_manifest_has_19_explicit_agents_and_no_absence_authority():
    manifest = json.loads(MANIFEST.read_text())
    assert len(set(manifest["agents"])) == 19
    assert manifest["absence_enabled"] is False
    assert manifest["full_branch_scope_verified"] is False


def test_index_structure_amounts_and_follow_actual_pagination_fields():
    rows, pages, next_url = parse_index(html(), URL, "eps/ruby")
    assert rows[0]["price"] == "5000000"
    assert rows[0]["rent"] == "20000"
    assert pages == 2
    assert next_url == "https://www.property.hk/agentblog.php?dt=ALL&agent=EPS&blog=RUBY&sid=&page=1&p=2"
    assert set(rows[0]) == {"property_id", "detail_url", "price", "rent"}


@pytest.mark.parametrize("mutate", [
    lambda s: s.replace("C-018613-A000", "C-000000"),
    lambda s: s + "<title>正在驗證您的瀏覽器</title>",
    lambda s: s.replace('value="100"', 'value="101"'),
    lambda s: s.replace('value="RUBY"', 'value="OTHER"'),
    lambda s: s.replace('placeholder="1"', 'placeholder="2"'),
    lambda s: s.replace("共 2 頁", "共 999 頁"),
    lambda s: s.replace('action="/agentblog.php"', 'action="https://elsewhere.test/agentblog.php"'),
    lambda s: s.replace("$500萬", "unknown"),
])
def test_index_failure_modes(mutate):
    with pytest.raises(ValueError):
        parse_index(mutate(html()), URL, "eps/ruby")


def test_pacing_is_at_least_3_seconds_after_previous_response_and_non200_stops():
    now, calls, sleeps = [0], [], []

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    def request(url):
        calls.append(now[0])
        return 200, html()

    http = PacedHttp(clock=lambda: now[0], sleep=sleep, transport=request)
    http.get(URL)
    http.get(URL)
    assert calls == [0, 3]
    assert sleeps == [3]
    for code in [302, 403, 429, 500]:
        with pytest.raises(ValueError):
            PacedHttp(transport=lambda _: (code, html())).get(URL)


def test_collector_fails_whole_run_on_missing_agent_not_empty_inventory():
    manifest = json.loads(MANIFEST.read_text())
    class Http:
        def get(self, url):
            if url.endswith("robots.txt"):
                return "User-agent: *\nAllow: /"
            raise ValueError("index_access_rejected")
    with pytest.raises(ValueError):
        collect(manifest, Http())
    invalid = copy.deepcopy(manifest)
    invalid["agents"].pop()
    with pytest.raises(ValueError, match="invalid_agent_manifest"):
        collect(invalid, Http())


def test_select_existing_verifies_handoff_and_accepted_artifacts_without_source_http(tmp_path, monkeypatch):
    store = tmp_path / "store"
    store.mkdir()
    data = capture()
    request = store / "request-1-1.json"
    request.write_text(json.dumps(data))
    raw = store / "raw-1-1.tar.gz"
    raw.write_bytes(b"synthetic raw evidence")
    manifest = store / "handoff-1-1.json"
    freeze_manifest(request, raw, manifest, git_sha="a" * 40, gate={"allowed": True, "full": True, "reasons": []})
    receipt = store / "receipt.json"
    receipt.write_text(json.dumps({"success": True, "status": "success", "full_snapshot": True, "receipt_id": "synthetic"}))
    baseline = store / "baseline"
    make_baseline(request, receipt, baseline)
    accepted = store / accepted_name(request, "1", "1")
    with tarfile.open(accepted, "w:gz") as archive:
        archive.add(baseline, arcname="baseline")
    names = [manifest.name, accepted.name, "owner-capture-not-a-full-snapshot.tar.gz"]

    def gh(*args):
        if args[0] == "api":
            return b'{"private":true}'
        if args[:2] == ("release", "view"):
            return json.dumps({"assets": [{"name": name} for name in names]}).encode()
        assert args[:2] == ("release", "download")
        name, directory = args[args.index("--pattern") + 1], args[args.index("--dir") + 1]
        shutil.copyfile(store / name, Path(directory) / name)
        return b""

    monkeypatch.setattr(selector, "gh", gh)
    out = tmp_path / "selected.json"
    selector.select_existing("synthetic/private", out)
    assert json.loads(out.read_bytes()) == data
    # Tampering with immutable handoff request bytes aborts instead of using accepted history.
    request.write_text(request.read_text() + " ")
    with pytest.raises(ValueError, match="evidence_hash_mismatch"):
        selector.select_existing("synthetic/private", out)


def test_accepted_bundle_hash_tampering_is_rejected(tmp_path, monkeypatch):
    data = capture()
    request = tmp_path / "request.json"
    request.write_text(json.dumps(data))
    receipt = tmp_path / "receipt.json"
    receipt.write_text(json.dumps({"success": True, "status": "success", "full_snapshot": True, "receipt_id": "synthetic"}))
    baseline = tmp_path / "baseline"
    make_baseline(request, receipt, baseline)
    (baseline / "manifest.json").write_text(json.dumps({"sha256": "0" * 64}))
    asset = tmp_path / accepted_name(request, "1", "1")
    with tarfile.open(asset, "w:gz") as archive:
        archive.add(baseline, arcname="baseline")

    def gh(*args):
        if args[0] == "api":
            return b'{"private":true}'
        if args[:2] == ("release", "view"):
            return json.dumps({"assets": [{"name": asset.name}]}).encode()
        shutil.copyfile(asset, Path(args[args.index("--dir") + 1]) / asset.name)
        return b""

    monkeypatch.setattr(selector, "gh", gh)
    with pytest.raises(ValueError, match="Baseline bytes"):
        selector.select_existing("synthetic/private", tmp_path / "selected.json")
