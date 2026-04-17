import asyncio
import json
import logging
import re
import secrets
import time
import urllib.parse
import uuid
from collections.abc import Awaitable, Callable

from curl_cffi.requests import AsyncSession

from exceptions import RegionBlockedError, RegistrationError, SentinelError
from models import ProxyConfig
import oauth
import sentinel_pow

log = logging.getLogger(__name__)

BLOCKED_REGIONS = {"CN"}
SENTINEL_URL = "https://sentinel.openai.com/backend-api/sentinel/req"
SENTINEL_REFERER = (
    "https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6"
)

BROWSER_PROFILES = [
    "edge99",
    "edge101",
    "chrome99",
    "chrome100",
    "chrome101",
    "chrome104",
    "chrome107",
    "chrome110",
    "chrome116",
    "chrome119",
    "chrome120",
    "chrome123",
    "chrome124",
    "chrome131",
    "chrome133a",
    "chrome136",
    "chrome142",
    "safari153",
    "safari155",
    "safari170",
    "safari180",
    "safari184",
    "safari260",
    "safari2601",
    "firefox133",
    "firefox135",
    "firefox144",
    "safari15_3",
    "safari15_5",
    "safari17_0",
    "safari17_2_ios",
    "safari18_0",
]


def _pick_browser() -> str:
    profile = secrets.choice(BROWSER_PROFILES)
    log.info("  Browser fingerprint: %s", profile)
    return profile


def _log_response(resp: object, elapsed: float, label: str) -> None:
    from curl_cffi.requests import Response

    if not isinstance(resp, Response):
        return
    log.info("  %s  |  HTTP %d  |  %.1fs", label, resp.status_code, elapsed)
    body = resp.text[:1000] if resp.text else "(empty)"
    log.info("  Body: %s", body)


async def _check_region(session: AsyncSession) -> str:
    log.info("[1/8] Checking IP region...")
    start = time.monotonic()
    resp = await session.get("https://cloudflare.com/cdn-cgi/trace", timeout=10)
    elapsed = time.monotonic() - start
    match = re.search(r"^loc=(.+)$", resp.text, re.MULTILINE)
    loc = match.group(1).strip() if match else "UNKNOWN"
    ip_match = re.search(r"^ip=(.+)$", resp.text, re.MULTILINE)
    ip_addr = ip_match.group(1).strip() if ip_match else "unknown"
    if loc in BLOCKED_REGIONS:
        log.error("  Region %s is blocked (IP: %s)", loc, ip_addr)
        raise RegionBlockedError(f"IP region {loc} is blocked — check your proxy")
    log.info("  Region: %s  |  IP: %s  |  %.1fs", loc, ip_addr, elapsed)
    return loc


async def _get_sentinel_token(
    session: AsyncSession, device_id: str, flow: str, tz_name: str = "random"
) -> str:
    log.debug("  Fetching sentinel token (flow=%s)...", flow)
    user_agent = session.headers.get("User-Agent") or "Mozilla/5.0"
    pow_token = sentinel_pow.build_token(str(user_agent), tz_name=tz_name)
    log.debug("  PoW token generated: %s...%s", pow_token[:20], pow_token[-6:])
    start = time.monotonic()
    body = json.dumps({"p": pow_token, "id": device_id, "flow": flow})
    resp = await session.post(
        SENTINEL_URL,
        headers={
            "origin": "https://sentinel.openai.com",
            "referer": SENTINEL_REFERER,
            "content-type": "text/plain;charset=UTF-8",
        },
        data=body,
        timeout=15,
    )
    elapsed = time.monotonic() - start
    if resp.status_code != 200:
        log.error(
            "  Sentinel failed (flow=%s)  |  HTTP %d  |  %.1fs",
            flow,
            resp.status_code,
            elapsed,
        )
        raise SentinelError(
            f"Sentinel challenge failed (flow={flow}): HTTP {resp.status_code}"
        )
    _log_response(resp, elapsed, f"Sentinel (flow={flow})")
    data = resp.json()
    if not isinstance(data, dict):
        raise SentinelError(f"Sentinel returned non-dict response (flow={flow})")
    token = data.get("token")
    if not isinstance(token, str) or not token:
        raise SentinelError(f"Sentinel response missing token (flow={flow})")
    return token


