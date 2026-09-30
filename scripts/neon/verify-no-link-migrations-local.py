#!/usr/bin/env python3
"""Apply all migrations to two disposable DBs inside a named local pgvector container.

Usage: python scripts/neon/verify-no-link-migrations-local.py earnest-no-link-qa-...
The container must have been started explicitly by the operator. No network DB URL is used.
"""
import hashlib
import re
import subprocess
import sys
import uuid
from pathlib import Path

BASE = "b1263bc06aef4d45891dd0b78380574292f70a4b"
ROOT = Path(__file__).resolve().parents[2]
VERSION_RE = re.compile(r'"(\d{14}_[^"/]+\.sql)"')

def run(*args, input_data=None):
    result = subprocess.run(args, input=input_data, text=True, encoding="utf-8", errors="replace", capture_output=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1:4]} failed ({result.returncode}): {result.stderr[-1500:]}")
    return result.stdout

def versions(text):
    return VERSION_RE.findall(text)

def psql(container, database, sql, transaction=True):
    args = ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
    if transaction:
        args.append("-1")
    return run(*args, "-U", "postgres", "-d", database, input_data=sql)

def applied(container, database):
    return set(psql(container, database, "SELECT version FROM app_migrations ORDER BY version;", False).split())

def apply(container, database, files):
    present = applied(container, database)
    for version in files:
        if version in present:
            continue
        sql = (ROOT / "neon" / "migrations" / version).read_text(encoding="utf-8")
        enum_add = bool(re.search(r"ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE", sql, re.I))
        try:
            psql(container, database, sql, not enum_add)
        except RuntimeError as error:
            raise RuntimeError(f"{database}/{version}: {error}") from error
        psql(container, database, f"INSERT INTO app_migrations(version) VALUES('{version}');")
        present.add(version)

def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"earnest-no-link-qa-[a-z0-9-]+", sys.argv[1]):
        raise SystemExit("Explicit disposable container earnest-no-link-qa-* required")
    container = sys.argv[1]
    image = run("docker", "inspect", "-f", "{{.Config.Image}}", container).strip()
    if not image.startswith("pgvector/pgvector:"):
        raise SystemExit("Refusing non-pgvector local container")
    current_text = (ROOT / "src/lib/control-plane/migration-versions.js").read_text(encoding="utf-8")
    base_text = run("git", "show", f"{BASE}:src/lib/control-plane/migration-versions.js")
    current, baseline = versions(current_text), versions(base_text)
    files = sorted(p.name for p in (ROOT / "neon/migrations").glob("*.sql"))
    assert current == files, "manifest and migration directory differ"
    assert current[:len(baseline)] == baseline, "baseline migration order changed"
    new = current[len(baseline):]
    changed = run("git", "diff", "--name-status", BASE, "HEAD", "--", "neon/migrations").splitlines()
    assert sorted(changed) == sorted(f"A\tneon/migrations/{version}" for version in new), \
        "an already-applied migration was modified or removed"
    assert len(new) == 9 and all(v.startswith("20260929") for v in new[:8]) \
        and new[-1] == "20260930090000_whatsapp_no_link_source_authority.sql", "unexpected new migration set"
    # The first eight fix-pack migrations have also been rehearsed. Preserve them
    # byte-for-byte; the follow-up correction must remain additive.
    for version in new[:8]:
        original = subprocess.check_output(["git", "show", f"0a67cab:{'neon/migrations/' + version}"])
        current_sql = (ROOT / "neon/migrations" / version).read_bytes().replace(b"\r\n", b"\n")
        assert current_sql == original, f"previous fix-pack migration changed: {version}"
    suffix = uuid.uuid4().hex[:8]
    clean, upgrade = f"epclean_{suffix}", f"epupgrade_{suffix}"
    for database in [clean, upgrade]:
        run("docker", "exec", container, "createdb", "-U", "postgres", database)
        psql(container, database, "CREATE TABLE app_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT now());")
    apply(container, clean, current)
    assert applied(container, clean) == set(current)
    apply(container, upgrade, baseline)
    assert applied(container, upgrade) == set(baseline)
    apply(container, upgrade, new)
    assert applied(container, upgrade) == set(current)
    for database in [clean, upgrade]:
        apply(container, database, current)
        assert applied(container, database) == set(current)
    clean_schema = run("docker", "exec", container, "pg_dump", "-U", "postgres", "-s", "--no-owner", "--no-privileges", clean)
    upgrade_schema = run("docker", "exec", container, "pg_dump", "-U", "postgres", "-s", "--no-owner", "--no-privileges", upgrade)
    # pg_dump emits a fresh random psql \restrict token on every invocation.
    strip_token = lambda dump: re.sub(r"^\\(?:un)?restrict .*$", "", dump, flags=re.M)
    clean_schema, upgrade_schema = strip_token(clean_schema), strip_token(upgrade_schema)
    assert clean_schema == upgrade_schema, "clean and upgrade schema differ"
    print(f"image={image} baseline={len(baseline)} new={len(new)} total={len(current)}")
    print(f"clean={clean} upgrade={upgrade} rerun=skipped schema_sha256={hashlib.sha256(clean_schema.encode()).hexdigest()}")
    print("new_versions=" + ",".join(new))

if __name__ == "__main__":
    main()
