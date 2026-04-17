"""Codex Device Code Login flow.

Implements the device code authorization flow for Codex CLI:
1. GET /api/accounts/deviceauth/authorize → follow redirects to login page
2. POST /api/accounts/authorize/continue → submit email
3. POST /api/accounts/passwordless/send-otp → trigger OTP
4. POST /api/accounts/email-otp/validate → validate OTP
5. POST /api/accounts/workspace/select → select workspace
6. POST /api/accounts/deviceauth/authorize_codex → grant device code
"""

import asyncio
import json
import logging
import secrets
import time
import urllib.parse
from collections.abc import Awaitable, Callable

from curl_cffi.requests import AsyncSession

import sentinel_pow
from exceptions import OAuthError
from models import ProxyConfig

log = logging.getLogger(__name__)

SENTINEL_URL = "https://sentinel.openai.com/backend-api/sentinel/req"
SENTINEL_REFERER = (
    "https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6"
)

BROWSER_PROFILES = [
    "chrome131",
    "chrome133a",
    "chrome136",
    "chrome142",
]

OTP_MAX_ATTEMPTS = 5
OTP_TIMEOUT_SECONDS = 300

type OTPProvider = Callable[[str], Awaitable[str]]


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


class DeviceCodeSession:
    """Manages the Codex device code login flow."""

    def __init__(
        self,
        session: AsyncSession,
        user_code: str,
        device_code: str,
    ) -> None:
        self._session = session
        self.user_code = user_code
        self.device_code = device_code
        self._device_id = ""
        self._user_agent = ""
        self._page_type = ""
        self._authorization_code = ""
        self._state = ""
        self.email = ""

    @classmethod
    async def create(
        cls,
        user_code: str,
        device_code: str,
        *,
        impersonate: str = "",
        proxy: ProxyConfig | None = None,
    ) -> "DeviceCodeSession":
        profile = impersonate or secrets.choice(BROWSER_PROFILES)
        log.info("  Browser fingerprint: %s", profile)
        proxies = proxy.as_proxy_spec() if proxy else None
        session = AsyncSession(proxies=proxies, impersonate=profile)
        return cls(session, user_code, device_code)

    async def start_device_auth(self) -> str:
        """Step 1: GET /api/accounts/deviceauth/authorize → follow redirects to login page."""
        log.info("Starting device auth flow...")

        start = time.monotonic()
        resp = await self._session.get(
            "https://auth.openai.com/api/accounts/deviceauth/authorize",
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "deviceauth/authorize")

        final_url = str(resp.url)
        log.info("  Landed on: %s", final_url[:120])

        self._device_id = (
            self._session.cookies.get("oai-did", domain="auth.openai.com") or ""
        )
        self._user_agent = self._session.headers.get("User-Agent") or "Mozilla/5.0"
        log.info("  Device ID: %s", self._device_id)

        return final_url

    async def _get_sentinel_header(self, flow: str) -> str:
        pow_token = sentinel_pow.build_token(str(self._user_agent))

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
                    "id": self._device_id,
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
                "id": self._device_id,
                "flow": flow,
            }
        )

    async def submit_email(self, email: str) -> str:
        """Step 5: POST /api/accounts/authorize/continue with email."""
        self.email = email
        log.info("Submitting email: %s", email)

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
            data=json.dumps({"username": {"value": email, "kind": "email"}}),
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
        """Step 6-7: Validate OTP code."""
        if self._page_type not in ("login_password", "email_otp_verification"):
            log.info("  OTP not required (page_type=%s)", self._page_type)
            return

        log.info(
            "Waiting for OTP (timeout=%ds, max_attempts=%d)...", timeout, max_attempts
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

    async def select_workspace(self, workspace_id: str) -> None:
        """Step 8: POST /api/accounts/workspace/select."""
        log.info("Selecting workspace: %s", workspace_id)

        start = time.monotonic()
        resp = await self._session.post(
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
        _log_response(resp, elapsed, "Workspace select")

        if resp.status_code == 409:
            raise OAuthError("Session expired (409 Conflict)")
        if resp.status_code != 200:
            raise OAuthError(
                f"Workspace select failed: HTTP {resp.status_code}: {resp.text[:300]}"
            )

        data = (
            resp.json()
            if "application/json" in str(resp.headers.get("content-type", ""))
            else {}
        )
        continue_url = ""
        if isinstance(data, dict):
            continue_url = str(data.get("continue_url") or "").strip()

        if continue_url:
            log.info("Loading consent page: %s", continue_url[:120])
            consent_resp = await self._session.get(continue_url, timeout=15)
            final_url = str(consent_resp.url or continue_url)

            if "/error" in final_url:
                import base64

                parsed_url = urllib.parse.urlparse(final_url)
                qs = urllib.parse.parse_qs(parsed_url.query)
                payload = (qs.get("payload") or [""])[0]
                error_detail = ""
                if payload:
                    try:
                        error_detail = base64.b64decode(payload + "==").decode(
                            "utf-8", errors="replace"
                        )
                    except Exception:
                        error_detail = payload[:200]
                raise OAuthError(
                    f"Auth error after workspace select: {error_detail or final_url}"
                )

            consent_html = consent_resp.text or ""

            import re

            code_match = re.search(
                r'name=["\']authorization_code["\'][^>]*value=["\']([^"\']+)',
                consent_html,
            )
            if not code_match:
                code_match = re.search(
                    r'value=["\']([^"\']+)["\'][^>]*name=["\']authorization_code',
                    consent_html,
                )
            if code_match:
                self._authorization_code = code_match.group(1)
                log.info(
                    "  Captured authorization_code from consent page: %s...",
                    self._authorization_code[:30],
                )

            state_match = re.search(
                r'name=["\']state["\'][^>]*value=["\']([^"\']+)', consent_html
            )
            if not state_match:
                state_match = re.search(
                    r'value=["\']([^"\']+)["\'][^>]*name=["\']state', consent_html
                )
            if state_match:
                self._state = state_match.group(1)
                log.info("  Captured state from consent page: %s...", self._state[:30])

    async def authorize_device(self) -> dict[str, str]:
        """Step 9: POST /api/accounts/deviceauth/authorize_codex with device code grant."""
        log.info("Authorizing device code...")

        user_code_text = self.user_code.replace("-", "")
        characters = {f"character_{i + 1}": c for i, c in enumerate(user_code_text)}

        form_data = {
            "user_code": self.user_code,
            "user_code_text": user_code_text,
            **characters,
            "decision": "grant",
            "device_code": self.device_code,
        }

        if self._authorization_code:
            form_data["authorization_code"] = self._authorization_code
        if self._state:
            form_data["state"] = self._state

        start = time.monotonic()
        resp = await self._session.post(
            "https://auth.openai.com/api/accounts/deviceauth/authorize_codex",
            headers={
                "referer": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                "content-type": "application/x-www-form-urlencoded",
                "traceparent": _traceparent(),
            },
            data=urllib.parse.urlencode(form_data),
            timeout=15,
            allow_redirects=False,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "deviceauth/authorize_codex")

        location = resp.headers.get("Location") or ""
        callback_url = ""
        if location:
            log.info("  Redirect: %s", location[:120])

            if "/error" in location:
                import base64

                parsed_loc = urllib.parse.urlparse(location)
                qs = urllib.parse.parse_qs(parsed_loc.query)
                payload = (qs.get("payload") or [""])[0]
                error_detail = ""
                if payload:
                    try:
                        error_detail = base64.b64decode(payload + "==").decode(
                            "utf-8", errors="replace"
                        )
                    except Exception:
                        error_detail = payload[:200]
                raise OAuthError(
                    f"Device authorization failed: {error_detail or location}"
                )

            callback_url = location

            current_url = location
            for hop in range(6):
                if "deviceauth/callback" in current_url:
                    callback_url = current_url
                    break
                follow_resp = await self._session.get(
                    current_url, allow_redirects=False, timeout=15
                )
                next_loc = follow_resp.headers.get("Location") or ""
                if not next_loc or follow_resp.status_code not in (
                    301,
                    302,
                    303,
                    307,
                    308,
                ):
                    break
                log.info(
                    "  Hop %d: HTTP %d → %s",
                    hop + 1,
                    follow_resp.status_code,
                    next_loc[:120],
                )
                current_url = next_loc

        result = {
            "status": "success" if resp.status_code in (200, 302) else "error",
            "callback_url": callback_url,
            "status_code": str(resp.status_code),
        }

        if resp.status_code == 200:
            try:
                result.update(resp.json())
            except Exception:
                pass

        log.info("  Device authorization result: %s", result.get("status"))
        return result

    def cookies(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for cookie in self._session.cookies.jar:
            key = f"{cookie.name}@{cookie.domain}"
            result[key] = cookie.value or ""
        return result

    async def close(self) -> None:
        await self._session.close()

    async def __aenter__(self) -> "DeviceCodeSession":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
