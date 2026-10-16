"""Designed text contracts, explicitly synthetic; not observed source layouts."""
import hashlib
import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
FIXTURES = Path(__file__).parent / "fixtures/propertyhk-exa"


def module():
    assert (Path(__file__).parents[1] / "scraping/propertyhk_text.py").exists(), "Text parser missing"
    return importlib.import_module("scraping.propertyhk_text")


def parse(text=None, provider=None):
    from scraping.propertyhk_candidates import normalize_detail_url
    return module().parse_provider_text(
        (FIXTURES / "text/dual.txt").read_text(encoding="utf-8") if text is None else text,
        detail=normalize_detail_url("https://www.property.hk/asking_detail/00101.html"),
        scope={"query_id": "q1", "branch_id": "SYNTHETIC-A", "branch_labels": ["SYNTHETIC-A"]},
        provider=provider or {"provider": "exa", "retrieved_at": "2026-10-16T00:00:00Z"},
    )


def test_dual_offers_and_ten_thousand_amount():
    result = parse()
    offers = result["fields"]["offers"]["value"]
    assert [(x["deal_type"], x["amount"]) for x in offers] == [("sale", "7100000"), ("rent", "22000")]
    assert offers[0]["currency"] == "HKD" and offers[0]["raw_unit"] == "\u842c"
    assert offers[1]["period"] == "month"
    assert result["identity"]["state"] == "verified"
    assert result["parser_version"] == "propertyhk-exa-text-v1"


@pytest.mark.parametrize("raw,amount", [
    ("HK$ 7,100,000", "7100000"), ("HKD 7.1M", "7100000"), ("HK$710\u842c", "7100000"),
    ("710\u842c", None), ("$7.1M", None), ("HK$ 12,34", None), ("negotiable", None),
    ("HK$ -100", None), ("HK$ NaN", None), ("HK$ 7.1", "7.1"),
    ("HK$ 999,999,999,999,999,999,999,999,999,999", None),
])
def test_explicit_money_conversion_or_unparsed(raw, amount):
    text = "# Listing details\nAdvertisement ID: 00101\nBranch: SYNTHETIC-A\nSale price: " + raw
    offer = parse(text)["fields"]["offers"]["value"][0]
    assert offer["amount"] == amount and offer["raw"] == raw


def test_missing_rental_period_is_not_assumed_monthly():
    result = parse("# Listing details\nRent: HK$ 22,000")
    offer = result["fields"]["offers"]["value"][0]
    assert offer["amount"] is None and offer["period"] is None


def test_areas_keep_type_unit_and_approximation():
    result = parse()["fields"]
    assert result["saleable_area"]["value"] == {"amount": "70", "unit": "sq_m", "approximate": True}
    assert result["gross_area"]["value"] == {"amount": "900", "unit": "sq_ft", "approximate": False}
    unknown = parse("# Listing details\nUsable area: 70\nArea: 800 sq ft")["fields"]
    assert unknown["saleable_area"]["value"] is None and unknown["gross_area"]["value"] is None


def test_dates_and_floor_are_not_inferred():
    result = parse()["fields"]
    assert result["source_updated"]["value"] == {"iso": "2026-10-15", "precision": "date", "timezone": None}
    assert result["floor"]["value"] == "high" and result["unit"]["value"] is None
    result = parse("# Listing details\nSource updated: 01/02/26\nPublished: 2026-02-30")["fields"]
    assert result["source_updated"]["value"] is None and result["source_published"]["value"] is None


def test_number_kinds_and_contacts_remain_separate():
    result = parse()
    assert result["identity"]["source_advertisement_id"] == "00101"
    assert result["identity"]["source_property_number"] == "SYN-P-01"
    assert result["identity"]["agency_reference"] == "SYN-A-01"
    contact = result["fields"]["contacts"]["value"][0]
    assert contact["name"] == "Synthetic Contact" and contact["phone"] == "+852 00000000"
    assert "staff_id" not in contact and "canonical_id" not in result


@pytest.mark.parametrize("heading", [
    "# Transaction history", "# Related listings", "# Advertisement", "# Footer",
    "# \u6210\u4ea4\u7d00\u9304", "# \u76f8\u95dc\u6a13\u76e4", "# \u5ee3\u544a", "# \u9801\u5c3e",
])
def test_history_related_ads_and_footer_cannot_validate_listing(heading):
    result = parse("# Listing details\nEstate: Synthetic\n" + heading +
                   "\nAdvertisement ID: 00101\nBranch: SYNTHETIC-A\nSale price: HK$710\u842c\nContact: Fake | 123 | agent")
    assert result["identity"]["state"] == "missing"
    assert result["fields"]["offers"]["value"] is None
    assert result["fields"]["contacts"]["value"] is None


@pytest.mark.parametrize("text", ["unknown body", "# Listing details\n# Listing details\nAdvertisement ID: 00101"])
def test_unknown_multiple_main_blocks_are_unparsed(text):
    result = parse(text)
    assert result["parse_state"] == "unparsed" and result["text"] == text
    assert result["identity"]["state"] == "missing"


def test_repeated_equal_evidence_and_conflicting_fields_are_preserved():
    result = parse("# Listing details\nAdvertisement ID: 00101\nAdvertisement ID: 00101\n"
                   "Branch: SYNTHETIC-A\nSale price: HK$710\u842c\nSale price: HK$720\u842c")
    assert len(result["fields"]["source_advertisement_id"]["evidence"]) == 2
    assert result["fields"]["offers"]["state"] == "conflict"
    assert len(result["fields"]["offers"]["alternatives"]) == 2


def test_unicode_crlf_and_repeated_text_evidence_is_exact():
    text = "# \u6a13\u76e4\u8a73\u60c5\r\n\u5ee3\u544a\u7de8\u865f\uff1a00101\r\n\u5206\u884c\uff1aSYNTHETIC-A\r\nEstate: \u5408\u6210\U0001f3e0\r\n\u552e\u50f9\uff1aHK$710\u842c\r\n"
    result = parse(text)
    assert result["identity"]["state"] == "verified"
    assert result["content_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    for item in result["fields"].values():
        for evidence in item["evidence"]:
            assert text[evidence["char_start"]:evidence["char_end"]] == evidence["raw"]
            assert evidence["line_start"] == text[:evidence["char_start"]].count("\n") + 1
    assert result["fields"]["estate"]["value"] == "\u5408\u6210\U0001f3e0"


def test_provider_date_and_receipt_are_not_source_update():
    result = parse("# Listing details\nEstate: Synthetic", provider={
        "provider": "exa", "provider_estimated_published_date": "2026-10-15",
        "retrieved_at": "2026-10-16T00:00:00Z",
    })
    assert result["fields"]["source_updated"]["value"] is None
    assert result["fields"]["observed_source_status"]["value"] is None
