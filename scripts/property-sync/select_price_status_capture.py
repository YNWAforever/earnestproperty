"""Read existing private release evidence only; never collect source pages or contact Neon."""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from daily_artifacts import (evidence_identity, restore_baseline, unpack_baseline,
                             verify_manifest, file_evidence)
from scraping.worker import collection_page_proof


def complete(data):
    try:
        source, meta = evidence_identity(data)
        return (source == "28hse" and meta.get("crawl_complete") is True
                and meta.get("pages_failed") == 0 and meta.get("worker_rejected_count") == 0
                and meta.get("eligible_for_absence") is True and collection_page_proof(data))
    except (ValueError, KeyError, TypeError):
        return False


def newest_complete(candidates):
    eligible = [(datetime.fromisoformat(data["scraped_at"].replace("Z", "+00:00")),
                 name, data) for name, data in candidates if complete(data)]
    if not eligible:
        raise ValueError("no_complete_capture")
    newest = max(item[0] for item in eligible)
    peers = [item for item in eligible if item[0] == newest]
    if len({hashlib.sha256(json.dumps(p[2], sort_keys=True).encode()).hexdigest() for p in peers}) > 1:
        raise ValueError("conflicting_capture_timestamp")
    return max(peers, key=lambda item: item[1])[1:]


def gh(*args):
    result = subprocess.run(["gh", *args], capture_output=True, check=False)
    if result.returncode:
        raise ValueError("evidence_access_failed")
    return result.stdout


def select_existing(repository, output):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("invalid_repository")
    if json.loads(gh("api", "repos/" + repository)).get("private") is not True:
        raise ValueError("evidence_repository_must_be_private")
    # gh release view includes the whole release's existing asset list.
    assets = json.loads(gh("release", "view", "property-sync-evidence", "--repo", repository, "--json", "assets"))["assets"]
    with tempfile.TemporaryDirectory(prefix="price-status-evidence-") as temporary:
        root = Path(temporary)
        candidates, manifests = [], {}

        def download(name, destination):
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", name):
                raise ValueError("invalid_asset_name")
            destination.mkdir(parents=True, exist_ok=True)
            gh("release", "download", "property-sync-evidence", "--repo", repository,
               "--pattern", name, "--dir", str(destination))
            return destination / name

        for asset in assets:
            name = asset["name"]
            if re.fullmatch(r"handoff-\d+-\d+\.json", name):
                folder = root / name.removesuffix(".json")
                path = download(name, folder)
                manifest = json.loads(path.read_bytes())
                if manifest.get("source") != "28hse" or manifest.get("gate") != {"allowed": True, "full": True, "reasons": []}:
                    continue
                proof = manifest.get("request", {})
                request = download(proof.get("key", ""), folder)
                if file_evidence(request, 5 * 1024 * 1024) != proof:
                    raise ValueError("evidence_hash_mismatch")
                data = json.loads(request.read_bytes())
                candidates.append((name, data))
                manifests[name] = (path, folder, manifest)
            elif name.startswith("accepted-") and not name.startswith("accepted-propertyhk-"):
                folder = root / name.removesuffix(".tar.gz")
                path = download(name, folder)
                unpack_baseline(path, folder)
                restore_baseline(folder / "baseline", folder / "restore")
                candidates.append((name, json.loads((folder / "baseline/request.json").read_bytes())))
        name, data = newest_complete(candidates)
        if name in manifests:
            path, folder, manifest = manifests[name]
            download(manifest["raw"]["key"], folder)
            verify_manifest(path, folder, source="28hse", scope="agent:540")
        # Re-serialize only after verification; retain the original capture clock.
        output.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        select_existing(args.repository, args.out)
    except Exception:
        # Never echo private URLs, raw payload, credentials or subprocess stderr.
        parser.exit(2, "price_status_capture_selection_failed\n")
