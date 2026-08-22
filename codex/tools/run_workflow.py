#!/usr/bin/env python3
"""Run topic_research → research_script → fal_media_agent for one lesson.

Writes status.json on the run root so the Next app can poll. Never prints secrets.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent.parent


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--topic", required=True)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--run-id", required=True)
    p.add_argument(
        "--research-mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    p.add_argument(
        "--media-mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    return p.parse_args(argv)


def write_status(run_root: Path, **fields: Any) -> None:
    run_root.mkdir(parents=True, exist_ok=True)
    payload = {"status": "pending", **fields}
    (run_root / "status.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def run_step(cmd: list[str], run_root: Path) -> None:
    log = run_root / "pipeline.log"
    with log.open("a", encoding="utf-8") as fh:
        fh.write(f"\n$ {' '.join(cmd)}\n")
        fh.flush()
        proc = subprocess.run(
            cmd,
            cwd=str(REPO),
            stdout=fh,
            stderr=subprocess.STDOUT,
            check=False,
            env=os.environ.copy(),
        )
        fh.write(f"exit {proc.returncode}\n")
    if proc.returncode != 0:
        raise RuntimeError(f"step failed ({proc.returncode}): {cmd[0]}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    run_root = args.output_dir.resolve()
    run_root.mkdir(parents=True, exist_ok=True)
    py = sys.executable

    try:
        write_status(run_root, stage="research", run_id=args.run_id, topic=args.topic)
        run_step(
            [
                py,
                str(TOOLS / "topic_research.py"),
                "--topic",
                args.topic,
                "--output-dir",
                str(run_root),
                "--run-id",
                args.run_id,
                "--mode",
                args.research_mode,
            ],
            run_root,
        )

        brief = run_root / "00-topic-research" / "research-brief.json"
        script = run_root / "lesson-script.json"
        write_status(run_root, stage="script", run_id=args.run_id, topic=args.topic)
        run_step(
            [py, str(TOOLS / "research_script.py"), "--brief", str(brief), "--output", str(script)],
            run_root,
        )

        write_status(run_root, stage="media", run_id=args.run_id, topic=args.topic)
        run_step(
            [
                py,
                str(TOOLS / "fal_media_agent.py"),
                "--script",
                str(script),
                "--output-dir",
                str(run_root),
                "--run-id",
                args.run_id,
                "--mode",
                args.media_mode,
            ],
            run_root,
        )
        write_status(run_root, status="ready", stage="ready", run_id=args.run_id, topic=args.topic)
    except Exception as exc:
        write_status(
            run_root,
            status="failed",
            stage="failed",
            run_id=args.run_id,
            topic=args.topic,
            error=str(exc),
        )
        print(f"run-workflow: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
