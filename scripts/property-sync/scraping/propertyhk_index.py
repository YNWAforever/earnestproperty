"""Collect approved native agent.php indexes without granting ingestion authority."""
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
import uuid

from .worker import Fetcher, WorkerError, checked_url, inspect_property_agent_index

ORIGIN = "https://www.property.hk"
LICENSES = {"EPS": "C-018613-A000", "EPT": "C-018613-A003", "EPW": "C-018613-A005"}
FILTERS = {"hqid", "val", "prop", "select"}
FIELDS = ["run_id", "observed_at", "observed_page", "page_sha256", "branch_code",
          "district_filter", "property_id", "raw_property_id", "deal_type", "title",
          "source_url", "district", "floor", "gross_area", "saleable_area", "price",
          "rent", "source_updated_date", "observation_kind"]


def approved_entries(entries):
    if not isinstance(entries, dict) or not entries or len(entries) > 30:
        raise WorkerError("missing_entries")
    approved = {}
    for name, url in entries.items():
        if not isinstance(url, str):
            raise WorkerError("entry_identity")
        checked_url(url, ORIGIN, [r"/agent\.php"])
        q = parse_qs(urlsplit(url).query, keep_blank_values=True)
        if (any(len(v) != 1 for v in q.values())
                or set(q) - ({"agent", "dt", "sid", "p"} | FILTERS)):
            raise WorkerError("entry_identity")
        branch, district, sid = (q.get(k, [""])[0] for k in ("agent", "dt", "sid"))
        if (branch not in LICENSES or not re.fullmatch(r"[A-Z][A-Z0-9_-]{0,15}", district)
                or not sid or len(sid) > 1024 or re.search(r"[\x00-\x20\x7f]", sid)
                or name != branch + "-" + district or q.get("p", ["1"]) != ["1"]):
            raise WorkerError("entry_identity")
        approved[name] = (branch, district, sid)
    return approved


def write_json(path, value):
    with path.open("x", encoding="utf-8") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")


