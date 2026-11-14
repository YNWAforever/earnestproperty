"""Offline semantic proof regressions; every source body stays in memory."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import source_authority_verify as verifier
from scraping.incremental_28hse import card_fingerprint, index_url
from scraping.worker import parse_28_detail, parse_28_index

FIXTURES = Path(__file__).parent / "tests" / "fixtures"
STAMP = "2026-11-14T02:34:35.753890Z"


def provider(url, html):
    body = json.dumps({"success": True, "data": {"rawHtml": html,
        "metadata": {"url": url, "sourceURL": url, "statusCode": 200}}}).encode()
    return {"request": {"url": url}, "provider_status": 200,
            "body_base64": base64.b64encode(body).decode(), "body_sha256": verifier.sha256(body)}


def fixture():
    index = (FIXTURES / "28hse-incremental-index.sanitized.html").read_text(encoding="utf-8").replace("1001", "4054123")
    row = parse_28_index(index, "sale")[0][0]
    detail = (FIXTURES / "28hse-modern-sale-structure.html").read_text(encoding="utf-8")
    detail = detail.replace("</head>", '<script type="application/ld+json">{"mainEntity":{"numberOfRooms":1}}</script></head>')
    detail = detail.replace("</body>", '<p>物業編號: A123456 (代理提供)</p><div class="slider-block"><div class="ps-noscript-grid"><img src="https://i1.28hse.com/offline-one.jpg"><img src="https://i2.28hse.com/offline-two.jpg"></div></div></body>')
    accepted = parse_28_detail(detail, row, require_live_identity=True)
    digest, fingerprint = verifier.sha256(detail), card_fingerprint(row)
    accepted.update(captured_at=STAMP, detail_fetched_at=STAMP)
    accepted["raw_payload"]["incremental"] = {"mode": "index-delta-v1", "detail_fetched_at": STAMP,
        "detail_body_sha256": digest, "index_fingerprint": fingerprint}
    request = {"source": "28hse", "scraped_at": "2026-11-14T02:35:00Z", "listings": [accepted],
        "meta": {"schema_version": "2.0", "scope_id": "agent:540", "parser_version": "python-v2.2",
            "policy_version": "no-hermes-v2", "incremental": {"mode": "index-delta-v1", "index_started_at": "2026-11-14T02:31:00Z"}}}
    evidence = {"errors": [], "selected_candidates": [{"property_id": "4054123", "deal_type": "sale",
        "source_url": row["source_url"], "status": "fetched", "detail_fetched_at": STAMP,
        "detail_body_sha256": digest, "index_fingerprint": fingerprint}],
        "requests": [{"url": index_url("sale", 1), "status": 200, "html": index},
                     {"url": row["source_url"], "status": 200, "html": detail}],
        "provider_requests": [provider(index_url("sale", 1), index), provider(row["source_url"], detail)]}
    return request, evidence


def test_reparse_accepts_genuine_observed_projection_without_mutating_inputs():
    request, evidence = fixture()
    before = deepcopy((request, evidence))
    assert verifier.verify_authority_facts(request, evidence) == 1
    assert (request, evidence) == before
    assert request["listings"][0]["raw_payload"]["source_conflicts"][0]["status"] == "review"


@pytest.mark.parametrize("field,value", [
    ("agency_property_no", "B123456"), ("title", "Forged title"), ("price", "1"),
    ("rent", "123"), ("gross_area", "1"), ("saleable_area", "1"),
    ("gross_unit_price", "1"), ("saleable_unit_price", "1"), ("bedrooms", 1),
    ("bathrooms", 0), ("floor", "低層"), ("orientation", "北"), ("estate", "Other estate"),
    ("district", "Other district"), ("phase", "1"), ("block", "9"), ("unit", "A"),
    ("description", "Invented fallback description"), ("promotion_tier_raw", "黃金"), ("source_status", "delisted"),
    ("source_status_reason", "sold"),
])
def test_every_observed_fact_rejects_tampering_even_with_original_valid_html(field, value):
    request, evidence = fixture()
    request["listings"][0][field] = value
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_FACTS_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)


@pytest.mark.parametrize("mutation", ["description", "image", "image_order", "image_missing", "gallery_missing", "extra_field"])
def test_publication_description_and_exact_gallery_are_reparsed(mutation):
    request, evidence = fixture()
    publication = request["listings"][0]["publication"]
    if mutation == "description":
        publication["description"] = "Forged description"
    elif mutation == "image":
        publication["images"][0] = "https://i1.28hse.com/forged.jpg"
    elif mutation == "image_order":
        publication["images"].reverse()
    elif mutation == "image_missing":
        publication["images"].pop()
    elif mutation == "gallery_missing":
        publication.pop("images")
    else:
        publication["source_url"] = request["listings"][0]["source_url"]
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_PUBLICATION_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)


def test_title_comes_from_verified_index_html_and_cannot_be_seeded_from_accepted_title():
    request, evidence = fixture()
    request["listings"][0]["title"] = "Copied forged title"
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_FACTS_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)
    evidence["requests"][0]["html"] = evidence["requests"][0]["html"].replace("測試屋苑 高層", "Copied forged title")
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_PROVIDER_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)


@pytest.mark.parametrize("mutation", ["remove", "status", "dom", "json_ld", "field"])
def test_parser_generated_dom_conflicts_cannot_be_removed_or_rewritten(mutation):
    request, evidence = fixture()
    conflicts = request["listings"][0]["raw_payload"]["source_conflicts"]
    if mutation == "remove":
        conflicts.clear()
    else:
        conflicts[0][mutation] = {"status": "approved", "dom": 1, "json_ld": 4, "field": "bathrooms"}[mutation]
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_CONFLICTS_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)


@pytest.mark.parametrize("mutation", ["candidate_time", "row_time", "incremental_time", "top_time", "missing_index", "candidate_id", "candidate_deal", "source_url", "body_sha", "fingerprint", "duplicate"])
def test_candidate_identity_capture_and_body_binding_is_fail_closed(mutation):
    request, evidence = fixture()
    accepted = request["listings"][0]
    if mutation == "candidate_time":
        evidence["selected_candidates"][0]["detail_fetched_at"] = "2026-11-14T02:34:00Z"
    elif mutation == "row_time":
        accepted["captured_at"] = "2026-11-14T02:34:00Z"
    elif mutation == "incremental_time":
        accepted["raw_payload"]["incremental"]["detail_fetched_at"] = "2026-11-14T02:34:00Z"
    elif mutation == "top_time":
        accepted["detail_fetched_at"] = "2026-11-14T02:34:00Z"
    elif mutation == "missing_index":
        evidence["requests"].pop(0)
    elif mutation == "candidate_id":
        evidence["selected_candidates"][0]["property_id"] = "999"
    elif mutation == "candidate_deal":
        evidence["selected_candidates"][0]["deal_type"] = "rent"
    elif mutation == "source_url":
        accepted["source_url"] += "?other"
    elif mutation == "body_sha":
        accepted["raw_payload"]["incremental"]["detail_body_sha256"] = "a" * 64
    elif mutation == "fingerprint":
        accepted["raw_payload"]["incremental"]["index_fingerprint"] = "a" * 64
    elif mutation == "duplicate":
        evidence["selected_candidates"].append(deepcopy(evidence["selected_candidates"][0]))
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_[A-Z_]+$"):
        verifier.verify_authority_facts(request, evidence)


@pytest.mark.parametrize("mutation", ["json_sha", "base64", "metadata_url", "metadata_source", "html", "duplicate", "missing", "malformed_request"])
def test_actual_provider_response_must_bind_both_index_title_and_detail_facts(mutation):
    request, evidence = fixture()
    item = evidence["provider_requests"][1]
    if mutation == "json_sha":
        item["body_sha256"] = "a" * 64
    elif mutation == "base64":
        item["body_base64"] += " "
    elif mutation in ("metadata_url", "metadata_source", "html"):
        value = json.loads(base64.b64decode(item["body_base64"]))
        if mutation == "metadata_url":
            value["data"]["metadata"]["url"] += "?other"
        elif mutation == "metadata_source":
            value["data"]["metadata"]["sourceURL"] += "?other"
        else:
            value["data"]["rawHtml"] += "changed"
        body = json.dumps(value).encode()
        item["body_base64"], item["body_sha256"] = base64.b64encode(body).decode(), verifier.sha256(body)
    elif mutation == "duplicate":
        evidence["provider_requests"].append(deepcopy(item))
    elif mutation == "missing":
        evidence["provider_requests"].pop()
    else:
        item["request"] = None
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_PROVIDER_[A-Z_]+$"):
        verifier.verify_authority_facts(request, evidence)


def test_decimal_equivalence_uses_normalized_values_and_keeps_room_types_strict():
    request, evidence = fixture()
    request["listings"][0]["price"] = "020800000.00"
    assert verifier.verify_authority_facts(request, evidence) == 1
    request["listings"][0]["bedrooms"] = True
    with pytest.raises(verifier.AuthorityVerificationError, match="^AUTHORITY_FACTS_MISMATCH$"):
        verifier.verify_authority_facts(request, evidence)


def test_non_authoritative_operational_bookkeeping_does_not_change_semantic_projection():
    request, evidence = fixture()
    request["listings"][0]["raw_payload"]["incremental"]["index_seen_at"] = "2026-11-14T02:32:00Z"
    request["listings"][0]["occurrences"] = []
    request["listings"][0]["raw_payload"]["agent_contacts"] = []
    assert verifier.verify_authority_facts(request, evidence) == 1


def test_proof_hashes_exact_input_bytes_and_contains_no_private_facts(tmp_path):
    request, evidence = fixture()
    request_bytes = (json.dumps(request, ensure_ascii=False, indent=2) + "\n").encode()
    evidence_bytes = (json.dumps(evidence, ensure_ascii=False) + "\n").encode()
    request_path, evidence_path = tmp_path / "request.json", tmp_path / "evidence.json"
    request_path.write_bytes(request_bytes)
    evidence_path.write_bytes(evidence_bytes)
    proof = verifier.verify_files(request_path, evidence_path)
    assert proof == {"version": verifier.PROOF_VERSION, "status": "verified",
        "request_sha256": verifier.sha256(request_bytes), "evidence_sha256": verifier.sha256(evidence_bytes),
        "parser_version": "python-v2.2", "record_count": 1}
    assert "A123456" not in json.dumps(proof)
    assert "4054123" not in json.dumps(proof)
    assert request_path.read_bytes() == request_bytes
    assert evidence_path.read_bytes() == evidence_bytes


def test_cli_outputs_digest_proof_and_rejects_tampering_without_stale_success(tmp_path, capsys):
    request, evidence = fixture()
    request_path, evidence_path, output = tmp_path / "request.json", tmp_path / "evidence.json", tmp_path / "proof.json"
    request_path.write_text(json.dumps(request), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    args = ["--request", str(request_path), "--evidence", str(evidence_path), "--output", str(output)]
    assert verifier.main(args) == 0
    assert json.loads(output.read_text(encoding="utf-8"))["status"] == "verified"
    request["listings"][0]["price"] = "1"
    request_path.write_text(json.dumps(request), encoding="utf-8")
    assert verifier.main(args) == 1
    assert json.loads(output.read_text(encoding="utf-8")) == {"version": verifier.PROOF_VERSION, "status": "rejected"}
    assert "9500000" not in capsys.readouterr().out


@pytest.mark.parametrize("name", ["request.json", "evidence.json"])
def test_cli_never_overwrites_pinned_input_on_output_collision(tmp_path, name):
    request, evidence = fixture()
    request_path, evidence_path = tmp_path / "request.json", tmp_path / "evidence.json"
    request_path.write_text(json.dumps(request), encoding="utf-8")
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    before = (request_path.read_bytes(), evidence_path.read_bytes())
    assert verifier.main(["--request", str(request_path), "--evidence", str(evidence_path), "--output", str(tmp_path / name)]) == 1
    assert before == (request_path.read_bytes(), evidence_path.read_bytes())


def test_empty_delta_has_zero_observed_facts_without_inventing_fresh_records():
    request, evidence = fixture()
    request["listings"], evidence["selected_candidates"] = [], []
    assert verifier.verify_authority_facts(request, evidence) == 0
