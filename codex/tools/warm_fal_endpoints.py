#!/usr/bin/env python3
"""Pre-warm the fal endpoints the content_generation stage will use.

fal scales model pools to zero. A request that lands on a cold pool waits for a
worker to boot, and that wait dwarfs the actual inference: measured on
`fal-ai/minimax/speech-2.6-turbo`, the same narration took 15.2s cold and 4.0s
warm, while `z-image/turbo` reports ~0.5s of GPU time either way. Cold starts,
not model speed, are what blow a 30-second wall-clock budget.

So: fire one throwaway request at each endpoint at the *start* of a run —
concurrently with topic research and script authoring, which take several
seconds and need no fal access. By the time the real slide and voiceover jobs
are submitted the pools are hot.

Run it in the background and forget it; it never fails the pipeline:

    scripts/with-env.sh python3 codex/tools/warm_fal_endpoints.py &

The requests are deliberately tiny (a two-word prompt, a one-word line) and
cost a fraction of a real job. Warming is pointless without credentials, so
outside `live`/`test` mode this exits immediately having done nothing.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.request


IMAGE_ENDPOINT = "fal-ai/z-image/turbo"
VOICE_ENDPOINT = "fal-ai/minimax/speech-2.6-turbo"

WARM_PAYLOADS = {
    IMAGE_ENDPOINT: {
        "prompt": "grey square",
        "image_size": "square",
        "num_inference_steps": 1,
        "num_images": 1,
    },
    VOICE_ENDPOINT: {
        "text": "Ready.",
        "voice_setting": {"voice_id": "Friendly_Person", "speed": 1.0},
        "output_format": "url",
    },
}


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.mode == "dry-run":
        print("warm-fal: dry-run, nothing to warm", file=sys.stderr)
        return 0

    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        print("warm-fal: FAL_KEY not set, skipping", file=sys.stderr)
        return 0

    base_url = os.environ.get("FAL_BASE_URL", "https://queue.fal.run").rstrip("/")
    endpoints = args.endpoint or list(WARM_PAYLOADS)

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(endpoints)) as executor:
        futures = {
            endpoint: executor.submit(warm, api_key, base_url, endpoint, args.timeout_seconds)
            for endpoint in endpoints
        }
        for endpoint, future in futures.items():
            print(f"warm-fal: {endpoint} {future.result()}", file=sys.stderr)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--endpoint",
        action="append",
        help=f"Endpoint to warm; repeatable. Defaults to {', '.join(WARM_PAYLOADS)}.",
    )
    parser.add_argument(
        "--mode",
        choices=("dry-run", "test", "live"),
        default=os.environ.get("WORKFLOW_MODE", "dry-run"),
    )
    parser.add_argument(
        "--timeout-seconds",
        default=int(os.environ.get("FAL_WARM_TIMEOUT_SECONDS", "90")),
        type=int,
        help="Give up on a warm request after this long. Timing out is not an error.",
    )
    return parser.parse_args(argv)


def warm(api_key: str, base_url: str, endpoint: str, timeout_seconds: int) -> str:
    """Submit a throwaway job and poll until the pool has served it.

    Returns a human-readable outcome. Never raises: a failed warm-up leaves the
    pipeline exactly as it would have been without warming, so it must not take
    the run down with it.
    """
    payload = WARM_PAYLOADS.get(endpoint)
    if payload is None:
        return "skipped (no warm payload for this endpoint)"

    started = time.monotonic()
    try:
        submitted = request(
            api_key, f"{base_url}/{endpoint.lstrip('/')}", payload, timeout_seconds
        )
        status_url = submitted.get("status_url") or submitted.get("statusUrl")
        if not status_url:
            return "submitted (no status_url to follow)"
        deadline = started + timeout_seconds
        while time.monotonic() < deadline:
            state = str(
                request(api_key, str(status_url), None, timeout_seconds).get("status", "")
            ).upper()
            if state in {"COMPLETED", "SUCCESS", "SUCCEEDED"}:
                return f"warm in {time.monotonic() - started:.1f}s"
            if state in {"FAILED", "ERROR", "CANCELLED"}:
                return f"pool responded ({state}) in {time.monotonic() - started:.1f}s"
            time.sleep(0.25)
        return f"still cold after {timeout_seconds}s"
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return f"skipped ({type(exc).__name__})"


def request(
    api_key: str, url: str, payload: dict[str, object] | None, timeout_seconds: int
) -> dict[str, object]:
    headers = {"Authorization": f"Key {api_key}"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=body, headers=headers, method="POST" if payload else "GET"
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        data = response.read().decode("utf-8")
    return json.loads(data) if data else {}


if __name__ == "__main__":
    raise SystemExit(main())
