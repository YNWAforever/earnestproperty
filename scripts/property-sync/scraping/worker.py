"""Deterministic source workers. No LLM, database connection, or notification side effects."""

import csv, json, re, os, time, random, uuid, hashlib, unicodedata, subprocess
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager
from urllib.parse import urlsplit, urljoin, parse_qs, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from email.utils import parsedate_to_datetime
from bs4 import BeautifulSoup

BRANCHES = ["EPW", "EPS", "EPT"]
FIELDS = [
    "title",
    "price",
    "rent",
    "gross_area",
    "saleable_area",
    "gross_unit_price",
    "saleable_unit_price",
    "source_status",
    "source_status_reason",
]


class WorkerError(Exception):
    pass


def text(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split())


def number(value, kind="decimal"):
    if value is None or text(value) in ("", "面議"):
        return None
    s = text(value).replace(",", "").replace("HK$", "").replace("$", "").strip()
    scale = Decimal(1)
    if kind == "money":
        for suffix, mult in [
            ("億", "100000000"),
            ("萬", "10000"),
            ("M", "1000000"),
            ("m", "1000000"),
            ("K", "1000"),
            ("k", "1000"),
        ]:
            if s.endswith(suffix):
                s = s[: -len(suffix)].strip()
                scale = Decimal(mult)
                break
    if kind == "area":
        s = re.sub(r"\s*(?:呎|平方呎|sq\.?\s*ft\.?)$", "", s, flags=re.I).strip()
    if not re.fullmatch(r"\d{1,16}(?:\.\d{1,8})?", s):
        raise WorkerError("invalid_number")
    result = format(Decimal(s) * scale, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    if not re.fullmatch(r"\d{1,16}(?:\.\d{1,8})?", result):
        raise WorkerError("invalid_number")
    return result


def clean_id(value, source):
    s = str(value).strip()
    if not s or len(s) > 160 or re.search(r"[\x00-\x20\x7f]", s):
        raise WorkerError("invalid_source_id")
    if source == "28hse":
        if not re.fullmatch(r"#?\d+", s):
            raise WorkerError("invalid_source_id")
        s = s.removeprefix("#")
    return s


def checked_url(url, origin, paths=None):
    p = urlsplit(url)
    if (
        p.scheme != "https"
        or p.username
        or p.password
        or p.port
        or p.fragment
        or f"https://{p.netloc}" != origin
        or re.search(r"[\x00-\x20\x7f]", url)
    ):
        raise WorkerError("unsafe_url")
    if paths and not any(re.fullmatch(pattern, p.path) for pattern in paths):
        raise WorkerError("unsafe_path")
    return url


class Robots:
    def __init__(self, content, agent="EarnestPropertyBot"):
        groups = []
        names = []
        rules = []
        delays = []
        directives = False
        for line in content.splitlines() + ["User-agent: __end__"]:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            if ":" not in line:
                raise WorkerError("malformed_robots")
            k, v = (x.strip() for x in line.split(":", 1))
            k = k.lower()
            if k == "user-agent":
                if directives:
                    groups.append((names, rules, delays))
                    names = []
                    rules = []
                    delays = []
                    directives = False
                names.append(v.lower())
            elif k in ("allow", "disallow", "crawl-delay"):
                if not names:
                    raise WorkerError("malformed_robots")
                directives = True
                if k == "crawl-delay":
                    try:
                        d = float(v)
                    except ValueError:
                        raise WorkerError("malformed_robots")
                    if not 0 <= d <= 86400:
                        raise WorkerError("malformed_robots")
                    delays.append(d)
                elif v:
                    if not v.startswith(("/", "*")):
                        raise WorkerError("malformed_robots")
                    rules.append((*robots_path(v, pattern=True), k == "allow"))
        selected = [g for g in groups if agent.lower() in g[0]] or [
            g for g in groups if "*" in g[0]
        ]
        self.rules = [r for g in selected for r in g[1]]
        self.delay = max([0] + [d for g in selected for d in g[2]])

    def allowed(self, url):
        p = urlsplit(url)
        path = robots_path(p.path + ("?" + p.query if p.query else ""))[0]
        hits = []
        for pattern, specificity, allow in self.rules:
            anchored = pattern.endswith("$")
            body = pattern[:-1] if anchored else pattern
            expr = (
                "^" + re.escape(body).replace(r"\*", ".*") + ("$" if anchored else "")
            )
            if re.search(expr, path):
                hits.append((specificity, allow))
        return not hits or any(a for n, a in hits if n == max(x[0] for x in hits))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_request(url, data=None, token=None):
    headers = {
        "User-Agent": "EarnestPropertyBot/2.0",
        "Accept": "text/html,application/json",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        response = build_opener(NoRedirect).open(
            Request(url, data=data, headers=headers), timeout=30
        )
    except HTTPError as e:
        response = e
    with response:
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise WorkerError("response_too_large")
        return response.status, dict(response.headers), raw


class Fetcher:
    def __init__(self, origin, paths, fixtures=None, sleep=time.sleep, checkpoint=None):
        self.origin = origin
        self.paths = paths
        self.fixtures = fixtures
        self.sleep = sleep
        self.policy = None
        self.last = 0
        self.evidence = []
        self.checkpoint = checkpoint

    def get(self, url, robots=False):
        checked_url(url, self.origin, None if robots else self.paths)
        if self.policy is None and not robots:
            self.policy = Robots(self.get(self.origin + "/robots.txt", True))
        if not robots and not self.policy.allowed(url):
            raise WorkerError("robots_disallowed")
        active = url
        for attempt in range(3):
            try:
                for redirect in range(6):
                    checked_url(active, self.origin, None if robots else self.paths)
                    if not robots and not self.policy.allowed(active):
                        raise WorkerError("robots_disallowed")
                    if self.fixtures is not None:
                        entry = self.fixtures.get(active)
                        if entry is None:
                            raise WorkerError("fixture_missing_url")
                        status, headers, body = (
                            entry.get("status", 200),
                            entry.get("headers", {}),
                            entry.get("html", "").encode(),
                        )
                    else:
                        self.sleep(
                            max(
                                0,
                                max(
                                    random.uniform(2, 3),
                                    self.policy.delay if self.policy else 0,
                                )
                                - (time.monotonic() - self.last),
                            )
                        )
                        self.last = time.monotonic()
                        status, headers, body = http_request(active)
                    if self.checkpoint:
                        self.checkpoint.response(active, status, attempt + 1, body)
                    self.evidence.append(
                        {
                            "url": active,
                            "status": status,
                            "attempt": attempt + 1,
                            "html": body.decode("utf-8", errors="replace"),
                        }
                    )
                    if status in (301, 302, 303, 307, 308):
                        if redirect == 5 or not headers.get("Location"):
                            raise WorkerError("redirect_limit")
                        active = urljoin(active, headers["Location"])
                        continue
                    if robots and status in (404, 410):
                        return ""
                    if status in (401, 403, 429):
                        raise WorkerError("blocked")
                    if status == 408 or status >= 500:
                        raise URLError("retryable")
                    if status != 200:
                        raise WorkerError("http_failed")
                    return body.decode("utf-8", errors="strict")
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise WorkerError("network_failed")
                if self.fixtures is None:
                    self.sleep(2 ** (attempt + 1))
        raise WorkerError("network_failed")


def soup_checked(html):
    s = BeautifulSoup(html, "html.parser")
    if (
        not text(s.get_text())
        or re.search(r"cf-chl-|challenge-platform", html, re.I)
        or s.select('[data-sitekey], input[type="password"]')
        or any(
            re.match(
                r"^(just a moment|access denied|attention required|verify you are human|captcha challenge)",
                text(n.get_text()),
                re.I,
            )
            for n in s.select("h1,title")
        )
    ):
        raise WorkerError("blocked")
    return s


# The only grades 28Hse renders, strongest first. Matched exactly, never as a
# substring: 黃金海岸, 黃金海灣 and 黃金地段 all contain 黃金 and none of them is
# a promotion grade. An unrecognised badge is carried through verbatim so the
# consumer can record it as unknown rather than guessing a tier for it.
GRADE_ORDER = ("黃金", "置頂")


def grade_label(anchor_node):
    """The .grade_label text for one listing anchor, or "" when unbadged."""
    node = anchor_node.select_one(".grade_label")
    if node is None:
        card = anchor_node.find_parent(class_="property_item")
        node = card.select_one(".grade_label") if card else None
    return text(node.get_text()) if node is not None else ""


def strongest_grade(*values):
    """Deterministic merge when one listing is seen more than once."""
    for grade in GRADE_ORDER:
        if grade in values:
            return grade
    for value in values:
        if value:
            return value
    return ""


def parse_28_index(html, deal):
    s = soup_checked(html)
    names = [text(n.get_text()).lower() for n in s.select("h1")]
    if len(names) != 1 or names[0] not in (
        "晉誠地產",
        "晉誠地產代理有限公司 earnest property agency ltd",
        "earnest property",
        "晉誠地產 earnest property",
        "earnest property 晉誠地產",
    ):
        raise WorkerError("company_identity")
    if set(re.findall(r"C-\d{6}", s.get_text(), re.I)) != {"C-018613"}:
        raise WorkerError("licence_identity")
    label = "放售樓盤" if deal == "sale" else "放租樓盤"
    counts = set(re.findall(r"共有\s*([\d,]+)\s*個" + label, s.get_text(" ")))
    if len(counts) != 1:
        raise WorkerError("advertised_count_missing")
    total = int(next(iter(counts)).replace(",", ""))
    links = {}
    path = "buy" if deal == "sale" else "rent"
    for a in s.select("a[href]"):
        candidate = urlsplit(urljoin("https://www.28hse.com", a["href"]))
        if (
            candidate.scheme != "https"
            or candidate.netloc != "www.28hse.com"
            or candidate.query
            or candidate.fragment
        ):
            continue
        m = re.fullmatch("/" + path + r"/[^/%?#]+/property-(\d+)/?", candidate.path)
        if not m:
            continue
        ident = m[1]
        title = text(a.get_text())
        url = "https://www.28hse.com" + candidate.path.rstrip("/")
        if ident in links and links[ident]["source_url"] != url:
            raise WorkerError("conflicting_url")
        # 28Hse's paid placement grade, rendered as a .grade_label badge inside
        # the card's image anchor. Each listing has two anchors and only the
        # image one carries the badge, so look at the enclosing card too and
        # keep the strongest grade seen for this id. Absent means an ordinary
        # listing -- this page parsed as a real agent index, so absence is an
        # observation, not a gap. Never inferred from the title: a listing here
        # reads "黃金地段" with no badge at all.
        grade = grade_label(a)
        if ident in links:
            grade = strongest_grade(links[ident]["promotion_tier_raw"], grade)
        if ident not in links or len(title) > len(links[ident]["title"]):
            links[ident] = {
                "property_id": ident,
                "raw_property_id": ident,
                "source_url": url,
                "title": title,
                "deal_type": deal,
                "promotion_tier_raw": grade,
            }
        else:
            links[ident]["promotion_tier_raw"] = grade
    if any(not r["title"] for r in links.values()):
        raise WorkerError("missing_title")
    # v2 requires an actual empty endpoint, even when advertised total was reached.
    terminal = not links and "沒有找到任何資料" in s.get_text()
    if not links and not terminal:
        raise WorkerError("unknown_empty")
    return list(links.values()), terminal, total


def extract_28_company_number(html):
    """Read the explicit agent-provided number, never the advertisement ID.

    Missing labels are unobserved. An explicit but malformed or conflicting
    label rejects the detail so it cannot supply identity or absence evidence.
    """
    soup = BeautifulSoup(html, "html.parser")
    numbers = set()
    for node in soup.find_all(string=lambda value: value and "物業編號" in value):
        if node.parent.name in ("script", "style"):
            continue
        label = text(node.parent.get_text(" ", strip=True))
        if node.parent.name in ("td", "th") and label.rstrip(":") == "物業編號":
            cells = node.parent.parent.find_all(["td", "th"], recursive=False)
            if len(cells) != 2 or cells[0] is not node.parent:
                raise WorkerError("invalid_agency_property_no")
            label = "物業編號: " + text(cells[1].get_text(" ", strip=True))
        match = re.fullmatch(r"物業編號\s*:\s*([A-Za-z0-9]{1,32})\s*\(代理提供\)", label)
        if not match:
            raise WorkerError("invalid_agency_property_no")
        numbers.add(match[1].upper())
    if len(numbers) > 1:
        raise WorkerError("conflicting_agency_property_no")
    return next(iter(numbers), None)


def parse_28_detail(html, record):
    s = soup_checked(html)
    roots = s.select("[data-listing-detail]")
    live = not roots
    if live:
        headings = [text(n.get_text()) for n in s.select("h1")]
        marker = "售盤" if record["deal_type"] == "sale" else "租盤"
        if len(headings) != 1 or not re.search(
            r"#" + re.escape(record["property_id"]) + r"\s+" + marker, headings[0]
        ):
            raise WorkerError("detail_identity")
        roots = s.select("table.tablePair")
    if len(roots) != 1:
        raise WorkerError("detail_template")
    labels = {
        "售價": "price",
        "price": "price",
        "租金": "rent",
        "出租價": "rent",
        "每月租金": "rent",
        "單位樓層": "floor",
        "座向(客廳)": "orientation",
        "rent": "rent",
        "實用面積": "saleable_area",
        "usable area": "saleable_area",
        "建築面積": "gross_area",
        "gross area": "gross_area",
        "建築呎價": "gross_unit_price",
        "實用呎價": "saleable_unit_price",
        "間隔": "bedrooms",
        "間格": "bedrooms",
        "rooms": "bedrooms",
        "浴室": "bathrooms",
        "bathrooms": "bathrooms",
        "地址": "district",
        "地區": "district",
        "address": "district",
        "樓層": "floor",
        "層數": "floor",
        "floor": "floor",
        "座向": "orientation",
        "座向景觀": "orientation",
    }
    raw = {}
    lifecycle = set()

    def keep(field, value):
        if field in raw and raw[field] != value:
            raise WorkerError("contradictory_detail")
        raw[field] = value

    for row in roots[0].select("tr"):
        cells = row.select("td,th")
        if len(cells) < 2:
            continue
        key = labels.get(text(cells[0].get_text()).rstrip(":：").lower())
        value = text(cells[1].get_text())
        if text(cells[0].get_text()).rstrip(":：").lower() in ("狀態", "樓盤狀態", "status"):
            if value not in ("已售", "已租"):
                raise WorkerError("unknown_source_status")
            lifecycle.add(value)
        if live:
            primary_value = cells[1].select_one('.pairValue')
            value = text(primary_value.get_text()) if primary_value else value
            label = text(cells[0].get_text())
            if label == '地區屋苑':
                keep('estate', value)
                sub = cells[1].select('.pairSubValue')
                if sub:
                    keep('district', text(sub[0].get_text()))
            if label == '房間及浴室':
                bedrooms = re.search(r'(\d+)\s*房',value)
                bathrooms = re.search(r'(\d+)\s*浴室',value)
                if bedrooms:
                    keep('bedrooms', bedrooms[1])
                if bathrooms:
                    keep('bathrooms', bathrooms[1])
            if key in ('price','rent'):
                price_node = primary_value or cells[1]
                for badge in price_node.select('.label'):
                    status_label = text(badge.get_text())
                    if status_label not in ('已售', '已租'):
                        raise WorkerError('unknown_source_status')
                    lifecycle.add(status_label)
                    badge.extract()
                value = text(price_node.get_text())
                value = re.sub(r'^(?:售|租)\s*','',value)
                value = re.sub(r'\s*元$','',value)
            if key in ('gross_area','saleable_area'):
                sub = cells[1].select_one('.pairSubValue')
                if sub:
                    unit = re.search(r'@\s*([\d,.]+)\s*元',text(sub.get_text()))
                    if unit:
                        keep(key.replace('_area', '_unit_price'), unit[1])
        if key:
            keep(key, value)
    if not raw:
        raise WorkerError("detail_template")
    if len(lifecycle) > 1 or lifecycle and next(iter(lifecycle)) != ('已售' if record['deal_type'] == 'sale' else '已租'):
        raise WorkerError('contradictory_source_status')
    reason = {'已售': 'sold', '已租': 'rented'}.get(next(iter(lifecycle), None))
    r = {
        **record,
        "source_status": "delisted" if reason else "active",
        "source_status_reason": reason,
        "block": None,
        "unit": None,
        "phase": None,
        "estate": None,
        "agency_property_no": extract_28_company_number(html),
        "raw_payload": {"detail_fields": raw, "source_status_labels": sorted(lifecycle)},
    }
    for k, v in raw.items():
        if k in ("price", "rent", "gross_unit_price", "saleable_unit_price"):
            r[k] = None if v in ("價格面議", "租金面議") else number(v, "money")
        elif k.endswith("_area"):
            r[k] = number(v, "area")
        elif k in ("bedrooms", "bathrooms"):
            m = re.search(r"(\d+)\s*(?:房|bed|$)", v, re.I)
            r[k] = 0 if "開放式" in v else int(m[1]) if m else None
        else:
            r[k] = v
    from .publication import publication_content
    r["publication"] = publication_content(html, r)
    return r


def validate_config(source, cfg):
    if source == "propertyhk":
        if (
            cfg.get("id_scope") not in ("global", "branch")
            or cfg.get("id_scope_verified") is not True
        ):
            raise WorkerError("id_scope_unverified")
        if any(not cfg.get("branch_urls", {}).get(b) for b in BRANCHES):
            raise WorkerError("configuration_branch_url")
        for key in (
            "container",
            "card",
            "id",
            "link",
            "title",
            "empty",
            "detail_container",
            "fields",
        ):
            if not cfg.get("selectors", {}).get(key):
                raise WorkerError("configuration_selectors")
        if (
            not cfg.get("allowed_paths")
            or not cfg.get("company_name")
            or not cfg.get("company_license")
        ):
            raise WorkerError("configuration_identity")
        offers = cfg.get("offer_values", {})
        if not isinstance(offers, dict) or any(not isinstance(k,str) or not isinstance(v,list) or not v or len(v)!=len(set(v)) or any(x not in ('sale','rent') for x in v) for k,v in offers.items()):
            raise WorkerError("configuration_offer_values")
        for url in cfg["branch_urls"].values():
            if "{page}" not in url:
                raise WorkerError("configuration_pagination")
            checked_url(url.format(page=1), cfg.get("origin", ""), cfg["allowed_paths"])
    if not 1 <= cfg.get("max_pages", 100) <= 1000:
        raise WorkerError("configuration_page_limit")



def inspect_property_agent_index(html, expected_url, *, expected_license):
    """Inspect the observed agent.php table; this is never an ingestion snapshot.

    Detail access, full branch/district scope, ID scope and media rights are
    separate gates. Even a verified last index page cannot promote a baseline.
    """
    origin = "https://www.property.hk"
    checked_url(expected_url, origin, [r"/agent\.php"])
    query = parse_qs(urlsplit(expected_url).query, keep_blank_values=True)
    if any(len(values) != 1 for values in query.values()):
        raise WorkerError("pagination_identity")
    identity = {key: query.get(key, [""])[0] for key in ("agent", "dt", "sid")}
    if identity["agent"] not in BRANCHES or not identity["dt"] or not identity["sid"]:
        raise WorkerError("pagination_identity")
    requested_page = query.get("p", ["1"])[0]
    if not re.fullmatch(r"[1-9]\d{0,2}", requested_page):
        raise WorkerError("pagination_identity")
    soup = soup_checked(html)
    company = soup.select("table.bd_table")
    if len(company) != 1:
        raise WorkerError("company_identity")
    company_text = text(company[0].get_text(" "))
    licenses = set(re.findall(r"C-\d{6}(?:-A\d{3})?", company_text))
    if "晉誠地產代理有限公司" not in company_text or licenses != {expected_license}:
        raise WorkerError("company_identity")
    forms = soup.select('form[name="jumpForm"]')
    if len(forms) != 1 or forms[0].get("action") != "/agent.php" or forms[0].get("method", "").lower() != "get":
        raise WorkerError("pagination_identity")
    form = forms[0]
    inputs = form.select("input[name]")
    if len({node["name"] for node in inputs}) != len(inputs):
        raise WorkerError("pagination_identity")
    fields = {node["name"]: node.get("value", "") for node in inputs}
    if any(fields.get(key) != value for key, value in identity.items()):
        raise WorkerError("pagination_identity")
    # Only the published form is used to construct pagination, never a guessed SID.
    if set(fields) - {"p", "hqid", "val", "prop", "dt", "agent", "sid", "select"}:
        raise WorkerError("pagination_identity")
    page_input = form.select('input[name="p"]')
    totals = re.findall(r"共\s*(\d+)\s*頁", text(form.get_text(" ")))
    if len(totals) != 1 or len(page_input) != 1 or page_input[0].get("placeholder") != requested_page:
        raise WorkerError("pagination_identity")
    page, pages = int(requested_page), int(totals[0])
    if not 1 <= page <= pages <= 100:
        raise WorkerError("pagination_identity")
    tables = soup.select("table.hidden-xs.table.table-hover")
    if len(tables) != 1:
        raise WorkerError("index_template")
    table = tables[0]
    columns = [text(node.get_text(" ")) for node in table.select("thead th")]
    if columns != ["全選", "相片", "地區", "物業資料", "樓層", "建築(呎)", "實用(呎)", "售價(萬)", "租金(HK$)", ""]:
        raise WorkerError("index_columns")
    listings, ids = [], set()
    for node in table.select('input[type="checkbox"][name^="cbox["]'):
        ident = node.get("value", "")
        row = node.find_parent("tr")
        cells = row.find_all("td", recursive=False) if row else []
        if not re.fullmatch(r"[0-9]+", ident) or ident in ids or len(cells) != 10 or row.find_parent("table") is not table:
            raise WorkerError("index_identity")
        detail_path = "/asking_detail/" + ident + ".html"
        links = {anchor["href"] for anchor in row.select('a[href*="asking_detail"]')}
        if links != {detail_path}:
            raise WorkerError("index_identity")
        ids.add(ident)
        heading = cells[3].select_one(".bname")
        dates = set(re.findall(r"更新日期\s*[:：]\s*(\d{4}-\d{2}-\d{2})", text(cells[3].get_text(" "))))
        if not heading or not text(heading.get_text()) or len(dates) != 1:
            raise WorkerError("index_fields")
        updated = next(iter(dates))
        try:
            datetime.strptime(updated, "%Y-%m-%d")
        except ValueError:
            raise WorkerError("source_updated_date")
        base = {
            "property_id": ident, "raw_property_id": ident,
            "source_url": origin + detail_path, "branch_code": identity["agent"],
            "district_filter": identity["dt"], "title": text(heading.get_text()),
            "district": text(cells[2].get_text()), "floor": text(cells[4].get_text()) or None,
            "source_updated_date": updated, "observation_kind": "index_only",
        }
        for index, key in [(5, "gross_area"), (6, "saleable_area")]:
            value = text(cells[index].get_text())
            base[key] = None if value == "--" else number(value, "area")
        offers = []
        for index, selector, key, deal in [(7, ".saleprice", "price", "sale"), (8, ".rentprice", "rent", "rent")]:
            price_nodes = cells[index].select(selector)
            if len(price_nodes) != 1:
                raise WorkerError("index_fields")
            value = text(price_nodes[0].get_text(" "))
            if not value:
                raise WorkerError("index_fields")
            base[key] = None if value == "--" else number(value, "money")
            if value != "--":
                offers.append(deal)
        if not offers:
            raise WorkerError("index_fields")
        listings.extend({**base, "deal_type": deal} for deal in offers)
    if not ids:
        # No approved true-empty sample exists: never infer absence from empty DOM.
        raise WorkerError("unknown_empty")
    fields["p"] = str(page + 1)
    return {
        "branch": identity["agent"], "district_filter": identity["dt"],
        "page": page, "listed_pages": pages, "is_last_listed_page": page == pages,
        "next_url": None if page == pages else origin + form["action"] + "?" + urlencode(fields),
        "advertisement_count": len(ids), "listings": listings,
        "full_snapshot": False, "details_verified": False,
        "eligible_for_absence": False, "id_scope_verified": False,
    }


def parse_property_index(html, branch, cfg):
    s = soup_checked(html)
    sel = cfg["selectors"]
    doc = text(s.get_text(" "))
    if cfg["company_name"] not in doc or cfg["company_license"] not in doc:
        raise WorkerError("company_identity")
    if not s.select_one(sel["container"]):
        raise WorkerError("index_template")
    records = []
    for card in s.select(sel["card"]):

        def field(key):
            node = card.select_one(sel[key])
            return text(node.get_text()) if node else ""

        node = card.select_one(sel["link"])
        raw = field("id")
        ident = clean_id(raw, "propertyhk")
        if not node or not node.get("href"):
            raise WorkerError("missing_identity_link")
        url = urljoin(cfg["origin"], node["href"])
        checked_url(url, cfg["origin"], cfg["allowed_paths"])
        value = field("deal_type") if sel.get("deal_type") else cfg.get("deal_type")
        deals = cfg.get("offer_values", {}).get(value, [value])
        if not isinstance(deals,list) or not deals or any(deal not in ('sale','rent') for deal in deals):
            raise WorkerError("invalid_deal_type")
        for deal in deals:
            records.append({"property_id":ident,"raw_property_id":raw,"source_url":url,
                            "title":field("title"),"deal_type":deal,"branch_code":branch,"branch_memberships":[branch]})
    terminal = not records and bool(s.select_one(sel["empty"]))
    if not records and not terminal:
        raise WorkerError("unknown_empty")
    return records, terminal, None


def parse_property_detail(html, record, cfg):
    s = soup_checked(html)
    root = s.select_one(cfg["selectors"]["detail_container"])
    if root is None:
        raise WorkerError("detail_template")
    r = {**record, "unit": None, "block": None, "floor": None}
    raw = {}
    for k, selector in cfg["selectors"]["fields"].items():
        node = root.select_one(selector)
        v = text(node.get_text()) if node else None
        raw[k] = v
        if k in FIELDS and k != "title":
            r[k] = number(
                v,
                (
                    "money"
                    if k in ("price", "rent")
                    else "area" if k.endswith("_area") else "decimal"
                ),
            )
        elif k in ("bedrooms", "bathrooms"):
            r[k] = int(v) if v is not None and v.isdigit() else None
        else:
            r[k] = v
    for k in cfg.get("required_detail_fields", []):
        if r.get(k) is None:
            raise WorkerError("missing_required_detail")
    from .publication import configured_publication_content
    r["publication"] = configured_publication_content(root, cfg)
    r["raw_payload"] = {"detail_fields": raw}
    return r


def crawl(source, cfg, fixtures=None, checkpoint=None):
    validate_config(source, cfg)
    origin = "https://www.28hse.com" if source == "28hse" else cfg["origin"]
    paths = (
        [r"/agent/540", r"/(buy|rent)/[^/%]+/property-\d+/?"]
        if source == "28hse"
        else cfg["allowed_paths"]
    )
    fetch = Fetcher(origin, paths, fixtures, checkpoint=checkpoint)
    pages = []
    def save_page(evidence):
        pages.append(evidence)
        if checkpoint: checkpoint.page(evidence)
    accepted = {}
    rejected = []
    completed = []
    errors = []
    for scope in ["sale", "rent"] if source == "28hse" else BRANCHES:
        fingerprints = set()
        found = set()
        for page in range(1, cfg.get("max_pages", 100) + 1):
            evidence = {
                "scope": scope,
                "page": page,
                "status": "failed",
                "ids": [],
                "details_complete": False,
            }
            try:
                url = (
                    f'{origin}/agent/540?buyRent={"buy" if scope=="sale" else "rent"}&page={page}&plan_id=540&propertyDoSearchVersion=2.0'
                    if source == "28hse"
                    else cfg["branch_urls"][scope].format(page=page)
                )
                html = render_captured_html(fetch.get(url), cfg.get("renderer", "http"))
                rows, terminal, total = (
                    parse_28_index(html, scope)
                    if source == "28hse"
                    else parse_property_index(html, scope, cfg)
                )
                evidence["ids"] = sorted(set(r["property_id"] for r in rows))
                evidence["advertised_total"] = total
                if terminal:
                    evidence.update(status="terminal", details_complete=True, observed_distinct_total=len(found))
                    save_page(evidence)
                    completed.append(scope)
                    break
                signature = tuple(evidence["ids"])
                if signature in fingerprints:
                    raise WorkerError("pagination_loop")
                fingerprints.add(signature)
                found.update(evidence["ids"])
                for row in rows:
                    detail = render_captured_html(
                        fetch.get(row["source_url"]), cfg.get("renderer", "http")
                    )
                    try:
                        r = (
                            parse_28_detail(detail, row)
                            if source == "28hse"
                            else parse_property_detail(detail, row, cfg)
                        )
                    except WorkerError as error:
                        if str(error) != "invalid_number":
                            raise
                        rejection = {
                            "scope": scope,
                            "property_id": row["property_id"],
                            "reason": str(error),
                        }
                        if rejection not in rejected:
                            rejected.append(rejection)
                        continue
                    key = (
                        r["property_id"],
                        r["deal_type"],
                        (
                            scope
                            if source == "propertyhk" and cfg["id_scope"] == "branch"
                            else ""
                        ),
                    )
                    occurrence = {
                        "scope": scope,
                        "page": page,
                        "source_url": r["source_url"],
                    }
                    prior = accepted.get(key)
                    if prior:
                        ignore = {
                            "branch_code",
                            "branch_memberships",
                            "raw_payload",
                            "occurrences",
                            "raw_property_id",
                        }
                        if {k: v for k, v in prior.items() if k not in ignore} != {
                            k: v for k, v in r.items() if k not in ignore
                        }:
                            raise WorkerError("conflicting_duplicate")
                        prior["branch_memberships"] = [
                            b
                            for b in BRANCHES
                            if b
                            in prior.get("branch_memberships", [])
                            + r.get("branch_memberships", [])
                        ]
                        prior["occurrences"].append(occurrence)
                    else:
                        r["occurrences"] = [occurrence]
                        accepted[key] = r
                evidence.update(status="listings", details_complete=True)
                save_page(evidence)
            except WorkerError as e:
                evidence["status"] = (
                    "blocked"
                    if str(e) in ("blocked", "robots_disallowed")
                    else "parser_error"
                )
                save_page(evidence)
                errors.append({"scope": scope, "page": page, "reason": str(e)})
                break
        else:
            errors.append({"scope": scope, "reason": "page_ceiling"})
    now = (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    complete = len(completed) == (2 if source == "28hse" else 3) and not errors
    meta = {
        "schema_version": "2.0",
        "run_id": checkpoint.data["runId"] if checkpoint else str(uuid.uuid4()),
        "scope_id": "agent:540" if source == "28hse" else "branches:EPW,EPS,EPT",
        "policy_version": "no-hermes-v2",
        "parser_version": "python-v2.2" if source == "28hse" else "python-v2.0",
        "crawl_complete": complete,
        "pages_failed": sum(p["status"] not in ("listings", "terminal") for p in pages),
        "worker_rejected_count": len(rejected),
        "eligible_for_absence": complete and not rejected and source == "28hse",
        "completed_branches": completed if source == "propertyhk" else [],
        "pages": pages,
        "rejected_records": rejected,
    }
    return {
        "source": source,
        "branches": BRANCHES if source == "propertyhk" else [],
        "id_scope": cfg.get("id_scope") if source == "propertyhk" else None,
        "scraped_at": now,
        "listings": list(accepted.values()),
        "meta": meta,
    }, {"requests": fetch.evidence, "errors": errors}


def ad_keys(payload):
    return {
        (
            r["property_id"],
            r.get("branch_code") if payload.get("id_scope") == "branch" else "",
        )
        for r in payload["listings"]
        if r.get("property_id")
    }


def collection_page_proof(payload):
    expected = ['sale', 'rent'] if payload.get('source') == '28hse' else BRANCHES
    pages = payload.get('meta', {}).get('pages')
    if not isinstance(pages, list) or any(not isinstance(p, dict) or p.get('scope') not in expected for p in pages):
        return False
    for scope in expected:
        scoped = [p for p in pages if p.get('scope') == scope]
        if not scoped or [p.get('page') for p in scoped] != list(range(1, len(scoped)+1)):
            return False
        if scoped[-1].get('status') != 'terminal' or scoped[-1].get('ids') != []:
            return False
        seen = set()
        signatures = set()
        for page in scoped:
            ids = page.get('ids')
            if page.get('details_complete') is not True or not isinstance(ids, list) or any(not isinstance(x,str) for x in ids):
                return False
            if page is not scoped[-1]:
                if page.get('status') != 'listings' or not ids or tuple(sorted(set(ids))) in signatures:
                    return False
                signatures.add(tuple(sorted(set(ids))))
                seen.update(ids)
        rows = {r.get('property_id') for r in payload.get('listings',[]) if
                (r.get('deal_type') == scope if payload.get('source') == '28hse' else
                 scope in r.get('branch_memberships',[r.get('branch_code')]))}
        rejected = {r.get('property_id') for r in payload.get('meta',{}).get('rejected_records',[]) if r.get('scope') == scope}
        if seen != rows | rejected:
            return False
    return True


def gate(payload, baseline):
    reasons = []
    m = payload["meta"]
    count = len(ad_keys(payload))
    if payload.get("source") == "propertyhk" and (not collection_page_proof(payload) or m.get("worker_rejected_count",0)):
        reasons.append("incomplete_branch_evidence")
    if not m.get("crawl_complete") or m.get("pages_failed", 0):
        reasons.append("incomplete_crawl")
    if not count:
        reasons.append("zero_inventory_requires_review")
    if baseline:
        if (
            baseline["meta"]["scope_id"] != m["scope_id"]
            or baseline["source"] != payload["source"]
            or baseline["meta"]["parser_version"] != m["parser_version"]
            or baseline["meta"].get("policy_version") != m.get("policy_version")
            or (
                payload["source"] == "propertyhk"
                and baseline.get("id_scope") != payload.get("id_scope")
            )
        ):
            reasons.append("baseline_scope_mismatch")
        previous = len(ad_keys(baseline))
        if count * 10 < previous * 7:
            reasons.append("count_drop_exceeds_30_percent")
        if payload["source"] == "propertyhk":
            for branch in BRANCHES:
                prior_count = len(
                    {
                        r["property_id"]
                        for r in baseline["listings"]
                        if branch in r.get("branch_memberships", [r.get("branch_code")])
                    }
                )
                current_count = len(
                    {
                        r["property_id"]
                        for r in payload["listings"]
                        if branch in r.get("branch_memberships", [r.get("branch_code")])
                    }
                )
                if current_count * 10 < prior_count * 7:
                    reasons.append("branch_count_drop_" + branch)
    return {
        "allowed": not reasons,
        "full": not reasons and not m.get("worker_rejected_count", 0),
        "reasons": reasons,
        "valid_unique_count": count,
    }


def diff(old, new):
    def keyed(rows):
        return {
            (clean_id(r["property_id"], "28hse"), r.get("deal_type", "sale")): r
            for r in rows
        }

    a, b = keyed(old), keyed(new)
    out = []
    for key in sorted(a.keys() | b.keys()):
        changes = {
            f: {"old": a.get(key, {}).get(f), "new": b.get(key, {}).get(f)}
            for f in FIELDS
            if a.get(key, {}).get(f) != b.get(key, {}).get(f)
        }
        kind = (
            "new"
            if key not in a
            else "delisted" if key not in b else "changed" if changes else "unchanged"
        )
        out.append(
            {
                "property_id": key[0],
                "deal_type": key[1],
                "change_type": kind,
                "changes": changes,
            }
        )
    return out


@contextmanager
def scope_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise WorkerError("scope_locked")
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally:
        path.unlink()


def frozen(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def write_csv(path, rows):
    columns = sorted({k for r in rows for k in r}) or ["property_id", "deal_type"]
    with path.open("x", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(
            {
                k: (
                    json.dumps(v, ensure_ascii=False)
                    if isinstance(v, (dict, list))
                    else v
                )
                for k, v in r.items()
            }
            for r in rows
        )


def save_snapshot(root, payload, evidence=None):
    m = payload["meta"]
    scope = re.sub(r"[^A-Za-z0-9_-]", "-", m["scope_id"])
    path = (
        root
        / "snapshots"
        / payload["source"]
        / scope
        / payload["scraped_at"][:10]
        / m["run_id"]
    )
    path.mkdir(parents=True, exist_ok=False)
    write_csv(path / "listings.csv", payload["listings"])
    (path / "records.jsonl").write_bytes(
        b"".join(frozen(r) + b"\n" for r in payload["listings"])
    )
    (path / "manifest.json").write_bytes(
        frozen(
            {
                **m,
                "source": payload["source"],
                "scraped_at": payload["scraped_at"],
                "valid_unique_count": len(ad_keys(payload)),
            }
        )
    )
    (path / "request.json").write_bytes(frozen(payload))
    if evidence is not None:
        (path / "raw-evidence.json").write_bytes(frozen(evidence))
    return path


def submit(data, url, secret, origins, transport=http_request, sleep=time.sleep):
    if not secret:
        raise WorkerError("missing_sync_secret")
    p = urlsplit(url)
    origin = f"{p.scheme}://{p.netloc}"
    if origin not in origins:
        raise WorkerError("unapproved_sync_origin")
    checked_url(url, origin)
    for attempt in range(3):
        try:
            status, headers, raw = transport(url, data, secret)
        except (TimeoutError, URLError, OSError):
            status, headers, raw = 0, {}, b"{}"
        if status == 200:
            try:
                result = json.loads(raw)
            except (ValueError, UnicodeError):
                return {
                    "success": False,
                    "status": "invalid_receipt",
                    "http_status": 200,
                }
            return {**result, "http_status": status, "attempts": attempt + 1}
        if status not in (0, 408, 429) and not 500 <= status < 600 or attempt == 2:
            return {
                "success": False,
                "status": "submission_failed",
                "http_status": status,
                "attempts": attempt + 1,
            }
        delay = 2 ** (attempt + 1)
        if status == 429:
            retry = next(
                (v for k, v in headers.items() if k.lower() == "retry-after"), None
            )
            if retry:
                try:
                    delay = max(delay, float(retry))
                except ValueError:
                    try:
                        delay = max(
                            delay,
                            (
                                parsedate_to_datetime(retry)
                                - datetime.now(timezone.utc)
                            ).total_seconds(),
                        )
                    except (ValueError, TypeError):
                        return {
                            "success": False,
                            "status": "invalid_retry_after",
                            "http_status": 429,
                        }
            if delay > 300:
                return {
                    "success": False,
                    "status": "retry_after_deferred",
                    "http_status": 429,
                }
        sleep(delay)


def synthetic_fixture(source):
    """Explicitly synthetic URLs/selectors: never used for live configuration."""
    if source == "28hse":
        cfg = {"max_pages": 3}
        fixtures = {
            "https://www.28hse.com/robots.txt": {"html": "User-agent: *\nAllow: /"}
        }
        for deal, path in [("sale", "buy"), ("rent", "rent")]:
            base = f"https://www.28hse.com/agent/540?buyRent={path}&page={{page}}&plan_id=540&propertyDoSearchVersion=2.0"
            label = "放售樓盤" if deal == "sale" else "放租樓盤"
            ident = "100" if deal == "sale" else "200"
            head = f"<h1>晉誠地產</h1><p>C-018613</p><p>共有 1 個{label}</p>"
            fixtures[base.format(page=1)] = {
                "html": head
                + f'<a href="/{path}/apartment/property-{ident}">晉誠地產 Synthetic title</a>'
            }
            fixtures[base.format(page=2)] = {"html": head + "<p>沒有找到任何資料</p>"}
            field = "售價" if deal == "sale" else "租金"
            fixtures[f"https://www.28hse.com/{path}/apartment/property-{ident}"] = {
                "html": f"<main data-listing-detail><table><tr><td>{field}</td><td>$538萬</td></tr><tr><td>地址</td><td>測試區</td></tr><tr><td>間隔</td><td>開放式</td></tr></table></main>"
            }
    else:
        cfg = {
            "origin": "https://www.property.hk",
            "max_pages": 3,
            "id_scope": "global",
            "id_scope_verified": True,
            "company_name": "SYNTHETIC COMPANY",
            "company_license": "SYNTHETIC-LICENSE",
            "allowed_paths": ["/(EPW|EPS|EPT)", "/detail/[0-9]+"],
            "branch_urls": {
                b: "https://www.property.hk/" + b + "?page={page}" for b in BRANCHES
            },
            "deal_type": "sale",
            "selectors": {
                "container": "main",
                "card": "article",
                "id": ".id",
                "link": "a",
                "title": "a",
                "empty": ".empty",
                "detail_container": "main",
                "fields": {
                    "price": ".price",
                    "agent_name": ".agent",
                    "agent_phone": ".phone",
                    "agent_license": ".license",
                },
            },
        }
        fixtures = {
            "https://www.property.hk/robots.txt": {"html": "User-agent: *\nAllow: /"},
            "https://www.property.hk/detail/100": {
                "html": '<main><p class="price">538萬</p><p class="agent">Synthetic Agent</p><p class="phone">+852 00000000</p><p class="license">TEST-1</p></main>'
            },
        }
        for b in BRANCHES:
            head = "<main>SYNTHETIC COMPANY SYNTHETIC-LICENSE"
            fixtures[cfg["branch_urls"][b].format(page=1)] = {
                "html": head
                + '<article><span class="id">100</span><a href="/detail/100">Synthetic title</a></article></main>'
            }
            fixtures[cfg["branch_urls"][b].format(page=2)] = {
                "html": head + '<p class="empty">No records</p></main>'
            }
    return cfg, fixtures


def receipt_is_full(receipt):
    return (
        receipt.get("success") is True
        and receipt.get("status") == "success"
        and receipt.get("full_snapshot") is True
        and bool(receipt.get("receipt_id"))
    )


def run(source, cfg, root, dry_run=False, fixtures=None, synthetic=False):
    if synthetic:
        if not dry_run:
            raise WorkerError("synthetic_requires_dry_run")
        cfg, fixtures = synthetic_fixture(source)
    validate_config(source, cfg)
    scope = "agent-540" if source == "28hse" else "EPW-EPS-EPT"
    with scope_lock(root / "locks" / f"{source}-{scope}.lock"):
        baseline_path = root / "baselines" / source / scope / "baseline.json"
        baseline = (
            json.loads(baseline_path.read_bytes()) if baseline_path.exists() else None
        )
        from scraping.checkpoint import Checkpoint
        run_id = str(uuid.uuid4())
        checkpoint = Checkpoint(root / "checkpoints" / source / scope / run_id, source=source, scope="agent:540" if source == "28hse" else "branches:EPW,EPS,EPT", run_id=run_id)
        payload, evidence = crawl(source, cfg, fixtures, checkpoint=checkpoint)
        if source == "propertyhk":
            payload["id_scope"] = cfg["id_scope"]
        decision = gate(payload, baseline)
        path = save_snapshot(root, payload, evidence)
        (path / "gate.json").write_bytes(frozen(decision))
        checkpoint.finish(decision)
        if source == "28hse":
            changes = diff(
                baseline["listings"] if baseline else [], payload["listings"]
            )
            if not decision["full"]:
                changes = [r for r in changes if r["change_type"] != "delisted"]
            report = (
                root
                / "diff_report"
                / "28hse"
                / payload["scraped_at"][:10]
                / payload["meta"]["run_id"]
            )
            report.mkdir(parents=True)
            write_csv(report / "changes.csv", changes)
        if not decision["allowed"]:
            return {
                "success": False,
                "status": "rejected_incomplete",
                "snapshot": str(path),
                "reasons": decision["reasons"],
            }
        if dry_run:
            return {
                "success": True,
                "status": "dry_run",
                "snapshot": str(path),
                "baseline_advanced": False,
            }
        if source == "28hse":
            receipt = replay_bridge(path / "request.json", path, cfg.get("publishEnabled") is True)
        else:
            receipt = submit(
                (path / "request.json").read_bytes(),
                os.environ.get("PROPERTYHK_SYNC_URL", ""),
                os.environ.get("PROPERTYHK_SYNC_SECRET", ""),
                cfg.get("sync_allowed_origins", []),
            )
        (path / "receipt.json").write_bytes(frozen(receipt))
        advance = decision["full"] and advance_baseline(baseline_path, payload, receipt)
        return {
            "success": receipt.get("success") is True,
            "status": receipt.get("status", "failed"),
            "snapshot": str(path),
            "baseline_advanced": advance,
        }


def cli(source, crawl_only=False):
    import argparse

    parser = argparse.ArgumentParser(
        description="Deterministic property snapshot worker"
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config/sources.example.json",
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[1] / "output"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--synthetic-fixture", action="store_true")
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        cfg = config["sources"][source]
        fixtures = (
            json.loads(args.fixtures.read_text(encoding="utf-8-sig"))
            if args.fixtures
            else None
        )
        result = run(
            source,
            cfg,
            args.root,
            args.dry_run or crawl_only,
            fixtures,
            args.synthetic_fixture,
        )
        if args.output and result.get("snapshot"):
            import shutil

            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("xb") as out:
                out.write((Path(result["snapshot"]) / "listings.csv").read_bytes())
        print(json.dumps(result))
        return 0 if result["success"] else 1
    except (WorkerError, OSError, ValueError, subprocess.TimeoutExpired) as e:
        print(
            json.dumps(
                {
                    "success": False,
                    "status": "worker_failed",
                    "error": str(e) if isinstance(e, WorkerError) else type(e).__name__,
                }
            )
        )
        return 1


def render_captured_html(html, engine="http"):
    """Optional Crawl4AI browser pass over policy-fetched HTML; all network blocked.

    This deliberately does not execute source JavaScript or bypass access controls.
    It is useful for browser HTML serialization; live dynamic rendering requires a
    separately reviewed network policy and is not enabled by this adapter.
    """
    if engine == "http":
        return html
    if engine != "crawl4ai":
        raise WorkerError("unsupported_renderer")
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except ImportError:
        raise WorkerError("crawl4ai_not_installed")
    import asyncio

    async def render():
        async def block_network(page, context, **kwargs):
            await context.route("**/*", lambda route: route.abort())
            return page

        async with AsyncWebCrawler(
            config=BrowserConfig(
                headless=True,
                java_script_enabled=False,
                ignore_https_errors=False,
                user_agent="EarnestPropertyBot/2.0",
            )
        ) as crawler:
            crawler.crawler_strategy.set_hook("on_page_context_created", block_network)
            result = await crawler.arun(
                url="raw:" + html,
                config=CrawlerRunConfig(
                    cache_mode=CacheMode.BYPASS,
                    page_timeout=30000,
                    word_count_threshold=0,
                ),
            )
            if not result.success or not result.html:
                raise WorkerError("browser_render_failed")
            return result.html

    try:
        return asyncio.run(render())
    except WorkerError:
        raise
    except Exception:
        raise WorkerError("browser_render_failed") from None


def robots_path(value, pattern=False):
    """RFC9309 octet normalization, shared with the repository JS access policy."""
    normalized = ""
    specificity = 0
    index = 0
    while index < len(value):
        char = value[index]
        if char == "%":
            pair = value[index + 1 : index + 3]
            if not re.fullmatch("[0-9a-fA-F]{2}", pair):
                raise WorkerError("malformed_robots_path")
            decoded = chr(int(pair, 16))
            normalized += (
                decoded
                if re.fullmatch("[A-Za-z0-9._~-]", decoded)
                else "%" + pair.upper()
            )
            specificity += 1
            index += 3
            continue
        if pattern and (char == "*" or char == "$" and index == len(value) - 1):
            normalized += char
        elif ord(char) < 32 or ord(char) == 127:
            raise WorkerError("malformed_robots_path")
        elif ord(char) > 127 or char in "*$":
            octets = char.encode("utf8")
            normalized += "".join("%%%02X" % b for b in octets)
            specificity += len(octets)
        else:
            normalized += char
            specificity += 1
        index += 1
    return normalized, specificity


def advance_baseline(path, payload, receipt):
    """Caller holds the scope lock. An old replay must not regress a newer baseline."""
    if not receipt_is_full(receipt):
        return False
    previous = json.loads(path.read_bytes()) if path.exists() else None
    if previous and payload["scraped_at"] <= previous["scraped_at"]:
        return False
    if not gate(payload, previous)["full"]:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(frozen(payload))
    os.replace(temporary, path)
    return True



def replay_bridge(payload_path, evidence_path, apply=False, sleep=time.sleep):
    """Retry the exact frozen artifact, including outcome-unknown commits."""
    repo = Path(__file__).resolve().parents[3]
    original = payload_path.read_bytes()
    attempts = evidence_path / "attempts"
    attempts.mkdir(exist_ok=False)
    command = ["node", str(repo / "scripts/mls/apply-source-snapshot.mjs"), "--payload", str(payload_path.resolve())]
    if apply:
        command.append("--apply")
    for attempt in range(3):
        if payload_path.read_bytes() != original:
            raise WorkerError("frozen_payload_changed")
        try:
            process = subprocess.run(command, cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=900 if apply else 180)
            try:
                receipt = json.loads(process.stdout if process.returncode == 0 else process.stderr)
                if not isinstance(receipt, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                receipt = {"success": False, "status": "invalid_bridge_receipt"}
        except subprocess.TimeoutExpired:
            receipt = {"success": False, "error": "OUTCOME_UNKNOWN", "status": 503}
        except OSError:
            receipt = {"success": False, "error": "bridge_unavailable", "status": 503}
        (attempts / f"{attempt + 1}.json").write_bytes(frozen(receipt))
        status = receipt.get("status")
        if receipt.get("success") is True or status not in (408, 429, 500, 502, 503, 504) or attempt == 2:
            return receipt
        delay = 2 ** (attempt + 1)
        retry = receipt.get("retryAfter")
        if retry is not None:
            try:
                delay = max(delay, float(retry))
                if not 0 <= float(retry) <= 300:
                    return receipt
            except (ValueError, TypeError):
                return receipt
        sleep(delay)
    return receipt


def replay_28hse(payload_path, root, apply=False, sleep=time.sleep):
    """Replay without recollection or rewriting the original payload/receipts."""
    payload_path, root = Path(payload_path), Path(root)
    with payload_path.open("rb") as stream:
        data = stream.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise WorkerError("payload_too_large")
    payload = json.loads(data)
    if payload.get("source") != "28hse" or payload.get("meta", {}).get("scope_id") != "agent:540":
        raise WorkerError("replay_scope_mismatch")
    with scope_lock(root / "locks" / "28hse-agent-540.lock"):
        path = root / "replays" / str(uuid.uuid4())
        path.mkdir(parents=True, exist_ok=False)
        (path / "request.json").write_bytes(data)
        (path / "replay.json").write_bytes(frozen({"payload_sha256": hashlib.sha256(data).hexdigest(), "replayed_at": datetime.now(timezone.utc).isoformat(), "apply": apply}))
        receipt = replay_bridge(path / "request.json", path, apply, sleep)
        (path / "receipt.json").write_bytes(frozen(receipt))
        baseline = root / "baselines" / "28hse" / "agent-540" / "baseline.json"
        advance = apply and advance_baseline(baseline, payload, receipt)
        return {"success": receipt.get("success") is True, "status": receipt.get("status", "failed"), "error": receipt.get("error"), "snapshot": str(path), "receipt_path": str(path / "receipt.json"), "baseline_advanced": advance}

