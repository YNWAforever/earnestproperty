"""Apply an immutable saved 28hse payload; no collection or config loading."""
import argparse
import json
from pathlib import Path
from scraping.worker import replay_28hse, WorkerError

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        result = replay_28hse(args.payload, args.root, args.apply)
    except (WorkerError, OSError, ValueError, KeyError, TypeError) as error:
        result = {"success": False, "status": "replay_failed", "error": str(error) if isinstance(error, WorkerError) else type(error).__name__}
    print(json.dumps(result))
    return 0 if result["success"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
