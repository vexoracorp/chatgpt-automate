from __future__ import annotations

import base64
import hashlib
import json
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

DEFAULT_DIFFICULTY = "0fffff"
DEFAULT_MAX_ITERATIONS = 500_000

_SCREEN_SIGNATURES = (3000, 3120, 4000, 4160)
_LANGUAGE_SIGNATURE = "en-US,es-US,en,es"
_NAVIGATOR_KEYS = ("location", "ontransitionend", "onprogress")
_WINDOW_KEYS = ("window", "document", "navigator")


class SentinelPOWError(RuntimeError):
    pass


def _format_browser_time() -> str:
    browser_now = datetime.now(timezone(timedelta(hours=-5)))
    return (
        browser_now.strftime("%a %b %d %Y %H:%M:%S")
        + " GMT-0500 (Eastern Standard Time)"
    )


def build_config(user_agent: str) -> list[object]:
    perf_ms = time.perf_counter() * 1000
    epoch_ms = (time.time() * 1000) - perf_ms
    return [
        random.choice(_SCREEN_SIGNATURES),
        _format_browser_time(),
        4294705152,
        0,
        user_agent,
        "",
        "",
        "en-US",
        _LANGUAGE_SIGNATURE,
        0,
        random.choice(_NAVIGATOR_KEYS),
        "location",
        random.choice(_WINDOW_KEYS),
        perf_ms,
        str(uuid.uuid4()),
        "",
        8,
        epoch_ms,
    ]


def _encode_payload(config: list[object], nonce: int) -> bytes:
    prefix = (
        json.dumps(config[:3], separators=(",", ":"), ensure_ascii=False)[:-1] + ","
    ).encode("utf-8")
    middle = (
        ","
        + json.dumps(config[4:9], separators=(",", ":"), ensure_ascii=False)[1:-1]
        + ","
    ).encode("utf-8")
    suffix = (
        "," + json.dumps(config[10:], separators=(",", ":"), ensure_ascii=False)[1:]
    ).encode("utf-8")
    body = (
        prefix
        + str(nonce).encode("ascii")
        + middle
        + str(nonce >> 1).encode("ascii")
        + suffix
    )
    return base64.b64encode(body)


def solve_pow(
    seed: str,
    difficulty: str,
    config: list[object],
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> str:
    seed_bytes = seed.encode("utf-8")
    target = bytes.fromhex(difficulty)
    prefix_length = len(target)

    for nonce in range(max_iterations):
        encoded = _encode_payload(config, nonce)
        digest = hashlib.sha3_512(seed_bytes + encoded).digest()
        if digest[:prefix_length] <= target:
            return encoded.decode("ascii")

    raise SentinelPOWError(f"PoW not solved after {max_iterations} iterations")


def build_token(
    user_agent: str,
    difficulty: str = DEFAULT_DIFFICULTY,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> str:
    config = build_config(user_agent)
    seed = format(random.random())
    solution = solve_pow(seed, difficulty, config, max_iterations=max_iterations)
    return f"gAAAAAC{solution}"
