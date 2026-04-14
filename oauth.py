import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.parse

from curl_cffi.requests import AsyncSession

from exceptions import CallbackParseError, TokenExchangeError
from models import OAuthStart, TokenConfig

log = logging.getLogger(__name__)

AUTH_URL = "https://auth.openai.com/oauth/authorize"
TOKEN_URL = "https://auth.openai.com/oauth/token"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback"
DEFAULT_SCOPE = "openid email profile offline_access"


def _b64url_no_pad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _sha256_b64url(s: str) -> str:
    return _b64url_no_pad(hashlib.sha256(s.encode("ascii")).digest())


def _decode_jwt_segment(segment: str) -> dict[str, object]:
    raw = (segment or "").strip()
    if not raw:
        return {}
    pad = "=" * ((4 - len(raw) % 4) % 4)
    try:
        result = json.loads(base64.urlsafe_b64decode((raw + pad).encode("ascii")))
        if isinstance(result, dict):
            return result
        return {}
    except Exception:
        return {}


def jwt_claims_no_verify(id_token: str) -> dict[str, object]:
    if not id_token or id_token.count(".") < 2:
        return {}
    return _decode_jwt_segment(id_token.split(".")[1])


def decode_jwt_header(token: str) -> dict[str, object]:
    if not token or "." not in token:
        return {}
    return _decode_jwt_segment(token.split(".")[0])


def generate_oauth_url(
    *,
    redirect_uri: str = DEFAULT_REDIRECT_URI,
    scope: str = DEFAULT_SCOPE,
) -> OAuthStart:
    state = secrets.token_urlsafe(16)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = _sha256_b64url(code_verifier)

    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "login",
        "id_token_add_organizations": "true",
        "codex_cli_simplified_flow": "true",
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    return OAuthStart(
        auth_url=auth_url,
        state=state,
        code_verifier=code_verifier,
        redirect_uri=redirect_uri,
    )


def parse_callback_url(callback_url: str) -> dict[str, str]:
    candidate = callback_url.strip()
    if not candidate:
        return {"code": "", "state": "", "error": "", "error_description": ""}

    if "://" not in candidate:
        if candidate.startswith("?"):
            candidate = f"http://localhost{candidate}"
        elif any(ch in candidate for ch in "/?#") or ":" in candidate:
            candidate = f"http://{candidate}"
        elif "=" in candidate:
            candidate = f"http://localhost/?{candidate}"

    parsed = urllib.parse.urlparse(candidate)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    fragment = urllib.parse.parse_qs(parsed.fragment, keep_blank_values=True)

    for key, values in fragment.items():
        if key not in query or not query[key] or not (query[key][0] or "").strip():
            query[key] = values

    def _first(k: str) -> str:
        v = query.get(k, [""])
        return (v[0] or "").strip()

    code = _first("code")
    state = _first("state")
    error = _first("error")
    error_description = _first("error_description")

    if code and not state and "#" in code:
        code, state = code.split("#", 1)
    if not error and error_description:
        error, error_description = error_description, ""

    return {
        "code": code,
        "state": state,
        "error": error,
        "error_description": error_description,
    }


async def exchange_code_for_token(
    session: AsyncSession,
    *,
    callback_url: str,
    expected_state: str,
    code_verifier: str,
    redirect_uri: str = DEFAULT_REDIRECT_URI,
) -> TokenConfig:
    cb = parse_callback_url(callback_url)

    if cb["error"]:
        log.error(
            "  OAuth callback error: %s — %s", cb["error"], cb["error_description"]
        )
        raise CallbackParseError(
            f"OAuth error: {cb['error']}: {cb['error_description']}".strip()
        )
    if not cb["code"]:
        raise CallbackParseError("Callback URL missing ?code=")
    if not cb["state"]:
        raise CallbackParseError("Callback URL missing ?state=")
    if cb["state"] != expected_state:
        raise CallbackParseError("OAuth state mismatch")

    log.info("  Exchanging authorization code for tokens...")
    log.debug("  Auth code: %s...%s", cb["code"][:8], cb["code"][-4:])
    start = time.monotonic()
    resp = await session.post(
        TOKEN_URL,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data=urllib.parse.urlencode(
            {
                "grant_type": "authorization_code",
                "client_id": CLIENT_ID,
                "code": cb["code"],
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            }
        ),
        timeout=30,
    )

    if resp.status_code != 200:
        elapsed = time.monotonic() - start
        log.error(
            "  Token exchange failed  |  HTTP %d  |  %.1fs", resp.status_code, elapsed
        )
        log.error("  Response: %s", resp.text[:300])
        raise TokenExchangeError(
            f"Token exchange failed: HTTP {resp.status_code}: {resp.text}"
        )

    elapsed = time.monotonic() - start
    log.info(
        "  Token exchange successful  |  HTTP %d  |  %.1fs", resp.status_code, elapsed
    )

    token_data = resp.json()
    if not isinstance(token_data, dict):
        raise TokenExchangeError("Token endpoint returned non-dict response")

    claims = jwt_claims_no_verify(str(token_data.get("id_token") or ""))
    raw_auth = claims.get("https://api.openai.com/auth")
    auth_claims = raw_auth if isinstance(raw_auth, dict) else {}

    return TokenConfig(
        id_token=str(token_data.get("id_token") or "").strip(),
        access_token=str(token_data.get("access_token") or "").strip(),
        refresh_token=str(token_data.get("refresh_token") or "").strip(),
        account_id=str(auth_claims.get("chatgpt_account_id") or "").strip(),
        email=str(claims.get("email") or "").strip(),
        expires_in=_to_int(token_data.get("expires_in")),
    )


def _to_int(v: object) -> int:
    if isinstance(v, int):
        return v
    if isinstance(v, (str, float)):
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0
    return 0
