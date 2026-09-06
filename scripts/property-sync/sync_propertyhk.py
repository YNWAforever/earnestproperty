"""Replay exact request bytes; never re-crawl after an uncertain commit."""

import argparse, json, os, uuid
from pathlib import Path
from scraping.worker import (
    submit,
    WorkerError,
    frozen,
    scope_lock,
    advance_baseline,
    gate,
)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--payload", type=Path, required=True)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent / "output"
    )
    a = p.parse_args()
    try:
        data = a.payload.read_bytes()
        payload = json.loads(data)
        cfg = json.loads(a.config.read_text(encoding="utf-8-sig"))["sources"][
            "propertyhk"
        ]
        if payload.get("source") != "propertyhk":
            raise WorkerError("wrong_replay_source")
        with scope_lock(a.root / "locks" / "propertyhk-EPW-EPS-EPT.lock"):
            if not gate(payload, None)["allowed"]:
                raise WorkerError("invalid_replay_snapshot")
            result = (
                {"success": True, "status": "dry_run", "baseline_advanced": False}
                if a.dry_run
                else submit(
                    data,
                    os.environ.get("PROPERTYHK_SYNC_URL", ""),
                    os.environ.get("PROPERTYHK_SYNC_SECRET", ""),
                    cfg.get("sync_allowed_origins", []),
                )
            )
            if not a.dry_run:
                receipt = a.payload.parent / (
                    "receipt-replay-" + uuid.uuid4().hex + ".json"
                )
                receipt.write_bytes(frozen(result))
                result["baseline_advanced"] = advance_baseline(
                    a.root
                    / "baselines"
                    / "propertyhk"
                    / "EPW-EPS-EPT"
                    / "baseline.json",
                    payload,
                    result,
                )
            print(json.dumps(result))
            raise SystemExit(0 if result.get("success") else 1)
    except (WorkerError, OSError, ValueError) as e:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": str(e) if isinstance(e, WorkerError) else type(e).__name__,
                }
            )
        )
        raise SystemExit(1)