class Capture:
    """Persist exact response bytes before decoding, including failed attempts."""
    def __init__(self, root):
        self.root = root
        (root / "responses").mkdir()
        self.responses = []

    def response(self, url, status, attempt, body):
        filename = f"responses/{len(self.responses) + 1:06d}.raw"
        with (self.root / filename).open("xb") as out:
            out.write(body)
        item = {"url": url, "status": status, "attempt": attempt, "file": filename,
                "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        self.responses.append(item)
        with (self.root / "responses.jsonl").open("a", encoding="utf-8") as out:
            out.write(json.dumps(item) + "\n")
        # Index redirects must not silently change the approved search filters.
        if 300 <= status < 400:
            raise WorkerError("index_redirect")

    def finish(self):
        write_json(self.root / "response-manifest.json", self.responses)
        latest = {item["url"]: item for item in self.responses}
        manifest = []
        for url, item in latest.items():
            filename = hashlib.sha256(url.encode()).hexdigest() + ".raw"
            with (self.root / filename).open("xb") as out:
                out.write((self.root / item["file"]).read_bytes())
            manifest.append({**item, "file": filename})
        write_json(self.root / "capture-manifest.json", manifest)


def collect_indexes(entries, root, *, fixtures=None, max_pages=100):
    approved = approved_entries(entries)
    if not isinstance(max_pages, int) or not 1 <= max_pages <= 100:
        raise WorkerError("page_limit")
    run_id = str(uuid.uuid4())
    started = datetime.now(timezone.utc).isoformat()
    run = Path(root).resolve() / "index-observations" / run_id
    run.mkdir(parents=True)
    # Source HTML and entry URLs contain contact data/SIDs and stay private.
    (run / ".gitignore").write_text("*\n", encoding="utf-8")
    capture = Capture(run)
    fetcher = Fetcher(ORIGIN, [r"/agent\.php"], fixtures=fixtures, checkpoint=capture)
    result = {"success": False, "status": "index_failed", "collection": str(run),
              "run_id": run_id, "observed_at": started,
              "collection_mode": "fixture" if fixtures is not None else "public_http",
              "entries": {}, "full_snapshot": False, "details_verified": False,
              "id_scope_verified": False, "full_branch_scope_verified": False,
              "eligible_for_absence": False, "publish_allowed": False,
              "baseline_advanced": False, "production_writes": 0,
              "sync_status": "blocked_detail_verification"}
    stopped = False
    with (run / "observations.jsonl").open("x", encoding="utf-8") as jsonl, \
            (run / "unclassified-advertisements.jsonl").open("x", encoding="utf-8") as unknown_out, \
            (run / "observations.csv").open("x", encoding="utf-8-sig", newline="") as csvout:
        writer = csv.DictWriter(csvout, fieldnames=FIELDS)
        writer.writeheader()
        for name, (branch, district, sid) in approved.items():
            summary = {"index_pages": 0, "listed_pages": None, "advertisements": 0,
                       "offers": 0, "unclassified_advertisements": 0,
                       "complete_index_pages": False, "error": None}
            result["entries"][name] = summary
            if stopped:
                summary["error"] = "source_stopped"
                continue
            url, seen = entries[name], set()
            try:
                for number in range(1, max_pages + 1):
                    html = fetcher.get(url)
                    page = inspect_property_agent_index(html, url, expected_license=LICENSES[branch])
                    if page["page"] != number:
                        raise WorkerError("pagination_identity")
                    if summary["listed_pages"] is not None and page["listed_pages"] != summary["listed_pages"]:
                        raise WorkerError("pagination_count_changed")
                    unknown = page["unclassified_advertisements"]
                    ids = {row["property_id"] for row in page["listings"] + unknown}
                    if seen & ids:
                        raise WorkerError("repeated_index_advertisement")
                    seen.update(ids)
                    summary["index_pages"] += 1
                    summary["listed_pages"] = page["listed_pages"]
                    summary["advertisements"] += len(ids)
                    summary["offers"] += len(page["listings"])
                    summary["unclassified_advertisements"] += len(unknown)
                    digest = capture.responses[-1]["sha256"]
                    for listing in page["listings"]:
                        row = {**listing, "run_id": run_id, "observed_at": started,
                               "observed_page": number, "page_sha256": digest}
                        jsonl.write(json.dumps(row, ensure_ascii=False) + "\n")
                        writer.writerow(row)
                    for listing in unknown:
                        row = {**listing, "run_id": run_id, "observed_at": started,
                               "observed_page": number, "page_sha256": digest}
                        unknown_out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    jsonl.flush()
                    unknown_out.flush()
                    csvout.flush()
                    if page["is_last_listed_page"]:
                        summary["complete_index_pages"] = True
                        break
                    url = page["next_url"]
                if not summary["complete_index_pages"]:
                    raise WorkerError("page_limit")
            except (WorkerError, OSError, ValueError) as error:
                summary["error"] = str(error) if isinstance(error, WorkerError) else type(error).__name__
                stopped = summary["error"] in {
                    "blocked", "robots_disallowed", "malformed_robots", "network_failed",
                    "http_failed", "index_redirect", "response_too_large"}
    capture.finish()
    result["source_calls"] = len(capture.responses)
    result["success"] = all(item["complete_index_pages"] for item in result["entries"].values())
    result["status"] = ("index_complete" if result["success"] else "index_partial"
                        if any(item["index_pages"] for item in result["entries"].values()) else "index_failed")
    result["artifacts"] = {name: hashlib.sha256((run / name).read_bytes()).hexdigest()
                           for name in ("observations.csv", "observations.jsonl", "unclassified-advertisements.jsonl", "capture-manifest.json",
                                        "response-manifest.json")}
    write_json(run / "report.json", result)
    return result
