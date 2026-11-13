"""Private delta bundles reject modified bytes and unsafe archive members."""
import io
import json
from pathlib import Path
import sys
import tarfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import incremental_evidence as evidence


def inputs(directory):
    directory.mkdir()
    request = {"source": "28hse", "scraped_at": "2026-11-10T00:00:00Z",
               "meta": {"scope_id": "agent:540", "incremental": {"mode": "index-delta-v1"}}}
    for name in evidence.FILES:
        (directory / name).write_text(json.dumps(request if name == "request.json" else {}), encoding="utf-8")


def test_private_bundle_round_trip_preserves_bytes_and_detects_mutation(tmp_path):
    source, archive, restored = tmp_path / "source", tmp_path / "bundle.tar.gz", tmp_path / "restored"
    inputs(source)
    evidence.pack(source, archive, "a" * 40)
    evidence.unpack(archive, restored)
    assert (source / "request.json").read_bytes() == (restored / "request.json").read_bytes()
    (restored / "cache-next.json").write_text('{"forged":true}')
    with pytest.raises(ValueError, match="HASH_MISMATCH"):
        evidence.verify(restored)


@pytest.mark.parametrize("kind", ["traversal", "duplicate", "symlink", "oversized"])
def test_untrusted_archive_is_rejected_before_any_member_is_written(tmp_path, kind):
    archive, destination = tmp_path / "bad.tar.gz", tmp_path / "restored"
    names = [*evidence.FILES, "manifest.json"]
    if kind == "traversal":
        names[0] = "../request.json"
    if kind == "duplicate":
        names[-1] = names[0]
    with tarfile.open(archive, "w:gz") as bundle:
        for position, name in enumerate(names):
            item = tarfile.TarInfo(name)
            if kind == "symlink" and position == 0:
                item.type = tarfile.SYMTYPE
                item.linkname = "outside"
                bundle.addfile(item)
            elif kind == "oversized" and position == 0:
                body = b"x" * (evidence.FILES["request.json"] + 1)
                item.size = len(body)
                bundle.addfile(item, io.BytesIO(body))
            else:
                item.size = 2
                bundle.addfile(item, io.BytesIO(b"{}"))
    with pytest.raises(ValueError, match="ARCHIVE_INVALID"):
        evidence.unpack(archive, destination)
    assert not destination.exists()
