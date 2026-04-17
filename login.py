import asyncio
import json
import logging
import secrets
import sys
import time
import uuid
from collections.abc import Awaitable, Callable

from curl_cffi.requests import AsyncSession

import sentinel_pow
from exceptions import OAuthError
from models import ProxyConfig

log = logging.getLogger(__name__)

type OTPProvider = Callable[[str], Awaitable[str]]

SENTINEL_URL = "https://sentinel.openai.com/backend-api/sentinel/req"
SENTINEL_REFERER = (
    "https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6"
)

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

OTP_MAX_ATTEMPTS = 5
OTP_TIMEOUT_SECONDS = 300


def _traceparent() -> str:
    trace_id = secrets.token_hex(16)
    parent_id = secrets.token_hex(8)
    return f"00-{trace_id}-{parent_id}-01"


def _log_response(resp: object, elapsed: float, label: str) -> None:
    from curl_cffi.requests import Response

    if not isinstance(resp, Response):
        return
    log.info("  %s  |  HTTP %d  |  %.1fs", label, resp.status_code, elapsed)
    body = resp.text[:1000] if resp.text else "(empty)"
    log.debug("  Body: %s", body)


class LoginSession:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self.email = ""
        self._device_id = str(uuid.uuid4())
        self._auth_session_id = str(uuid.uuid4())
        self._csrf_token = ""
        self._page_type = ""
        self._user_agent = ""

    @classmethod
    async def create(
        cls,
        *,
        impersonate: str = "",
        proxy: ProxyConfig | None = None,
    ) -> "LoginSession":
        profile = impersonate or secrets.choice(BROWSER_PROFILES)
        log.info("  Browser fingerprint: %s", profile)
        proxies = proxy.as_proxy_spec() if proxy else None
        session = AsyncSession(proxies=proxies, impersonate=profile)
        return cls(session)

    @property
    def page_type(self) -> str:
        return self._page_type

    @property
    def inner_session(self) -> AsyncSession:
        return self._session

    async def get_csrf(self) -> str:
        log.info("Getting CSRF token...")
        start = time.monotonic()
        resp = await self._session.get("https://chatgpt.com/api/auth/csrf", timeout=15)
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "CSRF")
        data = resp.json()
        if not isinstance(data, dict):
            raise OAuthError("CSRF response is not a dict")
        self._csrf_token = str(data.get("csrfToken") or "").strip()
        if not self._csrf_token:
            raise OAuthError("CSRF token not found")
        log.info("  CSRF token: %s...%s", self._csrf_token[:8], self._csrf_token[-4:])
        return self._csrf_token

    async def signin(self, email: str) -> str:
        self.email = email
        log.info("Signing in via chatgpt.com for %s...", email)

        start = time.monotonic()
        signin_resp = await self._session.post(
            "https://chatgpt.com/api/auth/signin/openai",
            params={
                "prompt": "login",
                "ext-oai-did": self._device_id,
                "auth_session_logging_id": self._auth_session_id,
                "ext-passkey-client-capabilities": "1111",
                "screen_hint": "login",
                "login_hint": email,
            },
            data=(
                f"callbackUrl=https%3A%2F%2Fchatgpt.com%2F"
                f"&csrfToken={self._csrf_token}&json=true"
            ),
            headers={
                "content-type": "application/x-www-form-urlencoded",
                "referer": "https://chatgpt.com/",
            },
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(signin_resp, elapsed, "Signin")

        signin_data = signin_resp.json()
        if not isinstance(signin_data, dict):
            raise OAuthError("Signin response is not a dict")
        authorize_url = str(signin_data.get("url") or "").strip()
        if not authorize_url:
            raise OAuthError("Signin response missing authorize URL")
        log.info("  Authorize URL: %s", authorize_url[:120])

        start = time.monotonic()
        auth_resp = await self._session.get(authorize_url, timeout=15)
        elapsed = time.monotonic() - start
        _log_response(auth_resp, elapsed, "Authorize")
        final_url = str(auth_resp.url)
        log.info("  Landed on: %s", final_url[:120])

        self._user_agent = self._session.headers.get("User-Agent") or "Mozilla/5.0"
        return final_url

    async def _get_sentinel_header(self, flow: str) -> str:
        pow_token = sentinel_pow.build_token(str(self._user_agent))

        device_id = (
            self._session.cookies.get("oai-did", domain="auth.openai.com")
            or self._device_id
        )

        start = time.monotonic()
        resp = await self._session.post(
            SENTINEL_URL,
            headers={
                "origin": "https://sentinel.openai.com",
                "referer": SENTINEL_REFERER,
                "content-type": "text/plain;charset=UTF-8",
                "traceparent": _traceparent(),
            },
            data=json.dumps(
                {
                    "p": pow_token,
                    "id": device_id,
                    "flow": flow,
                }
            ),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, f"Sentinel ({flow})")

        if resp.status_code != 200:
            raise OAuthError(f"Sentinel ({flow}) failed: HTTP {resp.status_code}")
        data = resp.json()
        if not isinstance(data, dict):
            raise OAuthError(f"Sentinel ({flow}) returned non-dict")
        token = data.get("token")
        if not isinstance(token, str) or not token:
            raise OAuthError(f"Sentinel ({flow}) missing token")

        return json.dumps(
            {
                "p": pow_token,
                "t": "",
                "c": token,
                "id": device_id,
                "flow": flow,
            }
        )

    async def submit_email(self) -> str:
        log.info("Submitting email: %s", self.email)

        sentinel_header = await self._get_sentinel_header("authorize_continue")

        start = time.monotonic()
        resp = await self._session.post(
            "https://auth.openai.com/api/accounts/authorize/continue",
            headers={
                "referer": "https://auth.openai.com/log-in",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": sentinel_header,
                "traceparent": _traceparent(),
            },
            data=json.dumps({"username": {"value": self.email, "kind": "email"}}),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "authorize/continue")

        if resp.status_code != 200:
            raise OAuthError(
                f"authorize/continue failed: HTTP {resp.status_code}: {resp.text[:200]}"
            )

        resp_data = resp.json()
        self._page_type = ""
        if isinstance(resp_data, dict):
            page_info = resp_data.get("page")
            if isinstance(page_info, dict):
                self._page_type = str(page_info.get("type") or "")

        log.info("  Page type: %s", self._page_type)

        if self._page_type == "login_password":
            log.info("  Switching to passwordless OTP...")
            start = time.monotonic()
            otp_resp = await self._session.post(
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
            _log_response(otp_resp, elapsed, "Passwordless send-otp")
            if otp_resp.status_code != 200:
                raise OAuthError(
                    f"Passwordless send-otp failed: HTTP {otp_resp.status_code}: "
                    f"{otp_resp.text[:300]}"
                )

        return self._page_type

    async def verify_otp(
        self,
        otp_provider: OTPProvider,
        *,
        timeout: float = OTP_TIMEOUT_SECONDS,
        max_attempts: int = OTP_MAX_ATTEMPTS,
    ) -> None:
        if self._page_type not in ("login_password", "email_otp_verification"):
            log.info("  OTP not required (page_type=%s)", self._page_type)
            return

        log.info(
            "Waiting for OTP (timeout=%ds, max_attempts=%d)...",
            timeout,
            max_attempts,
        )
        for attempt in range(1, max_attempts + 1):
            try:
                otp = await asyncio.wait_for(otp_provider(self.email), timeout=timeout)
            except TimeoutError:
                raise OAuthError(f"OTP provider timed out after {timeout}s")

            otp = otp.strip()
            if not otp:
                raise OAuthError("OTP provider returned empty code")

            log.info("  Attempt %d: validating OTP %s", attempt, otp)

            start = time.monotonic()
            resp = await self._session.post(
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
            _log_response(resp, elapsed, "OTP validate")

            if resp.status_code == 200:
                log.info("  OTP validated successfully")
                return

            log.warning("  OTP invalid (attempt %d/%d)", attempt, max_attempts)

        raise OAuthError(f"OTP validation failed after {max_attempts} attempts")

    async def establish_session(self) -> dict[str, object]:
        log.info("Following auth redirect chain...")
        current_url = "https://auth.openai.com/authorize/resume"
        for hop in range(12):
            resp = await self._session.get(
                current_url, allow_redirects=False, timeout=15
            )
            location = resp.headers.get("Location") or ""
            log.info(
                "  Hop %d: HTTP %d → %s",
                hop + 1,
                resp.status_code,
                location[:120] if location else "(end)",
            )

            if not location or resp.status_code not in (301, 302, 303, 307, 308):
                break

            if "api/auth/callback" in location:
                log.info("  Callback found at hop %d, following...", hop + 1)
                start = time.monotonic()
                await self._session.get(location, timeout=30)
                elapsed = time.monotonic() - start
                log.info("  Callback complete  |  %.1fs", elapsed)
                break

            current_url = (
                location
                if location.startswith("http")
                else f"https://chatgpt.com{location}"
            )

        log.info("Establishing ChatGPT session...")
        start = time.monotonic()
        resp = await self._session.get(
            "https://chatgpt.com/api/auth/session",
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "auth/session")
        data = resp.json()
        return data if isinstance(data, dict) else {}

    def cookies(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for cookie in self._session.cookies.jar:
            key = f"{cookie.name}@{cookie.domain}"
            result[key] = cookie.value or ""
        return result

    async def close(self) -> None:
        await self._session.close()

    async def __aenter__(self) -> "LoginSession":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()


async def console_otp_provider(email: str) -> str:
    return await asyncio.to_thread(input, f"\n  Enter OTP code for {email}: ")


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


async def _main() -> None:
    from pathlib import Path

    print(f"\n  {BOLD}ChatGPT Login{RESET}\n")

    proxy_url = input("  Proxy URL (enter to skip): ").strip() or None
    email = input("  Email: ").strip()
    if not email:
        print(f"  {RED}Email is required.{RESET}")
        return

    verbose_input = input("  Verbose logging? (y/N): ").strip()
    verbose = verbose_input.lower() in ("y", "yes")
    _setup_logging(verbose=verbose)

    proxy = ProxyConfig(url=proxy_url)
    log.info("")
    log.info("  %sProxy:%s    %s", DIM, RESET, proxy.url or "direct (no proxy)")
    log.info("  %sEmail:%s    %s", DIM, RESET, email)
    log.info("")

    async with await LoginSession.create(proxy=proxy) as session:
        await session.get_csrf()
        await session.signin(email)
        await session.submit_email()
        await session.verify_otp(console_otp_provider, timeout=300)
        session_data = await session.establish_session()

        result: dict[str, object] = {
            "email": email,
        }
        if session_data:
            result["session"] = session_data
        result["cookies"] = session.cookies()

        email_slug = email.replace("@", "_")
        filename = f"login_{email_slug}_{int(time.time())}.json"
        Path(filename).write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        print(f"\n  {GREEN}{BOLD}✓ Login complete{RESET}")
        print(f"  Saved to {filename}")


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print(f"\n  {YELLOW}Interrupted{RESET}")


if __name__ == "__main__":
    main()
