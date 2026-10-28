"""Sanctioned agentblog HTTP index, fixed manifest, >=3s, no detail HTTP fallback."""
import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

ORIGIN = "https://www.property.hk"
UA = "EarnestPropertyBot/2.0 (+https://www.earnestproperty.com; price-status dry-run)"
MANIFEST = Path(__file__).parent / "config/propertyhk-agents.json"
CHALLENGE = re.compile(r"正在驗證|安全檢查|captcha|cf-chl|verify.{0,20}browser", re.I)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(url, *, detail=False):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "www.property.hk" or parsed.fragment
            or not re.fullmatch(r"/asking_detail/(?:[a-z]+/[a-z0-9_-]+/)?\d+\.html" if detail
                                else r"/(?:agentblog/[a-z]+/[a-z0-9_-]+/|agentblog\.php|robots\.txt)", parsed.path)):
        raise ValueError("unapproved_url")
    return url


def parse_index(html, url, agent, page=1):
    if CHALLENGE.search(html):
        raise ValueError("index_challenge")
    soup = BeautifulSoup(html, "html.parser")
    if not re.search(r"\bC-018613(?:-A\d{3})?\b", soup.get_text(" ")):
        raise ValueError("company_license_missing")
    tables = soup.select("table.table-hover")
    if len(tables) != 1:
        raise ValueError("index_table_missing")
    ads = []
    for tr in tables[0].find_all("tr"):
        cells = tr.find_all("td", recursive=False)
        checkbox = tr.find("input", attrs={"name": re.compile(r"^cbox\[")})
        if not checkbox:
            continue
        if len(cells) < 9 or not re.fullmatch(r"\d{1,12}", checkbox.get("value", "")):
            raise ValueError("index_row_invalid")
        ad_id = checkbox["value"]
        link = cells[1].find("a", href=True)
        detail = validate_url(urljoin(ORIGIN, link["href"] if link else ""), detail=True)
        if not urlsplit(detail).path.endswith("/" + ad_id + ".html"):
            raise ValueError("index_identity_mismatch")

        def amount(selector, multiplier):
            nodes = tr.select(selector)
            if len(nodes) != 1:
                raise ValueError("index_amount_missing")
            raw = nodes[0].get_text("", strip=True).replace(",", "").replace("$", "").replace("萬", "").strip()
            if raw == "--":
                return None
            if not re.fullmatch(r"\d+(?:\.\d+)?", raw):
                raise ValueError("index_amount_invalid")
            value = Decimal(raw) * multiplier
            if value <= 0:
                raise ValueError("index_amount_invalid")
            return format(value, "f")

        ads.append({"property_id": ad_id, "detail_url": detail,
                    "price": amount(".saleprice", 10000), "rent": amount(".rentprice", 1)})
    if len({a["property_id"] for a in ads}) != len(ads):
        raise ValueError("duplicate_index_ad")
    forms = soup.find_all("form", attrs={"name": "jumpForm"})
    if len(forms) != 1:
        raise ValueError("pagination_missing")
    form = forms[0]
    match = re.search(r"共\s*(\d+)\s*頁", form.get_text(" "))
    if not match or not 1 <= int(match[1]) <= 50 or form.get("method", "get").lower() != "get":
        raise ValueError("pagination_invalid")
    pages = int(match[1])
    fields = {n["name"]: n.get("value", "") for n in form.select("input[name]") if n["name"] != "p"}
    branch, slug = agent.split("/")
    if fields.get("agent", "").lower() != branch or fields.get("blog", "").lower() != slug:
        raise ValueError("pagination_scope_mismatch")
    cursor = form.find("input", attrs={"name": "p"})
    if cursor is None or str(cursor.get("value") or cursor.get("placeholder")) != str(page) or page > pages:
        raise ValueError("pagination_cursor_invalid")
    action = validate_url(urljoin(url, form.get("action", "")))
    next_url = action + "?" + urlencode({**fields, "p": page + 1}) if page < pages else None
    if not ads:
        # A roster agent may legitimately have no ads. Require the known empty
        # table/footer plus a single page; a missing/changed layout is not zero stock.
        headers = [n.get_text("", strip=True) for n in tables[0].select("thead th")]
        count = tables[0].find("input", attrs={"name": "selCount"})
        selected = tables[0].find("input", attrs={"name": "selPrint"})
        expected_headers = ["全選", "相片", "地區", "物業資料", "樓層", "建築(呎)", "實用(呎)", "售價(萬)", "租金(HK$)"]
        if (page != 1 or pages != 1 or headers[:9] != expected_headers
                or count is None or count.get("value") != "0" or selected is None
                or not re.search(r"共\s*0\s*個", selected.get("value", ""))
                or soup.select('a[href*="/asking_detail/"]')):
            raise ValueError("empty_index_requires_review")
    return ads, pages, next_url


