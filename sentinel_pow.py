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


TIMEZONES = {
    "us_eastern": (-5, "Eastern Standard Time"),
    "us_central": (-6, "Central Standard Time"),
    "us_pacific": (-8, "Pacific Standard Time"),
    "korea": (9, "Korean Standard Time"),
    "japan": (9, "Japan Standard Time"),
    "uk": (0, "Greenwich Mean Time"),
    "germany": (1, "Central European Standard Time"),
    "france": (1, "Central European Standard Time"),
    "india": (5, "India Standard Time"),
    "australia": (10, "Australian Eastern Standard Time"),
    "brazil": (-3, "Brasilia Standard Time"),
    "canada": (-5, "Eastern Standard Time"),
    "singapore": (8, "Singapore Standard Time"),
    "random": None,
}

COUNTRY_TO_TZ: dict[str, str] = {
    "US": "us_eastern",
    "CA": "canada",
    "GB": "uk",
    "DE": "germany",
    "FR": "france",
    "KR": "korea",
    "JP": "japan",
    "IN": "india",
    "AU": "australia",
    "BR": "brazil",
    "SG": "singapore",
    "NZ": "australia",
    "IE": "uk",
    "NL": "germany",
    "AT": "germany",
    "CH": "germany",
    "BE": "germany",
    "ES": "germany",
    "IT": "germany",
    "PT": "uk",
    "SE": "germany",
    "NO": "germany",
    "DK": "germany",
    "FI": "germany",
    "PL": "germany",
    "CZ": "germany",
    "RO": "germany",
    "HU": "germany",
    "TW": "singapore",
    "HK": "singapore",
    "PH": "singapore",
    "TH": "singapore",
    "VN": "singapore",
    "MY": "singapore",
    "ID": "singapore",
    "MX": "us_central",
    "AR": "brazil",
    "CL": "brazil",
    "CO": "us_eastern",
}


def tz_from_country(country_code: str) -> str:
    return COUNTRY_TO_TZ.get(country_code.upper(), "germany")


def _format_browser_time(tz_name: str = "random") -> str:
    if tz_name == "random" or tz_name not in TIMEZONES:
        tz_name = random.choice([k for k in TIMEZONES if k != "random"])
    offset_hours, tz_label = TIMEZONES[tz_name]
    sign = "+" if offset_hours >= 0 else "-"
    abs_h = abs(offset_hours)
    gmt_str = f"GMT{sign}{abs_h:02d}00"
    browser_now = datetime.now(timezone(timedelta(hours=offset_hours)))
    return f"{browser_now.strftime('%a %b %d %Y %H:%M:%S')} {gmt_str} ({tz_label})"


def build_config(user_agent: str, tz_name: str = "random") -> list[object]:
    perf_ms = time.perf_counter() * 1000
    epoch_ms = (time.time() * 1000) - perf_ms
    return [
        random.choice(_SCREEN_SIGNATURES),
        _format_browser_time(tz_name),
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
    tz_name: str = "random",
) -> str:
    config = build_config(user_agent, tz_name=tz_name)
    seed = format(random.random())
    solution = solve_pow(seed, difficulty, config, max_iterations=max_iterations)
    return f"gAAAAAC{solution}"
