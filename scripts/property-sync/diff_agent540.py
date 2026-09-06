import argparse, csv
from pathlib import Path
from scraping.worker import diff, write_csv

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--old", type=Path, required=True)
    p.add_argument("--new", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    with a.old.open(encoding="utf-8-sig", newline="") as f:
        old = list(csv.DictReader(f))
    with a.new.open(encoding="utf-8-sig", newline="") as f:
        new = list(csv.DictReader(f))
    a.output.parent.mkdir(parents=True, exist_ok=True)
    write_csv(a.output, diff(old, new))