class PacedHttp:
    def __init__(self, *, clock=time.monotonic, sleep=time.sleep, transport=None):
        self.clock, self.sleep, self.last = clock, sleep, None
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.transport = transport or self._request

    def _request(self, url):
        try:
            with self.opener.open(Request(url, headers={"User-Agent": UA}), timeout=30) as response:
                body = response.read(4 * 1024 * 1024 + 1)
                if len(body) > 4 * 1024 * 1024:
                    raise ValueError("response_too_large")
                return response.status, body.decode("utf-8", errors="strict")
        except HTTPError as error:
            raise ValueError("index_http_rejected") from error

    def get(self, url):
        validate_url(url)
        if self.last is not None:
            self.sleep(max(0, 3 - (self.clock() - self.last)))
        try:
            code, html = self.transport(url)
        finally:
            self.last = self.clock()
        if code != 200 or CHALLENGE.search(html):
            raise ValueError("index_access_rejected")
        return html


def collect(manifest, http):
    agents = manifest.get("agents")
    if (not isinstance(agents, list) or len(agents) != 19 or len(set(agents)) != 19
            or manifest.get("license") != "C-018613" or manifest.get("absence_enabled") is not False
            or any(not re.fullmatch(r"(?:eps|ept|epw)/[a-z0-9_-]+", a) for a in agents)):
        raise ValueError("invalid_agent_manifest")
    robots = RobotFileParser()
    robots.parse(http.get(ORIGIN + "/robots.txt").splitlines())
    ads, evidence = {}, []
    for agent in agents:
        url, expected, seen = ORIGIN + "/agentblog/" + agent + "/", None, set()
        for page in range(1, 51):
            if not robots.can_fetch(UA, url):
                raise ValueError("robots_disallowed")
            html = http.get(url)
            rows, pages, next_url = parse_index(html, url, agent, page)
            if expected is not None and pages != expected:
                raise ValueError("pagination_count_changed")
            expected = pages
            evidence.append({"agent": agent, "page": page, "sha256": hashlib.sha256(html.encode()).hexdigest()})
            for row in rows:
                ad = row["property_id"]
                if ad in seen:
                    raise ValueError("pagination_repeated_ad")
                seen.add(ad)
                if ad in ads and {k: v for k, v in ads[ad].items() if k != "detail_url"} != {k: v for k, v in row.items() if k != "detail_url"}:
                    raise ValueError("conflicting_index_ad")
                ads[ad] = row
            if next_url is None:
                break
            url = next_url
        else:
            raise ValueError("pagination_ceiling")
    return {"schema": "propertyhk-index/v1", "complete": True, "absence_enabled": False,
            "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "ads": sorted(ads.values(), key=lambda a: a["property_id"]), "evidence": evidence}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = collect(json.loads(args.manifest.read_bytes()), PacedHttp())
        with args.out.open("x", encoding="utf-8") as output:
            json.dump(result, output, ensure_ascii=False, indent=2)
    except Exception:
        parser.exit(2, "propertyhk_index_failed_closed\n")
