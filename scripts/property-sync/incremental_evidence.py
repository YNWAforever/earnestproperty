"""Immutable private evidence for 28Hse index deltas; no database authority here."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile

FILES = {
    "request.json": 8 * 1024 * 1024,
    "report.json": 2 * 1024 * 1024,
    "evidence.json": 256 * 1024 * 1024,
    "cache-next.json": 16 * 1024 * 1024,
}
MANIFEST_LIMIT = 16 * 1024


def proof(path, limit):
    if not path.is_file() or path.is_symlink() or not 0 < path.stat().st_size <= limit:
        raise ValueError("INCREMENTAL_EVIDENCE_SIZE_INVALID")
    digest = hashlib.sha256()
    with path.open("rb") as content:
        for chunk in iter(lambda: content.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"sha256": digest.hexdigest(), "bytes": path.stat().st_size}


def verify(directory):
    directory = Path(directory)
    path = directory / "manifest.json"
    proof(path, MANIFEST_LIMIT)
    manifest = json.loads(path.read_bytes())
    if (manifest.get("kind") != "28hse-incremental-v1"
            or manifest.get("source") != "28hse"
            or manifest.get("scope") != "agent:540"
            or not re.fullmatch(r"[a-f0-9]{40}", manifest.get("git_sha", ""))
            or set(manifest.get("files", {})) != set(FILES)):
        raise ValueError("INCREMENTAL_MANIFEST_INVALID")
    for name, ceiling in FILES.items():
        if proof(directory / name, ceiling) != manifest["files"][name]:
            raise ValueError("INCREMENTAL_EVIDENCE_HASH_MISMATCH")
    request = json.loads((directory / "request.json").read_bytes())
    if (request.get("source") != "28hse"
            or request.get("meta", {}).get("scope_id") != "agent:540"
            or request.get("meta", {}).get("incremental", {}).get("mode") != "index-delta-v1"
            or request.get("scraped_at") != manifest.get("scraped_at")):
        raise ValueError("INCREMENTAL_EVIDENCE_IDENTITY_MISMATCH")
    return manifest


def pack(directory, archive, git_sha):
    directory, archive = Path(directory), Path(archive)
    if not re.fullmatch(r"[a-f0-9]{40}", git_sha):
        raise ValueError("INCREMENTAL_GIT_SHA_INVALID")
    request = json.loads((directory / "request.json").read_bytes())
    manifest = {
        "kind": "28hse-incremental-v1", "source": "28hse", "scope": "agent:540",
        "git_sha": git_sha, "scraped_at": request.get("scraped_at"),
        "files": {name: proof(directory / name, ceiling) for name, ceiling in FILES.items()},
    }
    manifest_path = directory / "manifest.json"
    with manifest_path.open("x", encoding="utf-8") as content:
        json.dump(manifest, content, ensure_ascii=False, sort_keys=True)
    verify(directory)
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("xb") as target, tarfile.open(fileobj=target, mode="w:gz") as bundle:
        for name in [*FILES, "manifest.json"]:
            bundle.add(directory / name, arcname=name, recursive=False)
    return manifest


def unpack(archive, destination):
    destination = Path(destination)
    allowed = {**FILES, "manifest.json": MANIFEST_LIMIT}
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        if (len(members) != len(allowed) or {item.name for item in members} != set(allowed)
                or any(not item.isfile() or not 0 < item.size <= allowed[item.name]
                       for item in members)):
            raise ValueError("INCREMENTAL_ARCHIVE_INVALID")
        # Reject links, duplicates, paths and oversized files before opening any output.
        destination.mkdir(parents=True, exist_ok=True)
        for item in members:
            with source.extractfile(item) as content, (destination / item.name).open("xb") as out:
                remaining = item.size
                while remaining:
                    chunk = content.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("INCREMENTAL_ARCHIVE_TRUNCATED")
                    out.write(chunk)
                    remaining -= len(chunk)
    return verify(destination)


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pack", "unpack", "verify"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--git-sha")
    args = parser.parse_args()
    try:
        if args.command == "pack":
            if not args.archive or not args.git_sha:
                raise ValueError("INCREMENTAL_ARGUMENTS_INVALID")
            result = pack(args.directory, args.archive, args.git_sha)
        elif args.command == "unpack":
            if not args.archive:
                raise ValueError("INCREMENTAL_ARGUMENTS_INVALID")
            result = unpack(args.archive, args.directory)
        else:
            result = verify(args.directory)
        print(json.dumps({"success": True, "kind": result["kind"]}))
        return 0
    except (ValueError, OSError, tarfile.TarError, KeyError) as error:
        code = str(error) if re.fullmatch(r"[A-Z_]+", str(error)) else "INCREMENTAL_EVIDENCE_FAILED"
        print(json.dumps({"success": False, "error": code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(cli())
