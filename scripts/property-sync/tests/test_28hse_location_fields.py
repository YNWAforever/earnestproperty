"""Offline regressions; the fixture is a labelled sanitized reconstruction."""
from pathlib import Path
import hashlib
import json
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping import worker as w

FIXTURE = Path(__file__).parent / 'fixtures/28hse-scrapingbee-4058953.sanitized.html'
RECORD = {'property_id': '4058953', 'deal_type': 'sale', 'title': 'Index title',
          'source_url': 'https://www.28hse.com/buy/apartment/property-4058953'}


def test_sanitized_fixture_bytes_match_manifest_on_every_platform():
    data = FIXTURE.read_bytes()
    manifest = json.loads(FIXTURE.with_suffix('.manifest.json').read_text(encoding='utf-8'))
    assert b'\r\n' not in data
    assert len(data) == manifest['sanitizedFixture']['bytes']
    assert hashlib.sha256(data).hexdigest() == manifest['sanitizedFixture']['sha256']
    assert manifest['sanitizedFixture']['syntheticStatus'] == 'SANITIZED_STRUCTURAL_RECONSTRUCTION'


def parse(html=None):
    return w.parse_28_detail(html or FIXTURE.read_text(encoding='utf-8'), RECORD,
                             require_live_identity=True)


def test_saved_location_dom_fields_and_json_ld_conflict():
    row = parse()
    assert row['block'] == '9'
    assert row['phase'] == '2A'
    assert row['agency_property_no'] == 'A035060'
    assert row['estate'] == '\u9999\u6e2f\u9ec3\u91d1\u6d77\u5cb8'
    assert row['floor'] == '\u4f4e\u5c64'
    assert row['unit'] is None
    assert row['price'] == '4880000'
    assert row['saleable_area'] == '535'
    assert row['gross_area'] == '698'
    assert row['bedrooms'] == 2 and row['bathrooms'] == 1
    assert row['raw_payload']['layout_evidence']['floor_range'] == '1-11/27\u6a13'
    assert row['raw_payload']['source_conflicts'][0]['resolution'] == 'dom'
    assert row['raw_payload']['json_ld']['mainEntity']['numberOfRooms'] == 1


@pytest.mark.parametrize('layout,block,phase', [
    ('\u7b2c 2A \u671f 9 \u5ea7 \u4f4e\u5c64 (1-11/27\u6a13)', '9', '2A'),
    ('9\u5ea7 \u9ad8\u5c64', '9', None),
    ('\u4e2d\u5c64', None, None),
    ('\u672a\u6709\u8cc7\u6599', None, None),
])
def test_synthetic_layout_variants_do_not_invent_exact_floor(layout, block, phase):
    html = FIXTURE.read_text(encoding='utf-8').replace('\u7b2c2A\u671f 9\u5ea7 \u4f4e\u5c64 (1-11/27\u6a13)', layout)
    row = parse(html)
    assert row['block'] == block and row['phase'] == phase
    assert row['unit'] is None
    assert row['floor'] == '\u4f4e\u5c64'  # The labelled floor DOM, not a range.


def test_unlabelled_estate_numbers_are_not_layout_identity():
    html = FIXTURE.read_text(encoding='utf-8').replace('\u5ea7\u6578\u53ca\u55ae\u4f4d:', 'Related:')
    row = parse(html)
    assert row['block'] is None and row['phase'] is None


def test_canonical_and_agency_identity_checks_are_not_relaxed():
    html = FIXTURE.read_text(encoding='utf-8')
    with pytest.raises(w.WorkerError, match='detail_identity'):
        parse(html.replace('rel="canonical"', 'rel="canonical"').replace('property-4058953', 'property-999'))
