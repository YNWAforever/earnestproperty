"""Identity regressions for the observed modern detail heading."""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping import worker as w

FIXTURES = Path(__file__).parent / "fixtures"


def detail(deal="sale"):
    return (FIXTURES / f"28hse-modern-{deal}-structure.html").read_text(encoding="utf-8")


def record(deal="sale"):
    ident, path = ("4054123", "buy") if deal == "sale" else ("4048371", "rent")
    return {
        "property_id": ident,
        "deal_type": deal,
        "source_url": f"https://www.28hse.com/{path}/apartment/property-{ident}",
        "title": "Index-validated advertisement",
    }


@pytest.mark.parametrize("deal,amount,usable,gross", [
    ("sale", "20800000", "1852", "2432"),
    ("rent", "18600", "680", "895"),
])
def test_modern_heading_with_agreeing_page_identity_parses_actual_amounts(deal, amount, usable, gross):
    result = w.parse_28_detail(detail(deal), record(deal))
    assert result["price" if deal == "sale" else "rent"] == amount
    assert result["saleable_area"] == usable
    assert result["gross_area"] == gross
    assert result["property_id"] == record(deal)["property_id"]
    assert result["source_url"] == record(deal)["source_url"]
    assert result["unit"] is None
    assert result["block"] is None
    assert result["agency_property_no"] is None


@pytest.mark.parametrize("wrong", [
    "https://www.28hse.com/buy/apartment/property-9999999",
    "https://www.28hse.com/rent/apartment/property-4054123",
    "https://evil.example/buy/apartment/property-4054123",
    "http://www.28hse.com/buy/apartment/property-4054123",
    "https://www.28hse.com:443/buy/apartment/property-4054123",
    "https://user@www.28hse.com/buy/apartment/property-4054123",
    "https://www.28hse.com/buy/apartment/property-4054123?agent=540",
    "https://www.28hse.com/buy/apartment/property-4054123#other",
    "",
])
def test_conflicting_page_url_rejects_even_if_legacy_heading_matches(wrong):
    html = detail().replace("<h1>", "<h1>#4054123 \u552e\u76e4 ")
    html = html.replace('property="og:url" content="' + record()["source_url"] + '"',
                        'property="og:url" content="' + wrong + '"')
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(html, record())


@pytest.mark.parametrize("tag", ["og:url", "al:web:url"])
def test_modern_layout_requires_two_agreeing_explicit_page_urls(tag):
    html = detail().replace(f'<meta property="{tag}" content="{record()["source_url"]}">', "")
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(html, record())


def test_canonical_can_supply_second_identity_but_cannot_contradict_it():
    url = record()["source_url"]
    html = detail().replace(f'<meta property="al:web:url" content="{url}">',
                            f'<link rel="canonical" href="{url}">')
    assert w.parse_28_detail(html, record())["price"] == "20800000"
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(html.replace('rel="canonical" href="' + url,
                                      'rel="canonical" href="https://www.28hse.com/buy/apartment/property-999'), record())


@pytest.mark.parametrize("change", [
    {"source_url": "https://www.28hse.com/buy/apartment/property-999"},
    {"source_url": "https://www.28hse.com/rent/apartment/property-4054123"},
    {"source_url": "https://evil.example/buy/apartment/property-4054123"},
    {"deal_type": "rent"},
    {"property_id": "405412"},
])
def test_record_identity_and_offer_cannot_be_overridden_by_heading(change):
    html = detail().replace("<h1>", "<h1>#4054123 \u552e\u76e4 ")
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(html, {**record(), **change})


@pytest.mark.parametrize("mutate", [
    lambda html: html.replace("</head>", '<meta property="og:url" content="' + record()["source_url"] + '"></head>'),
    lambda html: html.replace("</body>", "<h1>Other advertisement</h1></body>"),
    lambda html: html.replace("</body>", '<table class="tablePair"><tr><td>Other</td></tr></table></body>'),
    lambda html: html.replace("<h1>", "<h1>#999 \u552e\u76e4 "),
    lambda html: html.replace("\u552e$2,080", "\u79df$2,080"),
])
def test_ambiguous_or_contradictory_detail_identity_is_rejected(mutate):
    with pytest.raises(w.WorkerError, match="detail_(identity|template)"):
        w.parse_28_detail(mutate(detail()), record())


def test_modern_heading_without_request_url_is_not_identity_evidence():
    value = record()
    value.pop("source_url")
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(detail(), value)


def test_structured_excerpt_cannot_bypass_live_collection_identity():
    html = '<main data-listing-detail><table><tr><td>price</td><td>$100</td></tr></table></main>'
    with pytest.raises(w.WorkerError, match="detail_identity"):
        w.parse_28_detail(html, record(), require_live_identity=True)
