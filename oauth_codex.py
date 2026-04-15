import asyncio
import json
import logging
import secrets
import sys
import time
import urllib.parse
import uuid

from curl_cffi.requests import AsyncSession

import sentinel_pow
from exceptions import OAuthError
from models import ProxyConfig

log = logging.getLogger(__name__)

BROWSER_PROFILES = [
    "chrome131",
    "chrome133a",
    "chrome136",
    "chrome142",
    "edge99",
    "edge101",
    "safari180",
    "safari184",
]

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"

LEVEL_STYLES = {
    "DEBUG": DIM,
    "INFO": CYAN,
    "WARNING": YELLOW,
    "ERROR": RED,
    "CRITICAL": f"{BOLD}{RED}",
}


class ColorFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = self.formatTime(record, "%H:%M:%S")
        ms = f"{record.msecs:03.0f}"
        level = record.levelname
        style = LEVEL_STYLES.get(level, "")
        level_tag = f"{style}{level:<8}{RESET}"
        name = f"{DIM}{record.name}{RESET}"
        msg = record.getMessage()
        line = f"{DIM}{ts}.{ms}{RESET} {level_tag} {name} {BOLD}│{RESET} {msg}"
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            line += f"\n{RED}{record.exc_text}{RESET}"
        return line


def _setup_logging(*, verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(ColorFormatter())
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)
    logging.getLogger("curl_cffi").setLevel(logging.WARNING)


def _log_response(resp: object, elapsed: float, label: str) -> None:
    from curl_cffi.requests import Response

    if not isinstance(resp, Response):
        return
    log.info("  %s  |  HTTP %d  |  %.1fs", label, resp.status_code, elapsed)
    body = resp.text[:1000] if resp.text else "(empty)"
    log.debug("  Body: %s", body)


def _pick_browser() -> str:
    profile = secrets.choice(BROWSER_PROFILES)
    log.info("  Browser fingerprint: %s", profile)
    return profile


def _dump_cookies(session: AsyncSession) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for cookie in session.cookies.jar:
        key = f"{cookie.name}@{cookie.domain}"
        cookies[key] = cookie.value or ""
    return cookies


def _traceparent() -> str:
    trace_id = secrets.token_hex(16)
    parent_id = secrets.token_hex(8)
    return f"00-{trace_id}-{parent_id}-01"


