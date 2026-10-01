"""Offline private Property.hk index evidence verification. Never imports into DB."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from scraping.worker import WorkerError, checked_url, inspect_property_agent_index

LICENSES = {"EPS": "C-018613-A000", "EPT": "C-018613-A003", "EPW": "C-018613-A005"}

def verify_evidence(manifest, entries, root):
    root = Path(root).resolve()
    approved = {}
    for name, url in entries.items():
        checked_url(url, "https://www.property.hk", [r"/agent\.php"])
        q = parse_qs(urlsplit(url).query, keep_blank_values=True)
        if any(len(v) != 1 for v in q.values()) or not all(q.get(k) for k in ("agent", "dt", "sid")):
            raise WorkerError("entry_identity")
        branch, district, sid = (q[k][0] for k in ("agent", "dt", "sid"))
        if branch not in LICENSES or name != branch + "-" + district or q.get("p", ["1"]) != ["1"]:
            raise WorkerError("entry_identity")
        approved[name] = (branch, district, sid)
    if not approved:
        raise WorkerError("missing_entries")
    pages = {name: {} for name in approved}
    blocked, seen = [], {}
    for item in manifest:
        url = item["url"]
        checked_url(url, "https://www.property.hk", [r"/robots\.txt", r"/agent\.php", r"/asking_detail/\d+\.html"])
        expected_name = hashlib.sha256(url.encode()).hexdigest() + ".raw"
        path = (root / item["file"]).resolve()
        if item["file"] != expected_name or path.parent != root:
            raise WorkerError("evidence_path")
        if path.stat().st_size > 2 * 1024 * 1024:
            raise WorkerError("evidence_size")
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if len(raw) != item["bytes"] or digest != item["sha256"]:
            raise WorkerError("evidence_hash")
        if url in seen:
            if seen[url] != (digest, item["status"]):
                raise WorkerError("conflicting_evidence")
            continue
        seen[url] = (digest, item["status"])
        parts = urlsplit(url)
        if item["status"] != 200:
            blocked.append({"path": parts.path, "status": item["status"], "sha256": digest})
            continue
        if parts.path != "/agent.php":
            continue
        q = parse_qs(parts.query, keep_blank_values=True)
        if any(len(v) != 1 for v in q.values()) or not all(q.get(k) for k in ("agent", "dt", "sid")):
            raise WorkerError("entry_identity")
        branch, district, sid = (q[k][0] for k in ("agent", "dt", "sid"))
        name = branch + "-" + district
        if approved.get(name) != (branch, district, sid):
            raise WorkerError("entry_identity")
        page = inspect_property_agent_index(raw.decode("utf-8"), url, expected_license=LICENSES[branch])
        if page["page"] in pages[name]:
            raise WorkerError("duplicate_index_page")
        pages[name][page["page"]] = page
    result = {"entries": {}, "blocked_responses": blocked, "full_snapshot": False,
              "eligible_for_absence": False, "details_verified": False,
              "id_scope_verified": False, "full_branch_scope_verified": False,
              "production_writes": 0}
    for name, index in pages.items():
        ordered = [index[p] for p in sorted(index)]
        if (not ordered or sorted(index) != list(range(1, ordered[0]["listed_pages"] + 1))
                or any(p["listed_pages"] != len(ordered) for p in ordered)
                or not ordered[-1]["is_last_listed_page"]):
            raise WorkerError("incomplete_index_pages")
        ids = [set(r["property_id"] for r in p["listings"]) for p in ordered]
        if len(set.union(*ids)) != sum(map(len, ids)):
            raise WorkerError("repeated_index_advertisement")
        result["entries"][name] = {
            "index_pages": len(ordered), "advertisements": sum(map(len, ids)),
            "offers": sum(len(p["listings"]) for p in ordered),
            "complete_index_pages": True,
        }
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--entries", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    result = verify_evidence(json.loads(args.manifest.read_text(encoding="utf-8")),
                             json.loads(args.entries.read_text(encoding="utf-8")), args.manifest.parent)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
