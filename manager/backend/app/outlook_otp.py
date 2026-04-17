import asyncio
import logging
import re
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

_config: dict[str, str] = {}


def configure(tenant_id: str, client_id: str, client_secret: str) -> None:
    _config["tenant_id"] = tenant_id
    _config["client_id"] = client_id
    _config["client_secret"] = client_secret
    _config["access_token"] = ""
    _config["token_expires"] = "0"


def is_configured() -> bool:
    return bool(
        _config.get("tenant_id")
        and _config.get("client_id")
        and _config.get("client_secret")
    )


async def _get_token() -> str:
    now = time.time()
    if _config.get("access_token") and float(_config.get("token_expires", "0")) > now:
        return _config["access_token"]

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{_config['tenant_id']}/oauth2/v2.0/token",
            data={
                "client_id": _config["client_id"],
                "client_secret": _config["client_secret"],
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        _config["access_token"] = data["access_token"]
        _config["token_expires"] = str(now + data.get("expires_in", 3600) - 60)
        return _config["access_token"]


def _extract_otp(text: str) -> str | None:
    if not text:
        return None
    patterns = [
        r"(?:code|verification|otp)[:\s]+(\d{6})",
        r"\b(\d{6})\b",
        r"<[^>]*>(\d{6})<",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


async def fetch_otp(
    user_email: str,
    sender: str = "noreply@tm.openai.com",
    minutes_back: int = 5,
) -> str | None:
    from datetime import datetime, timezone, timedelta

    token = await _get_token()
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes_back)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    filter_expr = (
        f"from/emailAddress/address eq '{sender}' and receivedDateTime ge {cutoff}"
    )

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://graph.microsoft.com/v1.0/users/{user_email}/messages",
            params={
                "$filter": filter_expr,
                "$select": "id,subject,receivedDateTime,body,bodyPreview",
                "$orderby": "receivedDateTime desc",
                "$top": "5",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if resp.status_code != 200:
            log.error("Graph API error: %d %s", resp.status_code, resp.text[:200])
            return None

        data = resp.json()
        messages = data.get("value", [])
        if not messages:
            return None

        for msg in messages:
            body = msg.get("body", {}).get("content", "")
            if not body:
                body = msg.get("bodyPreview", "")
            otp = _extract_otp(body)
            if otp:
                log.info("OTP extracted: %s (from message %s)", otp, msg.get("id", ""))
                return otp

    return None


async def poll_otp(
    user_email: str,
    timeout: float = 300,
    poll_interval: float = 5,
    sender: str = "noreply@tm.openai.com",
) -> str:
    deadline = time.monotonic() + timeout
    log.info("Polling OTP for %s (timeout=%ds)...", user_email, timeout)

    while time.monotonic() < deadline:
        otp = await fetch_otp(user_email, sender=sender)
        if otp:
            return otp
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        await asyncio.sleep(min(poll_interval, remaining))

    raise TimeoutError(f"OTP not received for {user_email} within {timeout}s")


async def otp_provider(email: str) -> str:
    return await poll_otp(email)