def _build_sentinel_header(sentinel_token: str, device_id: str, flow: str) -> str:
    return json.dumps(
        {
            "p": "",
            "t": "",
            "c": sentinel_token,
            "id": device_id,
            "flow": flow,
        }
    )


type OTPProvider = Callable[[str], Awaitable[str]]
type PasswordProvider = Callable[[], Awaitable[str]]

OTP_MAX_ATTEMPTS = 5
OTP_TIMEOUT_SECONDS = 300


class RegistrationSession:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self.email = ""
        self._region = ""
        self._tz_name = "random"
        self._device_id = str(uuid.uuid4())
        self._auth_session_id = str(uuid.uuid4())
        self._csrf_token = ""
        self._page_type = ""
        self._sentinel_header = ""
        self._so_header = ""
        self._skip_otp = False

    @classmethod
    async def create(
        cls,
        *,
        impersonate: str = "",
        proxy: ProxyConfig | None = None,
    ) -> "RegistrationSession":
        profile = impersonate or _pick_browser()
        proxies = proxy.as_proxy_spec() if proxy else None
        session = AsyncSession(proxies=proxies, impersonate=profile)
        return cls(session)

    @property
    def page_type(self) -> str:
        return self._page_type

    @property
    def inner_session(self) -> AsyncSession:
        return self._session

    async def check_region(self) -> str:
        self._region = await _check_region(self._session)
        self._tz_name = sentinel_pow.tz_from_country(self._region)
        return self._region

    async def get_csrf(self) -> str:
        log.info("Getting CSRF token...")
        start = time.monotonic()
        resp = await self._session.get("https://chatgpt.com/api/auth/csrf", timeout=15)
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "CSRF")
        data = resp.json()
        if not isinstance(data, dict):
            raise RegistrationError("CSRF response is not a dict")
        self._csrf_token = str(data.get("csrfToken") or "").strip()
        if not self._csrf_token:
            raise RegistrationError("CSRF token not found")
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
                "screen_hint": "login_or_signup",
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
            raise RegistrationError("Signin response is not a dict")
        authorize_url = str(signin_data.get("url") or "").strip()
        if not authorize_url:
            raise RegistrationError("Signin response missing authorize URL")
        log.info("  Authorize URL: %s", authorize_url[:120])

        start = time.monotonic()
        auth_resp = await self._session.get(authorize_url, timeout=15)
        elapsed = time.monotonic() - start
        _log_response(auth_resp, elapsed, "Authorize")
        final_url = str(auth_resp.url)
        log.info("  Landed on: %s", final_url[:120])
        return final_url

    async def submit_email(self) -> str:
        log.info("Fetching sentinel tokens...")
        start = time.monotonic()
        sentinel_token = await _get_sentinel_token(
            self._session,
            self._device_id,
            "authorize_continue",
            tz_name=self._tz_name,
        )
        so_token_raw = await _get_sentinel_token(
            self._session,
            self._device_id,
            "oauth_create_account",
            tz_name=self._tz_name,
        )
        elapsed = time.monotonic() - start
        log.info("  Both sentinel tokens acquired  |  %.1fs", elapsed)

        self._sentinel_header = _build_sentinel_header(
            sentinel_token, self._device_id, "authorize_continue"
        )
        self._so_header = _build_sentinel_header(
            so_token_raw, self._device_id, "oauth_create_account"
        )

        log.info("Submitting email via authorize/continue...")
        start = time.monotonic()
        resp = await self._session.post(
            "https://auth.openai.com/api/accounts/authorize/continue",
            headers={
                "referer": "https://auth.openai.com/create-account",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": self._sentinel_header,
            },
            data=json.dumps(
                {
                    "username": {"value": self.email, "kind": "email"},
                    "screen_hint": "signup",
                }
            ),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "authorize/continue")
        if resp.status_code != 200:
            raise RegistrationError(
                f"authorize/continue failed: HTTP {resp.status_code}: {resp.text[:200]}"
            )

        resp_data = resp.json()
        self._page_type = ""
        if isinstance(resp_data, dict):
            page_info = resp_data.get("page")
            if isinstance(page_info, dict):
                self._page_type = str(page_info.get("type") or "")
        log.info("  Page type: %s", self._page_type)
        return self._page_type

    async def set_password(
        self,
        password_provider: PasswordProvider,
        *,
        timeout: float = 120,
    ) -> None:
        try:
            password = await asyncio.wait_for(password_provider(), timeout=timeout)
        except TimeoutError:
            raise RegistrationError(f"Password provider timed out after {timeout}s")

        password = password.strip()
        if not password:
            raise RegistrationError("No password provided")

        if self._page_type == "email_otp_verification":
            log.info("Existing account — OTP already sent")
            self._skip_otp = False
            return

        if self._page_type == "login_password":
            log.info("Existing account — verifying password...")
            start = time.monotonic()
            resp = await self._session.post(
                "https://auth.openai.com/api/accounts/password/verify",
                headers={
                    "referer": "https://auth.openai.com/log-in/password",
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                data=json.dumps({"password": password}),
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(resp, elapsed, "Password verify")
            if resp.status_code != 200:
                raise RegistrationError(
                    f"Password verify failed: HTTP {resp.status_code}: {resp.text[:200]}"
                )
            resp_data = resp.json()
            verify_page_type = ""
            if isinstance(resp_data, dict):
                vp = resp_data.get("page")
                if isinstance(vp, dict):
                    verify_page_type = str(vp.get("type") or "")
                continue_url = str(resp_data.get("continue_url") or "").strip()
                if (
                    continue_url
                    and "about-you" not in continue_url
                    and "email" not in continue_url
                ):
                    log.info("  Following continue_url: %s", continue_url)
                    start = time.monotonic()
                    await self._session.get(continue_url, timeout=15)
                    elapsed = time.monotonic() - start
                    log.info("  Verify continue  |  %.1fs", elapsed)

            if verify_page_type == "email_otp_verification":
                self._skip_otp = False
            else:
                self._skip_otp = "about-you" in str(resp_data.get("continue_url") or "")
            return

        log.info("New account — registering with password...")
        start = time.monotonic()
        resp = await self._session.post(
            "https://auth.openai.com/api/accounts/user/register",
            headers={
                "referer": "https://auth.openai.com/create-account/password",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": self._sentinel_header,
            },
            data=json.dumps({"username": self.email, "password": password}),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "Password register")
        if resp.status_code != 200:
            raise RegistrationError(
                f"Password registration failed: HTTP {resp.status_code}: {resp.text[:200]}"
            )
        self._skip_otp = False

    async def verify_otp(
        self,
        otp_provider: OTPProvider,
        *,
        timeout: float = OTP_TIMEOUT_SECONDS,
        max_attempts: int = OTP_MAX_ATTEMPTS,
    ) -> None:
        if self._skip_otp:
            log.info("OTP skipped — email already verified")
            return

        log.info("Triggering OTP email...")
        start = time.monotonic()
        await self._session.get(
            "https://auth.openai.com/api/accounts/email-otp/send",
            headers={
                "referer": "https://auth.openai.com/create-account/password",
                "accept": "application/json",
            },
            timeout=15,
        )
        elapsed = time.monotonic() - start
        log.info("  OTP send  |  %.1fs", elapsed)

        log.info(
            "Waiting for OTP (timeout=%ds, max_attempts=%d)...",
            timeout,
            max_attempts,
        )
        last_otp = ""
        for attempt in range(1, max_attempts + 1):
            try:
                otp = await asyncio.wait_for(otp_provider(self.email), timeout=timeout)
            except TimeoutError:
                raise RegistrationError(f"OTP provider timed out after {timeout}s")

            otp = otp.strip()
            if not otp:
                raise RegistrationError("OTP provider returned empty code")

            if otp == last_otp:
                log.info("  Same OTP as last attempt, waiting 60s for new code...")
                await asyncio.sleep(60)
                continue

            log.info("  Attempt %d: validating OTP %s", attempt, otp)
            start = time.monotonic()
            resp = await self._session.post(
                "https://auth.openai.com/api/accounts/email-otp/validate",
                headers={
                    "referer": "https://auth.openai.com/email-verification",
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                data=json.dumps({"code": otp}),
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(resp, elapsed, "OTP validate")
            if resp.status_code == 200:
                log.info("  OTP validated successfully")
                return
            log.warning(
                "  OTP invalid (attempt %d/%d), waiting 60s...", attempt, max_attempts
            )
            last_otp = otp
            await asyncio.sleep(60)

        raise RegistrationError(f"OTP validation failed after {max_attempts} attempts")

    async def create_account(self, name: str, birthdate: str) -> dict[str, object]:
        clean_name = name.encode("ascii", errors="ignore").decode("ascii").strip()
        if not clean_name:
            clean_name = "Neo"

        log.info("Creating account (name=%s, birthdate=%s)...", clean_name, birthdate)
        start = time.monotonic()
        resp = await self._session.post(
            "https://auth.openai.com/api/accounts/create_account",
            headers={
                "referer": "https://auth.openai.com/about-you",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": self._sentinel_header,
                "openai-sentinel-so-token": self._so_header,
            },
            data=json.dumps({"name": clean_name, "birthdate": birthdate}),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp, elapsed, "Create account")
        if resp.status_code != 200:
            raise RegistrationError(
                f"Account creation failed: HTTP {resp.status_code}: {resp.text[:200]}"
            )

        create_data = resp.json()
        continue_url = ""
        if isinstance(create_data, dict):
            continue_url = str(create_data.get("continue_url") or "").strip()

        if continue_url:
            await self._follow_auth_redirects(continue_url)

        return create_data if isinstance(create_data, dict) else {}

    async def _follow_auth_redirects(self, start_url: str) -> None:
        log.info("  Following auth redirect chain from: %s", start_url[:120])
        current_url = start_url
        for hop in range(10):
            if "api/auth/callback" in current_url:
                log.info(
                    "  Hop %d: Callback URL found, following with redirects...",
                    hop + 1,
                )
                start = time.monotonic()
                callback_resp = await self._session.get(current_url, timeout=30)
                elapsed = time.monotonic() - start
                log.info(
                    "  Callback complete  |  HTTP %d  |  %.1fs  |  %s",
                    callback_resp.status_code,
                    elapsed,
                    str(callback_resp.url)[:120],
                )
                break

            start = time.monotonic()
            hop_resp = await self._session.get(
                current_url, allow_redirects=False, timeout=15
            )
            elapsed = time.monotonic() - start
            location = hop_resp.headers.get("Location") or ""
            log.info(
                "  Hop %d: HTTP %d → %s",
                hop + 1,
                hop_resp.status_code,
                location[:120] if location else "(no redirect)",
            )
            if hop_resp.status_code not in (301, 302, 303, 307, 308) or not location:
                break
            current_url = (
                location
                if location.startswith("http")
                else f"https://chatgpt.com{location}"
            )

    async def establish_session(self) -> dict[str, object]:
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

    async def __aenter__(self) -> "RegistrationSession":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()


async def get_notification_settings(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/notifications/settings",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "notifications/settings")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_age_settings(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/settings/is_adult",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "settings/is_adult")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_granular_consent(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/user_granular_consent",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "user_granular_consent")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def set_granular_consent(
    session: AsyncSession, *, analytics: bool = True, marketing: bool = True
) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.post(
        "https://chatgpt.com/backend-api/user_granular_consent",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        data=json.dumps(
            {"granular_consent": {"analytics": analytics, "marketing": marketing}}
        ),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "POST user_granular_consent")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_me(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/me",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "backend-api/me")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_account_info(
    session: AsyncSession, timezone_offset_min: int = -540
) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        f"https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min={timezone_offset_min}",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "accounts/check")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_codex_quota(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/wham/usage",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "wham/usage")
    data = resp.json()
    if not isinstance(data, dict):
        return {}

    _log_quota_summary(data)
    return data


def _log_quota_summary(data: dict[str, object]) -> None:
    email = data.get("email") or "unknown"
    plan = data.get("plan_type") or "unknown"
    log.info("  Codex quota for %s (%s plan)", email, plan)

    rate_limit = data.get("rate_limit")
    if isinstance(rate_limit, dict):
        allowed = rate_limit.get("allowed")
        reached = rate_limit.get("limit_reached")
        log.info("  Rate limit: allowed=%s  reached=%s", allowed, reached)

        primary = rate_limit.get("primary_window")
        if isinstance(primary, dict):
            used = primary.get("used_percent", 0)
            reset = primary.get("reset_after_seconds", 0)
            reset_h = int(reset) // 3600 if isinstance(reset, (int, float)) else 0
            log.info("  Weekly limit: %s%% used  |  resets in %dh", used, reset_h)

        secondary = rate_limit.get("secondary_window")
        if isinstance(secondary, dict):
            used = secondary.get("used_percent", 0)
            reset = secondary.get("reset_after_seconds", 0)
            reset_m = int(reset) // 60 if isinstance(reset, (int, float)) else 0
            log.info("  5-hour limit: %s%% used  |  resets in %dm", used, reset_m)

    credits_info = data.get("credits")
    if isinstance(credits_info, dict):
        has = credits_info.get("has_credits")
        unlimited = credits_info.get("unlimited")
        log.info("  Credits: has=%s  unlimited=%s", has, unlimited)

    promo = data.get("promo")
    if isinstance(promo, dict) and promo.get("message"):
        log.info("  Promo: %s", promo["message"])


async def get_user_settings(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/settings/user",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "settings/user")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_account_settings(
    session: AsyncSession, account_id: str
) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        f"https://chatgpt.com/backend-api/accounts/{account_id}/settings",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, f"accounts/{account_id}/settings")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_identity(session: AsyncSession, account_id: str) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        f"https://chatgpt.com/backend-api/accounts/{account_id}/identity",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, f"accounts/{account_id}/identity")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_subscriptions(
    session: AsyncSession, account_id: str
) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        f"https://chatgpt.com/backend-api/subscriptions?account_id={account_id}",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "subscriptions")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def get_user_segments(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.get(
        "https://chatgpt.com/backend-api/user_segments",
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "user_segments")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def mark_announcement_viewed(
    session: AsyncSession, announcement_id: str
) -> dict[str, object]:
    clean_id = announcement_id.encode("ascii", errors="ignore").decode("ascii").strip()
    if not clean_id:
        return {}
    encoded_id = urllib.parse.quote(clean_id, safe="")
    start = time.monotonic()
    resp = await session.post(
        f"https://chatgpt.com/backend-api/settings/announcement_viewed?announcement_id={encoded_id}",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, f"announcement_viewed ({announcement_id})")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def set_onboarding_interests(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.post(
        "https://chatgpt.com/backend-api/onboarding/interests/profile",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        data=json.dumps({"main_usages": [], "interests": []}),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "onboarding/interests/profile")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def init_conversation(
    session: AsyncSession, timezone_offset_min: int = -540
) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.post(
        "https://chatgpt.com/backend-api/conversation/init",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        data=json.dumps(
            {
                "gizmo_id": None,
                "requested_default_model": None,
                "conversation_id": None,
                "timezone_offset_min": timezone_offset_min,
            }
        ),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "conversation/init")
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def list_connectors(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    resp = await session.post(
        "https://chatgpt.com/backend-api/aip/connectors/list_accessible?skip_actions=true&external_logos=true",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        data=json.dumps({"principals": []}),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(resp, elapsed, "connectors/list_accessible")
    data = resp.json()
    return data if isinstance(data, dict) else {}


ANNOUNCEMENT_IDS = [
    "oai/apps/hasSeenPioneer",
    "oai/apps/hasSeenSeeker",
    "oai/apps/hasSeenMaverick",
    "oai/apps/hasSeenMaverickCapi",
    "oai/apps/hasSeenTrailBlazer",
    "oai/apps/hasSeenStratos",
    "oai/apps/hasSeenWayfinder",
    "oai/apps/hasSeenOnboardingFlow",
    "oai/apps/hasSeenOnboarding",
]


async def register_flow(session: AsyncSession) -> dict[str, object]:
    log.info("Running post-registration setup flow...")
    results: dict[str, object] = {}

    if not session.headers.get("Authorization"):
        log.info("  Fetching access token from auth/session...")
        start = time.monotonic()
        auth_session_resp = await session.get(
            "https://chatgpt.com/api/auth/session",
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(auth_session_resp, elapsed, "auth/session")
        auth_data = auth_session_resp.json()
        if isinstance(auth_data, dict):
            access_token = str(auth_data.get("accessToken") or "").strip()
            if access_token:
                session.headers.update({"Authorization": f"Bearer {access_token}"})
                log.info("  Access token set")

    results["consent_get"] = await get_granular_consent(session)
    results["user_settings"] = await get_user_settings(session)
    results["user_segments"] = await get_user_segments(session)

    results["consent_set"] = await set_granular_consent(session)

    for aid in ANNOUNCEMENT_IDS:
        await mark_announcement_viewed(session, aid)
    log.info("  Marked %d announcements as viewed", len(ANNOUNCEMENT_IDS))

    results["onboarding"] = await set_onboarding_interests(session)
    results["conv_init"] = await init_conversation(session)
    results["connectors"] = await list_connectors(session)

    log.info("Post-registration setup flow complete")
    return results


async def codex_oauth(session: AsyncSession) -> dict[str, object]:
    start = time.monotonic()
    log.info("Starting Codex OAuth token exchange...")

    session_token = (
        session.cookies.get("__Secure-next-auth.session-token", domain=".chatgpt.com")
        or ""
    )
    if session_token:
        log.info("  Copying session token to auth.openai.com domain...")
        session.cookies.set(
            "__Secure-next-auth.session-token", session_token, domain=".auth.openai.com"
        )

    oauth_start = oauth.generate_oauth_url()

    log.info("  [1] OAuth authorize (establishing auth session)...")
    start = time.monotonic()
    auth_resp = await session.get(oauth_start.auth_url, timeout=15)
    elapsed = time.monotonic() - start
    _log_response(auth_resp, elapsed, "OAuth authorize")

    auth_cookie = session.cookies.get("oai-client-auth-session") or ""
    workspace_id = None
    if auth_cookie:
        cookie_data = oauth.decode_jwt_header(auth_cookie)
        workspaces = cookie_data.get("workspaces")
        if isinstance(workspaces, list) and workspaces:
            first = workspaces[0]
            if isinstance(first, dict) and "id" in first:
                workspace_id = str(first["id"])

    if not workspace_id:
        log.info("  Workspace not in cookie, fetching from accounts/check...")
        account_data = await get_account_info(session, -540)
        account_id_list = account_data.get("account_ordering")
        if isinstance(account_id_list, list) and account_id_list:
            workspace_id = str(account_id_list[0])
            log.info("  Workspace ID (from account): %s", workspace_id)
        else:
            log.error("  Cannot find workspace/account ID")
            return {}
    else:
        log.info("  Workspace ID: %s", workspace_id)

    log.info("  Selecting workspace...")
    start = time.monotonic()
    select_resp = await session.post(
        "https://auth.openai.com/api/accounts/workspace/select",
        headers={
            "referer": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "content-type": "application/json",
        },
        data=json.dumps({"workspace_id": workspace_id}),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(select_resp, elapsed, "Workspace select")
    if select_resp.status_code != 200:
        log.error("  Workspace select failed: HTTP %d", select_resp.status_code)
        return {}

    content_type = str(select_resp.headers.get("content-type") or "")
    if "application/json" not in content_type:
        log.error("  Workspace select returned non-JSON (got %s)", content_type)
        log.error("  Full response:\n%s", select_resp.text)
        return {}

    try:
        select_data = select_resp.json()
    except Exception:
        log.error("  Failed to parse workspace select response")
        return {}
    continue_url = ""
    if isinstance(select_data, dict):
        continue_url = str(select_data.get("continue_url") or "").strip()
    if not continue_url:
        log.error("  Missing continue_url from workspace select")
        return {}

    log.info("  Following redirects for callback...")
    current_url = continue_url
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
            token_config = await oauth.exchange_code_for_token(
                session,
                callback_url=location,
                expected_state=oauth_start.state,
                code_verifier=oauth_start.code_verifier,
                redirect_uri=oauth_start.redirect_uri,
            )
            now = int(time.time())
            result: dict[str, object] = {
                "email": token_config.email,
                "type": "codex",
                "access_token": token_config.access_token,
                "refresh_token": token_config.refresh_token,
                "id_token": token_config.id_token,
                "account_id": token_config.account_id,
                "expires_in": token_config.expires_in,
                "expires_at": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(now + max(token_config.expires_in, 0)),
                ),
                "token_json": token_config.to_json(),
            }
            log.info(
                "  Codex OAuth complete  |  email=%s  |  account_id=%s",
                token_config.email,
                token_config.account_id,
            )
            return result

        current_url = location

    log.error("  Failed to capture callback URL")
    return {}


async def __deprecated_codex_oauth(session: AsyncSession) -> dict[str, object]:
    log.info("Starting Codex OAuth token exchange...")

    oauth_start = oauth.generate_oauth_url()

    log.info("  [1] OAuth authorize...")
    start = time.monotonic()
    auth_resp = await session.get(oauth_start.auth_url, timeout=15)
    elapsed = time.monotonic() - start
    _log_response(auth_resp, elapsed, "OAuth authorize")

    device_id = session.cookies.get("oai-did", domain="auth.openai.com") or str(
        uuid.uuid4()
    )
    log.info("  Device ID: %s", device_id)

    log.info("  [2] Sentinel PoW...")
    sentinel_token = await _get_sentinel_token(session, device_id, "authorize_continue")
    sentinel_header = _build_sentinel_header(
        sentinel_token, device_id, "authorize_continue"
    )

    final_url = str(auth_resp.url)
    log.info("  Landed on: %s", final_url[:120])

    if "log-in" in final_url or "create-account" in final_url:
        log.info("  [3] Submitting email via authorize/continue...")
        email = input("\n  Email: ").strip()
        if not email:
            log.error("  Email required")
            return {}

        start = time.monotonic()
        signup_resp = await session.post(
            "https://auth.openai.com/api/accounts/authorize/continue",
            headers={
                "referer": "https://auth.openai.com/create-account",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": sentinel_header,
            },
            data=json.dumps(
                {"username": {"value": email, "kind": "email"}, "screen_hint": "login"}
            ),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(resp=signup_resp, elapsed=elapsed, label="authorize/continue")

        signup_data = signup_resp.json() if isinstance(signup_resp.json(), dict) else {}
        page_type = ""
        if isinstance(signup_data, dict):
            page_info = signup_data.get("page")
            if isinstance(page_info, dict):
                page_type = str(page_info.get("type") or "")
        log.info("  Page type: %s", page_type)

        if page_type == "login_password":
            password = input("  Password: ").strip()
            if not password:
                log.error("  Password required")
                return {}
            start = time.monotonic()
            pwd_resp = await session.post(
                "https://auth.openai.com/api/accounts/password/verify",
                headers={
                    "referer": "https://auth.openai.com/log-in/password",
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                data=json.dumps({"password": password}),
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(pwd_resp, elapsed, "Password verify")
            if pwd_resp.status_code != 200:
                log.error("  Password verify failed")
                return {}

            pwd_data = pwd_resp.json()
            pwd_page_type = ""
            if isinstance(pwd_data, dict):
                pwd_page_info = pwd_data.get("page")
                if isinstance(pwd_page_info, dict):
                    pwd_page_type = str(pwd_page_info.get("type") or "")

            if pwd_page_type == "email_otp_verification":
                log.info("  Password verified, OTP required...")
                while True:
                    otp = input("  OTP code: ").strip()
                    if not otp:
                        log.error("  OTP required")
                        return {}
                    start = time.monotonic()
                    otp_resp = await session.post(
                        "https://auth.openai.com/api/accounts/email-otp/validate",
                        headers={
                            "referer": "https://auth.openai.com/email-verification",
                            "accept": "application/json",
                            "content-type": "application/json",
                        },
                        data=json.dumps({"code": otp}),
                        timeout=15,
                    )
                    elapsed = time.monotonic() - start
                    _log_response(otp_resp, elapsed, "OTP validate")
                    if otp_resp.status_code == 200:
                        break
                    log.warning("  Wrong OTP code, try again")

        elif page_type == "email_otp_verification":
            while True:
                otp = input("  OTP code: ").strip()
                if not otp:
                    log.error("  OTP required")
                    return {}
                start = time.monotonic()
                otp_resp = await session.post(
                    "https://auth.openai.com/api/accounts/email-otp/validate",
                    headers={
                        "referer": "https://auth.openai.com/email-verification",
                        "accept": "application/json",
                        "content-type": "application/json",
                    },
                    data=json.dumps({"code": otp}),
                    timeout=15,
                )
                elapsed = time.monotonic() - start
                _log_response(otp_resp, elapsed, "OTP validate")
                if otp_resp.status_code == 200:
                    break
                log.warning("  Wrong OTP code, try again")

    log.info("  [4] Workspace select + token exchange...")
    auth_cookie = (
        session.cookies.get("oai-client-auth-session", domain="auth.openai.com") or ""
    )
    if not auth_cookie:
        log.error("  Missing oai-client-auth-session cookie")
        return {}

    try:
        cookie_data = oauth.decode_jwt_header(auth_cookie)
        workspaces = cookie_data.get("workspaces")
        if not isinstance(workspaces, list) or not workspaces:
            raise ValueError("no workspaces")
        first = workspaces[0]
        workspace_id = first["id"] if isinstance(first, dict) else None
    except Exception as exc:
        log.error("  Workspace parsing failed: %s", exc)
        return {}

    if not workspace_id:
        log.error("  No workspace_id found")
        return {}

    log.info("  Workspace ID: %s", workspace_id)
    start = time.monotonic()
    select_resp = await session.post(
        "https://auth.openai.com/api/accounts/workspace/select",
        headers={
            "referer": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "content-type": "application/json",
        },
        data=json.dumps({"workspace_id": workspace_id}),
        timeout=15,
    )
    elapsed = time.monotonic() - start
    _log_response(select_resp, elapsed, "Workspace select")
    if select_resp.status_code != 200:
        log.error("  Workspace select failed")
        return {}

    select_data = select_resp.json()
    continue_url = ""
    if isinstance(select_data, dict):
        continue_url = str(select_data.get("continue_url") or "").strip()
    if not continue_url:
        log.error("  Missing continue_url")
        return {}

    log.info("  [5] Following redirects for callback...")
    current_url = continue_url
    for hop in range(12):
        start = time.monotonic()
        resp = await session.get(current_url, allow_redirects=False, timeout=15)
        elapsed = time.monotonic() - start
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
            token_config = await oauth.exchange_code_for_token(
                session,
                callback_url=location,
                expected_state=oauth_start.state,
                code_verifier=oauth_start.code_verifier,
                redirect_uri=oauth_start.redirect_uri,
            )
            now = int(time.time())
            result: dict[str, object] = {
                "email": token_config.email,
                "type": "codex",
                "access_token": token_config.access_token,
                "refresh_token": token_config.refresh_token,
                "id_token": token_config.id_token,
                "account_id": token_config.account_id,
                "expires_in": token_config.expires_in,
                "expires_at": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(now + max(token_config.expires_in, 0)),
                ),
                "token_json": token_config.to_json(),
            }
            log.info(
                "  Codex OAuth complete  |  email=%s  |  account_id=%s",
                token_config.email,
                token_config.account_id,
            )
            return result

        current_url = location

    log.error("  Failed to capture callback URL")
    return {}
