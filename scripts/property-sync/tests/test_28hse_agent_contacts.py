"""The 28hse sync's detail fetch also carries the correspondent agents (EAA licences).

The collector already fetches every listing's detail page for price/area; these tests pin
that the 放盤聯絡人 cards on that same document are read into raw_payload.agent_contacts,
so property_agents needs no second per-listing fetch.
"""
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping import worker as w

FIXTURES = Path(__file__).parent / "fixtures"

CONTACTS = """
<div class="ui items">
  <div class="item contactsDiv">
    <div class="content">
      <h4 class="ui header">朱倩敏 Mun Chu <span class="ui label nameCardBtn">卡片</span></h4>
      <span class="less_span">代理個人牌照號碼: E-421644</span>
    </div>
  </div>
  <div class="item contactsDiv">
    <div class="content">
      <h4 class="ui header">鄧錦雄 Terence Tang</h4>
      <span class="less_span">代理個人牌照號碼: E-070754</span>
    </div>
  </div>
</div>
"""


def detail(deal="sale", contacts=CONTACTS):
    html = (FIXTURES / f"28hse-modern-{deal}-structure.html").read_text(encoding="utf-8")
    return html.replace("</body></html>", contacts + "</body></html>")


def record(deal="sale"):
    ident, path = ("4054123", "buy") if deal == "sale" else ("4048371", "rent")
    return {
        "property_id": ident,
        "deal_type": deal,
        "source_url": f"https://www.28hse.com/{path}/apartment/property-{ident}",
        "title": "Index-validated advertisement",
    }


def test_contacts_keep_page_order_name_and_licence():
    result = w.parse_28_detail(detail(), record())
    assert result["raw_payload"]["agent_contacts"] == [
        {"name": "朱倩敏 Mun Chu", "licence": "E-421644"},
        {"name": "鄧錦雄 Terence Tang", "licence": "E-070754"},
    ]


def test_no_contact_cards_is_an_empty_list_not_an_error():
    assert w.extract_28_agent_contacts(w.soup_checked(detail(contacts=""))) == []


def test_licence_without_readable_name_is_still_carried():
    html = """
    <div class="item contactsDiv">
      <span class="less_span">代理個人牌照號碼：S-098767</span>
    </div>
    """
    assert w.extract_28_agent_contacts(w.soup_checked(html)) == [
        {"name": None, "licence": "S-098767"}
    ]


def test_agency_card_outside_contacts_div_is_not_an_agent():
    html = """
    <div class="item agencyCard">
      <h4 class="ui header">晉誠地產代理有限公司</h4>
      <span class="less_span">公司牌照號碼: C-018613</span>
    </div>
    """
    assert w.extract_28_agent_contacts(w.soup_checked(html)) == []


def test_at_most_two_contacts_match_the_correspondent_positions():
    third = """
    <div class="item contactsDiv">
      <h4 class="ui header">第三位 Third</h4>
      <span class="less_span">代理個人牌照號碼: S-111111</span>
    </div>
    """
    contacts = w.extract_28_agent_contacts(w.soup_checked(detail(contacts=CONTACTS + third)))
    assert [contact["licence"] for contact in contacts] == ["E-421644", "E-070754"]


@pytest.mark.parametrize("deal", ["sale", "rent"])
def test_detail_record_carries_the_contacts_for_both_deal_types(deal):
    result = w.parse_28_detail(detail(deal), record(deal))
    assert [contact["licence"] for contact in result["raw_payload"]["agent_contacts"]] == [
        "E-421644",
        "E-070754",
    ]