async def run(proxy: ProxyConfig, email: str, authorize_url: str) -> dict[str, object]:
    proxies = proxy.as_proxy_spec()
    browser_profile = _pick_browser()

    parsed = urllib.parse.urlparse(authorize_url)
    qs = urllib.parse.parse_qs(parsed.query)
    state = (qs.get("state") or [""])[0]
    code_challenge = (qs.get("code_challenge") or [""])[0]
    redirect_uri = (qs.get("redirect_uri") or [""])[0]

    if not state:
        raise OAuthError("authorize URL missing ?state=")

    async with AsyncSession(proxies=proxies, impersonate=browser_profile) as session:
        log.info("[1/7] Following authorize URL...")
        log.info("  URL: %s", authorize_url[:120])

        start = time.monotonic()
        auth_resp = await session.get(authorize_url, timeout=15)
        elapsed = time.monotonic() - start
        _log_response(auth_resp, elapsed, "OAuth authorize")

        final_url = str(auth_resp.url)
        log.info("  Landed on: %s", final_url[:120])

        if "log-in" not in final_url and "create-account" not in final_url:
            log.error("  Unexpected landing page: %s", final_url)
            raise OAuthError(f"Expected login/signup page, got: {final_url}")

        log.info("[2/7] Generating sentinel token...")
        device_id = session.cookies.get("oai-did", domain="auth.openai.com") or str(
            uuid.uuid4()
        )
        log.info("  Device ID: %s", device_id)

        user_agent = session.headers.get("User-Agent") or "Mozilla/5.0"
        pow_token = sentinel_pow.build_token(str(user_agent))
        log.debug("  PoW token: %s...%s", pow_token[:20], pow_token[-6:])

        start = time.monotonic()
        sentinel_resp = await session.post(
            "https://sentinel.openai.com/backend-api/sentinel/req",
            headers={
                "origin": "https://sentinel.openai.com",
                "referer": (
                    "https://sentinel.openai.com/backend-api/sentinel/"
                    "frame.html?sv=20260219f9f6"
                ),
                "content-type": "text/plain;charset=UTF-8",
                "traceparent": _traceparent(),
            },
            data=json.dumps(
                {
                    "p": pow_token,
                    "id": device_id,
                    "flow": "authorize_continue",
                }
            ),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(sentinel_resp, elapsed, "Sentinel (authorize_continue)")

        if sentinel_resp.status_code != 200:
            raise OAuthError(f"Sentinel failed: HTTP {sentinel_resp.status_code}")
        sentinel_data = sentinel_resp.json()
        if not isinstance(sentinel_data, dict):
            raise OAuthError("Sentinel returned non-dict response")
        sentinel_token = sentinel_data.get("token")
        if not isinstance(sentinel_token, str) or not sentinel_token:
            raise OAuthError("Sentinel response missing token")

        sentinel_header = json.dumps(
            {
                "p": pow_token,
                "t": "",
                "c": sentinel_token,
                "id": device_id,
                "flow": "authorize_continue",
            }
        )

        log.info("[3/7] Submitting email via authorize/continue...")
        log.info("  Email: %s", email)

        start = time.monotonic()
        continue_resp = await session.post(
            "https://auth.openai.com/api/accounts/authorize/continue",
            headers={
                "referer": "https://auth.openai.com/log-in",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": sentinel_header,
                "traceparent": _traceparent(),
            },
            data=json.dumps(
                {
                    "username": {"value": email, "kind": "email"},
                }
            ),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(continue_resp, elapsed, "authorize/continue")

        if continue_resp.status_code != 200:
            raise OAuthError(
                f"authorize/continue failed: HTTP {continue_resp.status_code}: "
                f"{continue_resp.text[:200]}"
            )

        continue_data = continue_resp.json()
        page_type = ""
        if isinstance(continue_data, dict):
            page_info = continue_data.get("page")
            if isinstance(page_info, dict):
                page_type = str(page_info.get("type") or "")
        log.info("  Page type: %s", page_type)

        if page_type == "login_password":
            log.info("[4/7] Sending passwordless OTP...")

            start = time.monotonic()
            send_otp_resp = await session.post(
                "https://auth.openai.com/api/accounts/passwordless/send-otp",
                headers={
                    "referer": "https://auth.openai.com/log-in/password",
                    "accept": "application/json",
                    "content-type": "application/json",
                    "traceparent": _traceparent(),
                },
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(send_otp_resp, elapsed, "Passwordless send-otp")

            if send_otp_resp.status_code != 200:
                raise OAuthError(
                    f"Passwordless send-otp failed: HTTP {send_otp_resp.status_code}: "
                    f"{send_otp_resp.text[:300]}"
                )

        if page_type in ("login_password", "email_otp_verification"):
            log.info("[5/7] Email OTP verification...")
            while True:
                otp = input("\n  Enter OTP code from email: ").strip()
                if not otp:
                    raise OAuthError("No OTP code provided")
                log.info("  Validating OTP: %s", otp)

                start = time.monotonic()
                otp_resp = await session.post(
                    "https://auth.openai.com/api/accounts/email-otp/validate",
                    headers={
                        "referer": "https://auth.openai.com/email-verification",
                        "accept": "application/json",
                        "content-type": "application/json",
                        "traceparent": _traceparent(),
                    },
                    data=json.dumps({"code": otp}),
                    timeout=15,
                )
                elapsed = time.monotonic() - start
                _log_response(otp_resp, elapsed, "OTP validate")

                if otp_resp.status_code == 200:
                    log.info("  OTP validated successfully")
                    break
                log.warning("  Wrong OTP code, try again")
        else:
            log.info("[4/7] Skipped — page_type is not login_password")

        log.info("[6/7] Workspace select...")
        workspace_id = input("\n  Enter workspace ID: ").strip()
        if not workspace_id:
            raise OAuthError("No workspace ID provided")

        log.info("  Workspace ID: %s", workspace_id)

        start = time.monotonic()
        select_resp = await session.post(
            "https://auth.openai.com/api/accounts/workspace/select",
            headers={
                "referer": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                "content-type": "application/json",
                "traceparent": _traceparent(),
            },
            data=json.dumps({"workspace_id": workspace_id}),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(select_resp, elapsed, "Workspace select")

        if select_resp.status_code != 200:
            raise OAuthError(
                f"Workspace select failed: HTTP {select_resp.status_code}: "
                f"{select_resp.text[:300]}"
            )

        content_type = str(select_resp.headers.get("content-type") or "")
        if "application/json" not in content_type:
            raise OAuthError(f"Workspace select returned non-JSON: {content_type}")

        select_data = select_resp.json()
        continue_url = ""
        if isinstance(select_data, dict):
            continue_url = str(select_data.get("continue_url") or "").strip()
        if not continue_url:
            raise OAuthError("Missing continue_url from workspace select")

        log.info("[7/7] Following redirect chain...")
        current_url = continue_url
        callback_url = ""
        for hop in range(12):
            resp = await session.get(current_url, allow_redirects=False, timeout=15)
            location = resp.headers.get("Location") or ""
            log.info(
                "  Hop %d: HTTP %d → %s",
                hop + 1,
                resp.status_code,
                location[:120] if location else "(end)",
            )

            if not location or resp.status_code not in (301, 302, 303, 307, 308):
                break

            if "localhost" in location and "/auth/callback" in location:
                log.info("  Callback captured at hop %d", hop + 1)
                callback_url = location
                break

            current_url = location

        log.info("[8/8] Collecting cookies and state...")
        cookies = _dump_cookies(session)
        log.info("  Cookies collected: %d", len(cookies))

        result: dict[str, object] = {
            "email": email,
            "final_url": final_url,
            "page_type": page_type,
            "device_id": device_id,
            "workspace_id": workspace_id,
            "authorize_url": authorize_url,
            "state": state,
            "redirect_uri": redirect_uri,
            "callback_url": callback_url,
            "cookies": cookies,
            "browser_profile": browser_profile,
        }

        if callback_url:
            log.info(
                "%s%s✓ Callback URL captured%s",
                GREEN,
                BOLD,
                RESET,
            )
            log.info("  %s", callback_url)
        else:
            log.warning("  Failed to capture callback URL")

        return result


async def _main() -> None:
    print(f"\n  {BOLD}Codex OAuth Flow{RESET}\n")

    proxy_url = input("  Proxy URL (enter to skip): ").strip() or None
    email = input("  Email: ").strip()
    if not email:
        print(f"  {RED}Email is required.{RESET}")
        return

    authorize_url = input("  Codex OAuth URL: ").strip()
    if not authorize_url:
        print(f"  {RED}OAuth URL is required.{RESET}")
        return

    verbose_input = input("  Verbose logging? (y/N): ").strip()
    verbose = verbose_input.lower() in ("y", "yes")

    _setup_logging(verbose=verbose)

    proxy = ProxyConfig(url=proxy_url)
    log.info("")
    log.info("  %sProxy:%s    %s", DIM, RESET, proxy.url or "direct (no proxy)")
    log.info("  %sEmail:%s    %s", DIM, RESET, email)
    log.info("")

    result = await run(proxy, email, authorize_url)

    print(f"\n  {BOLD}Result:{RESET}")
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print(f"\n  {YELLOW}Interrupted{RESET}")


if __name__ == "__main__":
    main()
