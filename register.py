import json
import logging
import re
import time
import uuid

from curl_cffi.requests import AsyncSession

from exceptions import RegionBlockedError, RegistrationError, SentinelError
from models import ProxyConfig
import oauth

log = logging.getLogger(__name__)

BLOCKED_REGIONS = {"CN", "HK"}
SENTINEL_URL = "https://sentinel.openai.com/backend-api/sentinel/req"
SENTINEL_REFERER = (
    "https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6"
)


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


async def _get_sentinel_token(session: AsyncSession, device_id: str, flow: str) -> str:
    log.debug("  Fetching sentinel token (flow=%s)...", flow)
    start = time.monotonic()
    body = json.dumps({"p": "", "id": device_id, "flow": flow})
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


async def run(proxy: ProxyConfig, email: str) -> dict[str, object]:
    proxies = proxy.as_proxy_spec()
    log.info("Starting registration for %s", email)

    async with AsyncSession(proxies=proxies, impersonate="edge101") as session:
        await _check_region(session)

        device_id = str(uuid.uuid4())
        auth_session_id = str(uuid.uuid4())

        log.info("[2/8] Getting CSRF token...")
        start = time.monotonic()
        csrf_resp = await session.get("https://chatgpt.com/api/auth/csrf", timeout=15)
        elapsed = time.monotonic() - start
        _log_response(csrf_resp, elapsed, "CSRF")
        csrf_data = csrf_resp.json()
        if not isinstance(csrf_data, dict):
            raise RegistrationError("CSRF response is not a dict")
        csrf_token = str(csrf_data.get("csrfToken") or "").strip()
        if not csrf_token:
            raise RegistrationError("CSRF token not found")
        log.info("  CSRF token: %s...%s", csrf_token[:8], csrf_token[-4:])

        log.info("[3/8] Signing in via chatgpt.com...")
        start = time.monotonic()
        signin_resp = await session.post(
            "https://chatgpt.com/api/auth/signin/openai",
            params={
                "prompt": "login",
                "ext-oai-did": device_id,
                "auth_session_logging_id": auth_session_id,
                "ext-passkey-client-capabilities": "1111",
                "screen_hint": "login_or_signup",
                "login_hint": email,
            },
            data=f"callbackUrl=https%3A%2F%2Fchatgpt.com%2F&csrfToken={csrf_token}&json=true",
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
        auth_resp = await session.get(authorize_url, timeout=15)
        elapsed = time.monotonic() - start
        _log_response(auth_resp, elapsed, "Authorize")
        final_url = str(auth_resp.url)
        log.info("  Landed on: %s", final_url[:120])

        is_existing = "log-in" in final_url

        log.info("[4/8] Fetching sentinel tokens...")
        start = time.monotonic()
        sentinel_token = await _get_sentinel_token(
            session, device_id, "authorize_continue"
        )
        so_token_raw = await _get_sentinel_token(
            session, device_id, "oauth_create_account"
        )
        elapsed = time.monotonic() - start
        log.info("  Both sentinel tokens acquired  |  %.1fs", elapsed)

        sentinel_header = _build_sentinel_header(
            sentinel_token, device_id, "authorize_continue"
        )
        so_header = _build_sentinel_header(
            so_token_raw, device_id, "oauth_create_account"
        )

        password = input("\n  Enter password: ").strip()
        if not password:
            raise RegistrationError("No password provided")

        if is_existing:
            log.info("[5/8] Existing account — verifying password...")
            start = time.monotonic()
            resp = await session.post(
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
            continue_url = ""
            if isinstance(resp_data, dict):
                continue_url = str(resp_data.get("continue_url") or "").strip()
            if continue_url:
                log.info("  Following continue_url: %s", continue_url)
                start = time.monotonic()
                follow_resp = await session.get(continue_url, timeout=15)
                elapsed = time.monotonic() - start
                _log_response(follow_resp, elapsed, "Verify continue")
            skip_otp = "about-you" in continue_url
        else:
            log.info("[5/8] Registering with password...")
            start = time.monotonic()
            resp = await session.post(
                "https://auth.openai.com/api/accounts/user/register",
                headers={
                    "referer": "https://auth.openai.com/create-account/password",
                    "accept": "application/json",
                    "content-type": "application/json",
                    "openai-sentinel-token": sentinel_header,
                },
                data=json.dumps({"username": email, "password": password}),
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(resp, elapsed, "Password register")
            if resp.status_code != 200:
                raise RegistrationError(
                    f"Password registration failed: HTTP {resp.status_code}: {resp.text[:200]}"
                )
            skip_otp = False

        if not skip_otp:
            log.info("[6/8] Triggering OTP email...")
            start = time.monotonic()
            otp_send_resp = await session.get(
                "https://auth.openai.com/api/accounts/email-otp/send",
                headers={
                    "referer": "https://auth.openai.com/create-account/password",
                    "accept": "application/json",
                },
                timeout=15,
            )
            elapsed = time.monotonic() - start
            _log_response(otp_send_resp, elapsed, "OTP send")

            otp = input("\n  Enter OTP code from email: ").strip()
            if not otp:
                raise RegistrationError("No OTP code provided")
            log.info("  OTP received: %s", otp)

            log.info("  Validating OTP...")
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
            if otp_resp.status_code != 200:
                raise RegistrationError(
                    f"OTP validation failed: HTTP {otp_resp.status_code}: {otp_resp.text[:200]}"
                )
        else:
            log.info("  OTP skipped — email already verified")

        name = input("\n  Enter name (default: Neo): ").strip() or "Neo"
        name = name.encode("ascii", errors="ignore").decode("ascii").strip()
        if not name:
            name = "Neo"
        birthdate = (
            input("  Enter birthdate YYYY-MM-DD (default: 2000-02-20): ").strip()
            or "2000-02-20"
        )

        log.info("[7/8] Creating account (name=%s, birthdate=%s)...", name, birthdate)
        start = time.monotonic()
        create_resp = await session.post(
            "https://auth.openai.com/api/accounts/create_account",
            headers={
                "referer": "https://auth.openai.com/about-you",
                "accept": "application/json",
                "content-type": "application/json",
                "openai-sentinel-token": sentinel_header,
                "openai-sentinel-so-token": so_header,
            },
            data=json.dumps({"name": name, "birthdate": birthdate}),
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(create_resp, elapsed, "Create account")
        if create_resp.status_code != 200:
            raise RegistrationError(
                f"Account creation failed: HTTP {create_resp.status_code}: {create_resp.text[:200]}"
            )

        create_data = create_resp.json()
        continue_url = ""
        if isinstance(create_data, dict):
            continue_url = str(create_data.get("continue_url") or "").strip()

        if continue_url:
            log.info("  Following auth redirect chain from: %s", continue_url[:120])
            current_url = continue_url
            for hop in range(10):
                if "api/auth/callback" in current_url:
                    log.info(
                        "  Hop %d: Callback URL found, following with redirects...",
                        hop + 1,
                    )
                    start = time.monotonic()
                    callback_resp = await session.get(current_url, timeout=30)
                    elapsed = time.monotonic() - start
                    log.info(
                        "  Callback complete  |  HTTP %d  |  %.1fs  |  %s",
                        callback_resp.status_code,
                        elapsed,
                        str(callback_resp.url)[:120],
                    )
                    break

                start = time.monotonic()
                hop_resp = await session.get(
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
                if (
                    hop_resp.status_code not in (301, 302, 303, 307, 308)
                    or not location
                ):
                    break
                current_url = (
                    location
                    if location.startswith("http")
                    else f"https://chatgpt.com{location}"
                )

        log.info("[8/8] Establishing ChatGPT session...")

        start = time.monotonic()
        session_resp = await session.get(
            "https://chatgpt.com/api/auth/session",
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(session_resp, elapsed, "auth/session")

        start = time.monotonic()
        me_resp = await session.get(
            "https://chatgpt.com/backend-api/me",
            timeout=15,
        )
        elapsed = time.monotonic() - start
        _log_response(me_resp, elapsed, "backend-api/me")

        session_data = session_resp.json()
        me_data = me_resp.json()

        result: dict[str, object] = {}
        if isinstance(session_data, dict):
            result["session"] = session_data
        if isinstance(me_data, dict):
            result["me"] = me_data
            orgs = me_data.get("orgs")
            if isinstance(orgs, dict):
                org_list = orgs.get("data") or []
                if isinstance(org_list, list):
                    for org in org_list:
                        if isinstance(org, dict):
                            log.info(
                                "  Org: id=%s  title=%s  role=%s",
                                org.get("id"),
                                org.get("title"),
                                org.get("role"),
                            )

        return result
