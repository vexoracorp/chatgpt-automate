import asyncio
import hashlib
import json
import logging
import re
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import secrets
import httpx

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from tortoise.contrib.fastapi import RegisterTortoise

from app.db import (
    Account,
    ApiKey,
    Mailbox,
    OutlookConfig as OutlookConfigDB,
    Proxy,
    Settings,
    Subscription,
    User,
)
from app.models import (
    AccountCreate,
    AccountOut,
    ChangePassword,
    CodexOAuthRequest,
    CodexDeviceRequest,
    LoginRequest,
    MailboxCreate,
    MailboxMailDetail,
    MailboxMailSummary,
    MailboxOut,
    OTPSubmit,
    OrgSettings,
    OutlookConfig as OutlookConfigSchema,
    OutlookConfigOut,
    PasswordReset,
    ProxyCreate,
    ProxyOut,
    ProxyTestResult,
    SubscriptionCreate,
    TOTPSetupOut,
    TOTPVerify,
    TaskOut,
    UserCreate,
    UserLogin,
    UserOut,
    UserProfileUpdate,
    UserUpdate,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_URL = f"sqlite://{DATA_DIR / 'db.sqlite3'}"

ACCOUNTS_FILE = DATA_DIR / "accounts.json"
USERS_FILE = DATA_DIR / "users.json"
PROXIES_FILE = DATA_DIR / "proxies.json"
OUTLOOK_FILE = DATA_DIR / "outlook.json"
MAILBOXES_FILE = DATA_DIR / "mailboxes.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
SUBSCRIPTIONS_FILE = DATA_DIR / "subscriptions.json"


def _load_legacy_json(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    return {}


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def _migrate_json_to_db() -> None:
    if await User.exists() or await Account.exists():
        return

    for path, model in [
        (ACCOUNTS_FILE, Account),
        (USERS_FILE, User),
        (PROXIES_FILE, Proxy),
        (MAILBOXES_FILE, Mailbox),
    ]:
        data = _load_legacy_json(path)
        for row in data.values():
            try:
                await model.create(**row)
            except Exception:
                pass

    subs_data = _load_legacy_json(SUBSCRIPTIONS_FILE)
    for row in subs_data.values():
        meta = row.pop("metadata", {})
        row["metadata_"] = meta
        try:
            await Subscription.create(**row)
        except Exception:
            pass

    settings_data = _load_legacy_json(SETTINGS_FILE)
    if settings_data:
        try:
            await Settings.create(
                id=1, **{k: v for k, v in settings_data.items() if k != "id"}
            )
        except Exception:
            pass

    outlook_data = _load_legacy_json(OUTLOOK_FILE)
    cfg = outlook_data.get("config", {})
    if cfg:
        try:
            await OutlookConfigDB.create(id=1, **cfg)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with RegisterTortoise(
        app,
        db_url=DB_URL,
        modules={"models": ["app.db"]},
        generate_schemas=True,
    ):
        await _migrate_json_to_db()

        from tortoise import connections

        conn = connections.get("default")
        try:
            await conn.execute_query(
                "CREATE TABLE IF NOT EXISTS cdk_providers (id VARCHAR(8) PRIMARY KEY, name VARCHAR(100), provider_type VARCHAR(50), base_url VARCHAR(500), auth_type VARCHAR(20) DEFAULT 'none', auth_value VARCHAR(500) DEFAULT '', is_enabled INTEGER DEFAULT 1, settings TEXT, created_at VARCHAR(30) DEFAULT '')"
            )
        except Exception:
            pass

        try:
            await conn.execute_query(
                "CREATE TABLE IF NOT EXISTS extensions (id VARCHAR(100) PRIMARY KEY, enabled INTEGER DEFAULT 0, settings TEXT DEFAULT '{}')"
            )
        except Exception:
            pass

        for col, default in [
            (
                "share_policy",
                '\'{"enabled":true,"max_hours":720,"allow_session":true,"allow_mailbox":true,"allowed_roles":["admin","manager","operator"]}\'',
            ),
            ("access_policy", '\'{"session_view_roles":["admin"]}\''),
        ]:
            try:
                await conn.execute_query(
                    f"ALTER TABLE settings ADD COLUMN {col} TEXT DEFAULT {default}"
                )
            except Exception:
                pass

        from app.outlook_otp import configure

        cfg = await OutlookConfigDB.get_or_none(id=1)
        if cfg and cfg.tenant_id and cfg.client_id and cfg.client_secret:
            configure(cfg.tenant_id, cfg.client_id, cfg.client_secret)

        if not await User.exists():
            from app.models import UserCreate

            await _create_user(
                UserCreate(
                    email="admin@local", name="Admin", role="admin", password="admin"
                )
            )

        from app.extensions import load_enabled_extensions

        await load_enabled_extensions(app)

        yield


app = FastAPI(title="ChatGPT Account Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse


class IPAllowlistMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next: Any) -> Any:
        settings = await Settings.get_or_none(id=1)
        allowed = settings.allowed_ips if settings else []
        if allowed:
            client_ip = request.client.host if request.client else ""
            if client_ip not in allowed and "0.0.0.0/0" not in allowed:
                return JSONResponse(
                    status_code=403,
                    content={"detail": f"IP {client_ip} not allowed"},
                )
        return await call_next(request)


app.add_middleware(IPAllowlistMiddleware)

_sessions: dict[str, dict[str, Any]] = {}
_2fa_sessions: dict[str, dict[str, Any]] = {}

AUTH_EXEMPT = {
    "/api/users/login",
    "/api/auth/verify-2fa",
    "/api/owner-contact",
    "/docs",
    "/openapi.json",
}


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _api_key_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _get_bearer_token(request: StarletteRequest | Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return auth[7:]


def _get_session_user(request: StarletteRequest) -> dict[str, Any] | None:
    token = _get_bearer_token(request)
    if not token or token.startswith("cam_"):
        return None
    return _sessions.get(token)


async def _get_api_key_user(request: StarletteRequest) -> dict[str, Any] | None:
    token = _get_bearer_token(request)
    if not token or not token.startswith("cam_"):
        return None
    api_key = await ApiKey.get_or_none(key_hash=_api_key_hash(token))
    if not api_key:
        return None
    api_key.last_used = _now()
    await api_key.save(update_fields=["last_used"])
    return {
        "user_id": api_key.user_id,
        "api_key_id": api_key.id,
        "key_prefix": api_key.key_prefix,
    }


async def _get_auth_user(request: StarletteRequest | Request) -> dict[str, Any] | None:
    session = _get_session_user(request)
    if session:
        return session
    return await _get_api_key_user(request)


async def _require_user_id(request: Request) -> str:
    token = _get_bearer_token(request)
    if not token:
        raise HTTPException(401, "Not authenticated")
    auth_user = await _get_auth_user(request)
    if not auth_user:
        raise HTTPException(401, "Not authenticated")
    return auth_user["user_id"]


async def _get_caller_role(request: Request) -> str:
    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(401, "User not found")
    return user.role or "user"


ROLE_HIERARCHY = {"owner": 4, "admin": 3, "manager": 2, "user": 1}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next: Any) -> Any:
        path = request.url.path
        if request.method == "OPTIONS":
            return await call_next(request)
        if (
            not path.startswith("/api/")
            or path in AUTH_EXEMPT
            or path.startswith("/api/shared/")
        ):
            return await call_next(request)
        if path == "/api/auth/me" or path == "/api/auth/logout":
            return await call_next(request)
        auth_user = await _get_auth_user(request)
        if not auth_user:
            return JSONResponse(
                status_code=401, content={"detail": "Not authenticated"}
            )
        token = _get_bearer_token(request)
        if token and token.startswith("cam_"):
            return await call_next(request)
        session = _get_session_user(request)
        if not session:
            return JSONResponse(
                status_code=401, content={"detail": "Not authenticated"}
            )
        settings = await Settings.get_or_none(id=1)
        timeout_min = settings.session_timeout_min if settings else 0
        if timeout_min > 0:
            elapsed = time.time() - session.get("created_at", 0)
            if elapsed > timeout_min * 60:
                auth = request.headers.get("authorization", "")
                if auth.startswith("Bearer "):
                    _sessions.pop(auth[7:], None)
                return JSONResponse(
                    status_code=401, content={"detail": "Session expired"}
                )
        return await call_next(request)


app.add_middleware(AuthMiddleware)

_pending_otps: dict[str, asyncio.Future[str]] = {}
_XRAY_PROTOCOLS = {"vmess", "vless", "trojan", "shadowsocks"}


class _ResolvedProxy:
    def __init__(self, proxy_url: str | None) -> None:
        self._raw_url = proxy_url
        self._xray_node_id: str | None = None
        self.url: str | None = proxy_url

    async def __aenter__(self) -> "_ResolvedProxy":
        if not self._raw_url:
            return self

        proxy_entry = await Proxy.filter(url=self._raw_url).first()
        if not proxy_entry:
            return self

        protocol = proxy_entry.protocol or ""
        if protocol not in _XRAY_PROTOCOLS:
            return self

        from app.xray_manager import start_node

        sub_id = proxy_entry.subscription_id
        if sub_id is not None:
            sub = await Subscription.get_or_none(id=sub_id)
            if not sub:
                return self
            node_index = proxy_entry.node_index or 0
            nodes = sub.nodes or []
            if node_index >= len(nodes):
                return self
            node = nodes[node_index]
            self._xray_node_id = f"{sub_id}:{node_index}"
        else:
            node = {
                "protocol": protocol,
                "address": proxy_entry.host,
                "port": proxy_entry.port,
                "uuid": proxy_entry.password or proxy_entry.username,
                "alter_id": 0,
                "security": "auto",
                "network": "tcp",
                "tls": "",
                "name": proxy_entry.label or proxy_entry.host,
            }
            self._xray_node_id = f"standalone:{proxy_entry.id}"

        port = await start_node(self._xray_node_id, node)
        self.url = f"socks5://127.0.0.1:{port}"
        return self

    async def __aexit__(self, *args: object) -> None:
        pass


_workflow_runs: dict[str, dict[str, Any]] = {}


async def _register_run(
    run_id: str,
    *,
    workflow_type: str,
    email: str,
    proxy_url: str | None = None,
    run_name: str = "",
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    proxy_label = None
    proxy_test = None
    if proxy_url:
        proxy_entry = await Proxy.filter(url=proxy_url).first()
        if proxy_entry:
            proxy_label = proxy_entry.label or proxy_entry.host
            proxy_test = proxy_entry.last_test

    run = {
        "id": run_id,
        "name": run_name or f"{workflow_type}-{run_id[:6]}",
        "type": workflow_type,
        "email": email,
        "proxy_url": proxy_url,
        "proxy_label": proxy_label,
        "proxy_test": proxy_test,
        "status": "starting",
        "error": None,
        "output": None,
        "logs": [],
        "params": params,
        "started_at": _now(),
        "finished_at": None,
    }
    _workflow_runs[run_id] = run
    return run


def _run_log(run_id: str, message: str) -> None:
    run = _workflow_runs.get(run_id)
    if run:
        run["logs"].append({"ts": _now(), "msg": message})


def _update_run(run_id: str, **kwargs: Any) -> None:
    run = _workflow_runs.get(run_id)
    if run:
        run.update(kwargs)


def _finish_run(run_id: str, *, status: str, error: str | None = None) -> None:
    run = _workflow_runs.get(run_id)
    if run:
        run["status"] = status
        run["error"] = error
        run["finished_at"] = _now()


class _RunLogHandler(logging.Handler):
    _SKIP_LOGGERS = {
        "httpx",
        "httpcore",
        "hpack",
        "h2",
        "h11",
        "urllib3",
        "asyncio",
        "aiosqlite",
        "tortoise",
    }

    def __init__(self, run_id: str) -> None:
        super().__init__()
        self._run_id = run_id

    def emit(self, record: logging.LogRecord) -> None:
        name = record.name.split(".")[0]
        if name in self._SKIP_LOGGERS:
            return
        msg = self.format(record) if self.formatter else record.getMessage()
        msg = msg.strip()
        if msg:
            _run_log(self._run_id, msg)


class _VerboseCapture:
    def __init__(self, run_id: str, enabled: bool) -> None:
        self._run_id = run_id
        self._enabled = enabled
        self._handler: _RunLogHandler | None = None
        self._prev_level: int = logging.WARNING

    def __enter__(self) -> "_VerboseCapture":
        if not self._enabled:
            return self
        self._handler = _RunLogHandler(self._run_id)
        self._handler.setLevel(logging.DEBUG)
        root = logging.getLogger()
        self._prev_level = root.level
        root.setLevel(logging.DEBUG)
        root.addHandler(self._handler)
        return self

    def __exit__(self, *args: object) -> None:
        if self._handler:
            root = logging.getLogger()
            root.removeHandler(self._handler)
            root.setLevel(self._prev_level)


def _build_proxy_url(p: dict[str, Any]) -> str:
    auth = ""
    if p.get("username"):
        auth = f"{p['username']}:{p.get('password', '')}@"
    return f"{p['protocol']}://{auth}{p['host']}:{p['port']}"


async def _get_otp_fn(
    account_id: str, email: str, otp_future: asyncio.Future[str]
) -> tuple[Any, bool]:
    from app.outlook_otp import is_configured as outlook_configured
    from app.outlook_otp import otp_provider as outlook_otp

    mb = await Mailbox.filter(assigned_account_id=account_id).first()
    if not mb:
        mb = await Mailbox.filter(email=email).first()

    if mb and mb.refresh_token and mb.client_id:
        _run_log(account_id, f"Using mailbox {mb.email} for auto OTP retrieval")

        async def mailbox_otp(user_email: str) -> str:
            return await _poll_mailbox_otp(mb.id, mb.refresh_token, mb.client_id)

        return mailbox_otp, False

    if outlook_configured():
        otp_email = mb.email if mb else email
        _run_log(
            account_id,
            f"Using global Outlook config for auto OTP retrieval ({otp_email})",
        )

        async def global_otp(user_email: str) -> str:
            return await outlook_otp(otp_email)

        return global_otp, False

    _run_log(account_id, "No mailbox found — manual OTP required")

    async def manual_otp(user_email: str) -> str:
        return await otp_future

    return manual_otp, True


async def _poll_mailbox_otp(
    mb_id: str, refresh_token: str, client_id: str, timeout: float = 180
) -> str:
    from datetime import datetime, timezone, timedelta

    log = logging.getLogger(__name__)
    deadline = time.monotonic() + timeout
    cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=5)
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            access_token = await _exchange_outlook_token(refresh_token, client_id)
            async with httpx.AsyncClient(timeout=30) as client:
                for folder in ("inbox", "junkemail"):
                    url = (
                        f"https://graph.microsoft.com/v1.0/me/mailFolders/"
                        f"{folder}/messages?$top=10&$orderby=receivedDateTime desc"
                        f"&$select=id,subject,receivedDateTime,from,bodyPreview"
                    )
                    resp = await client.get(
                        url,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if resp.status_code >= 400:
                        log.warning(
                            "Mailbox OTP poll: %s returned %d", folder, resp.status_code
                        )
                        continue
                    data = resp.json()
                    for msg in data.get("value", []):
                        from_obj = msg.get("from", {})
                        from_addr = ""
                        if isinstance(from_obj, dict):
                            ea = from_obj.get("emailAddress", {})
                            if isinstance(ea, dict):
                                from_addr = ea.get("address", "")
                        if from_addr.lower() != "noreply@tm.openai.com":
                            continue
                        received = msg.get("receivedDateTime", "")
                        if received:
                            try:
                                received_dt = datetime.fromisoformat(
                                    received.replace("Z", "+00:00")
                                )
                                if received_dt < cutoff_dt:
                                    continue
                            except ValueError:
                                pass
                        subject = msg.get("subject", "")
                        preview = msg.get("bodyPreview", "")
                        otp = _extract_mail_otp(f"{subject} {preview}")
                        if otp:
                            log.info("Mailbox OTP found: %s (attempt %d)", otp, attempt)
                            return otp
        except HTTPException as exc:
            log.warning(
                "Mailbox OTP poll attempt %d token error: %s", attempt, exc.detail
            )
        except Exception as exc:
            log.warning("Mailbox OTP poll attempt %d error: %s", attempt, exc)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        await asyncio.sleep(min(5, remaining))

    raise TimeoutError(f"OTP not received for mailbox {mb_id} within {timeout}s")


async def _resolve_proxy_labels(accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    proxy_urls = {a["proxy_url"] for a in accounts if a.get("proxy_url")}
    if not proxy_urls:
        for a in accounts:
            a["proxy_label"] = ""
            a["proxy_test"] = None
        return accounts
    proxies = await Proxy.filter(url__in=list(proxy_urls)).values(
        "url", "label", "last_test"
    )
    url_map = {p["url"]: p for p in proxies}
    for a in accounts:
        matched = url_map.get(a.get("proxy_url", ""))
        a["proxy_label"] = matched["label"] if matched and matched.get("label") else ""
        a["proxy_test"] = matched["last_test"] if matched else None
    return accounts


@app.get("/api/accounts", response_model=list[AccountOut])
async def list_accounts() -> list[dict[str, Any]]:
    accounts = await Account.all().values()
    return await _resolve_proxy_labels(accounts)


@app.get("/api/accounts/{account_id}", response_model=AccountOut)
async def get_account(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    rows = await Account.filter(id=account_id).values()
    resolved = await _resolve_proxy_labels(rows)
    return resolved[0]


@app.get("/api/accounts/{account_id}/session")
async def get_account_session(request: Request, account_id: str) -> dict[str, Any]:
    caller_role = await _get_caller_role(request)
    settings = await Settings.get_or_none(id=1)
    ap = settings.access_policy if settings else {}
    session_view_roles: list[str] = ap.get("session_view_roles", ["admin"])
    if caller_role not in session_view_roles:
        raise HTTPException(403, "Insufficient permissions")

    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    return {
        "id": acc.id,
        "email": acc.email,
        "session_token": acc.session_token,
        "access_token": acc.access_token,
        "codex_token": acc.codex_token,
        "cookies": acc.cookies,
        "password": acc.password,
        "proxy_url": acc.proxy_url,
        "status": acc.status,
    }


@app.post("/api/accounts/{account_id}/action")
async def execute_account_action(
    account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session (missing access_token)")

    action = str(body.get("action", "")).strip()
    allowed = {
        "get_me",
        "get_account_info",
        "get_codex_quota",
        "get_user_settings",
        "get_notification_settings",
        "get_account_settings",
        "get_identity",
        "get_subscriptions",
        "get_user_segments",
        "register_flow",
    }
    if action not in allowed:
        raise HTTPException(
            400, f"Unknown action: {action}. Allowed: {sorted(allowed)}"
        )

    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    import register as reg_module

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})

            needs_account_id = {
                "get_account_settings",
                "get_identity",
                "get_subscriptions",
            }
            openai_account_id = ""
            if action in needs_account_id:
                try:
                    check_data = await reg_module.get_account_info(session)
                except Exception as exc:
                    raise HTTPException(
                        502, f"Failed to fetch account info: {exc}"
                    ) from exc
                ordering = check_data.get("account_ordering")
                if isinstance(ordering, list) and ordering:
                    openai_account_id = str(ordering[0])
                if not openai_account_id:
                    raise HTTPException(400, "Could not determine OpenAI account ID")

            fn_map: dict[str, Any] = {
                "get_me": lambda s: reg_module.get_me(s),
                "get_account_info": lambda s: reg_module.get_account_info(s),
                "get_codex_quota": lambda s: reg_module.get_codex_quota(s),
                "get_user_settings": lambda s: reg_module.get_user_settings(s),
                "get_notification_settings": lambda s: reg_module.get_notification_settings(
                    s
                ),
                "get_user_segments": lambda s: reg_module.get_user_segments(s),
                "get_account_settings": lambda s: reg_module.get_account_settings(
                    s, openai_account_id
                ),
                "get_identity": lambda s: reg_module.get_identity(s, openai_account_id),
                "get_subscriptions": lambda s: reg_module.get_subscriptions(
                    s, openai_account_id
                ),
                "register_flow": lambda s: reg_module.register_flow(s),
            }
            fn = fn_map[action]
            try:
                result = await fn(session)
            except Exception as exc:
                raise HTTPException(502, f"Action '{action}' failed: {exc}") from exc

    return {"action": action, "result": result}


@app.get("/api/accounts/{account_id}/settings")
async def get_account_settings_view(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    import register as reg_module
    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            user_settings = await reg_module.get_user_settings(session)

            check_data = await reg_module.get_account_info(session)
            ordering = check_data.get("account_ordering")
            openai_account_id = ""
            if isinstance(ordering, list) and ordering:
                openai_account_id = str(ordering[0])

            account_settings: dict[str, Any] = {}
            if openai_account_id:
                account_settings = await reg_module.get_account_settings(
                    session, openai_account_id
                )

            return {"settings": user_settings, "account_settings": account_settings}


@app.patch("/api/accounts/{account_id}/settings")
async def update_account_setting(
    account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    feature = str(body.get("feature", "")).strip()
    value = body.get("value", True)
    if not feature:
        raise HTTPException(400, "feature is required")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.patch(
                f"https://chatgpt.com/backend-api/settings/account_user_setting?feature={feature}&value={'true' if value else 'false'}",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code, f"Failed to update setting: {resp.text[:300]}"
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/profile")
async def get_account_profile(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    import register as reg_module
    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})

            me_data = await reg_module.get_me(session)
            user_id = str(me_data.get("id", ""))
            if not user_id:
                raise HTTPException(400, "Could not determine ChatGPT user ID")

            resp = await session.get(
                f"https://chatgpt.com/backend-api/calpico/chatgpt/profile/{user_id}",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch profile: {resp.text[:300]}",
                )
            return resp.json()


@app.patch("/api/accounts/{account_id}/profile/name")
async def update_account_profile_name(
    account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update(
                {
                    "Authorization": f"Bearer {acc.access_token}",
                    "Content-Type": "application/json",
                }
            )
            resp = await session.patch(
                "https://chatgpt.com/backend-api/me",
                json={"name": name},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to update display name: {resp.text[:300]}",
                )
            return resp.json()


@app.patch("/api/accounts/{account_id}/profile/username")
async def update_account_profile_username(
    account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    username = str(body.get("username", "")).strip()
    if not username:
        raise HTTPException(400, "username is required")

    import register as reg_module
    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update(
                {
                    "Authorization": f"Bearer {acc.access_token}",
                    "Content-Type": "application/json",
                }
            )

            me_data = await reg_module.get_me(session)
            user_id = str(me_data.get("id", ""))
            if not user_id:
                raise HTTPException(400, "Could not determine ChatGPT user ID")

            resp = await session.post(
                f"https://chatgpt.com/backend-api/calpico/chatgpt/profile/{user_id}/username",
                json={"username": username},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to update username: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/age-verification")
async def get_age_verification(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/settings/is_adult",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch age verification status: {resp.text[:300]}",
                )
            return resp.json()


@app.post("/api/accounts/{account_id}/age-verification/verify")
async def start_age_verification(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update(
                {
                    "Authorization": f"Bearer {acc.access_token}",
                    "Content-Type": "application/json",
                }
            )
            resp = await session.post(
                "https://chatgpt.com/backend-api/compliance/age_verification/persona/inquiries",
                json={"enabled": True},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to start age verification: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/client-applications")
async def get_client_applications(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/client_applications",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch client applications: {resp.text[:300]}",
                )
            return resp.json()


@app.delete("/api/accounts/{account_id}/client-applications/{app_id}")
async def disconnect_client_application(account_id: str, app_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.delete(
                f"https://chatgpt.com/backend-api/client_applications/{app_id}",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to disconnect application: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/codex-usage")
async def get_codex_usage(
    account_id: str, start_date: str, end_date: str, group_by: str = "day"
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown",
                params={
                    "start_date": start_date,
                    "end_date": end_date,
                    "group_by": group_by,
                },
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch codex usage: {resp.text[:300]}",
                )
            return resp.json()


from app.db import ShareToken


@app.post("/api/accounts/{account_id}/share")
async def create_share_token(
    request: Request, account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    settings = await Settings.get_or_none(id=1)
    sp = settings.share_policy if settings else {}
    if not sp.get("enabled", True):
        raise HTTPException(403, "Sharing is disabled by organization policy")

    caller_role = await _get_caller_role(request)
    allowed_roles: list[str] = sp.get("allowed_roles", ["admin", "manager", "operator"])
    if caller_role not in allowed_roles:
        raise HTTPException(
            403, f"Role '{caller_role}' is not allowed to create share links"
        )

    hours = int(body.get("hours", 24))
    max_hours = int(sp.get("max_hours", 720))
    if hours < 1 or hours > max_hours:
        raise HTTPException(400, f"hours must be between 1 and {max_hours}")

    include_mailbox = bool(body.get("include_mailbox", False))
    include_session = bool(body.get("include_session", False))

    if include_session and not sp.get("allow_session", True):
        raise HTTPException(
            403, "Sharing session data is disabled by organization policy"
        )
    if include_mailbox and not sp.get("allow_mailbox", True):
        raise HTTPException(
            403, "Sharing mailbox data is disabled by organization policy"
        )

    from datetime import datetime, timedelta, timezone

    token_id = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)

    await ShareToken.create(
        id=token_id,
        account_id=account_id,
        include_mailbox=include_mailbox,
        include_session=include_session,
        expires_at=expires.isoformat(),
        created_at=_now(),
    )

    return {
        "token": token_id,
        "expires_at": expires.isoformat(),
        "include_mailbox": include_mailbox,
        "include_session": include_session,
    }


@app.get("/api/accounts/{account_id}/shares")
async def list_share_tokens(account_id: str) -> list[dict[str, Any]]:
    tokens = await ShareToken.filter(account_id=account_id, revoked=False).all()
    return [
        {
            "id": t.id,
            "account_id": t.account_id,
            "include_mailbox": t.include_mailbox,
            "include_session": t.include_session,
            "expires_at": t.expires_at,
            "created_at": t.created_at,
        }
        for t in tokens
    ]


@app.delete("/api/shares/{token_id}")
async def revoke_share_token(token_id: str) -> dict[str, str]:
    t = await ShareToken.get_or_none(id=token_id)
    if not t:
        raise HTTPException(404, "Share token not found")
    t.revoked = True
    await t.save()
    return {"status": "revoked"}


@app.get("/api/shared/{token_id}")
async def get_shared_account(token_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone

    t = await ShareToken.get_or_none(id=token_id)
    if not t or t.revoked:
        raise HTTPException(404, "Share link not found or revoked")

    expires = datetime.fromisoformat(t.expires_at)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(410, "Share link has expired")

    acc = await Account.get_or_none(id=t.account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    result: dict[str, Any] = {
        "id": acc.id,
        "email": acc.email,
        "status": acc.status,
        "name": acc.name,
        "plan": acc.plan,
        "plan_expiry": acc.plan_expiry,
        "proxy_url": acc.proxy_url,
        "created_at": acc.created_at,
        "last_login": acc.last_login,
        "expires_at": t.expires_at,
        "include_mailbox": t.include_mailbox,
        "include_session": t.include_session,
    }

    if t.include_session:
        result["session_token"] = acc.session_token
        result["access_token"] = acc.access_token
        result["codex_token"] = acc.codex_token
        result["cookies"] = acc.cookies
        result["password"] = acc.password

    if t.include_mailbox:
        mb = await Mailbox.filter(assigned_account_id=acc.id).first()
        if mb:
            result["mailbox"] = {
                "id": mb.id,
                "email": mb.email,
                "status": mb.status,
            }

    return result


async def _validate_share_token(token_id: str) -> tuple[Any, Any]:
    from datetime import datetime, timezone

    t = await ShareToken.get_or_none(id=token_id)
    if not t or t.revoked:
        raise HTTPException(404, "Share link not found or revoked")
    expires = datetime.fromisoformat(t.expires_at)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(410, "Share link has expired")
    acc = await Account.get_or_none(id=t.account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    return t, acc


@app.get("/api/shared/{token_id}/codex-usage")
async def get_shared_codex_usage(
    token_id: str, start_date: str, end_date: str, group_by: str = "day"
) -> dict[str, Any]:
    _t, acc = await _validate_share_token(token_id)
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown",
                params={
                    "start_date": start_date,
                    "end_date": end_date,
                    "group_by": group_by,
                },
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, f"Failed: {resp.text[:300]}")
            return resp.json()


@app.post("/api/shared/{token_id}/refresh")
async def refresh_shared_account(token_id: str) -> dict[str, Any]:
    _t, acc = await _validate_share_token(token_id)
    return await _do_refresh_account(acc)


@app.get("/api/shared/{token_id}/mailbox")
async def get_shared_mailbox(token_id: str) -> dict[str, Any]:
    t, acc = await _validate_share_token(token_id)
    if not t.include_mailbox:
        raise HTTPException(403, "Mailbox access not included in this share link")
    mb = await Mailbox.filter(assigned_account_id=acc.id).first()
    if not mb:
        raise HTTPException(404, "No mailbox assigned")
    return {"id": mb.id, "email": mb.email, "status": mb.status}


@app.get("/api/shared/{token_id}/mailbox/messages")
async def get_shared_mailbox_messages(token_id: str) -> list[dict[str, Any]]:
    t, acc = await _validate_share_token(token_id)
    if not t.include_mailbox:
        raise HTTPException(403, "Mailbox access not included in this share link")
    mb = await Mailbox.filter(assigned_account_id=acc.id).first()
    if not mb:
        raise HTTPException(404, "No mailbox assigned")
    return await get_mailbox_mails(mb.id)


@app.get("/api/shared/{token_id}/mailbox/messages/{mail_id}")
async def get_shared_mailbox_message(token_id: str, mail_id: str) -> dict[str, Any]:
    t, acc = await _validate_share_token(token_id)
    if not t.include_mailbox:
        raise HTTPException(403, "Mailbox access not included in this share link")
    mb = await Mailbox.filter(assigned_account_id=acc.id).first()
    if not mb:
        raise HTTPException(404, "No mailbox assigned")
    return await get_mailbox_mail(mb.id, mail_id)


@app.post("/api/accounts/{account_id}/checkout")
async def create_checkout(account_id: str, body: dict[str, Any]) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    plan_name = body.get("plan_name", "chatgptplusplan")
    promo_campaign_id = body.get("promo_campaign_id", "")
    entry_point = body.get("entry_point", "direct_purchase_redirect")
    team_plan_data = body.get("team_plan_data")
    billing_country = body.get("billing_country", "US")
    billing_currency = body.get("billing_currency", "USD")
    checkout_ui_mode = body.get("checkout_ui_mode", "custom")

    payload: dict[str, Any] = {
        "plan_name": plan_name,
        "entry_point": entry_point,
        "checkout_ui_mode": checkout_ui_mode,
        "billing_details": {"country": billing_country, "currency": billing_currency},
    }
    if promo_campaign_id:
        payload["promo_campaign"] = {
            "promo_campaign_id": promo_campaign_id,
            "is_coupon_from_query_param": True,
        }
    if team_plan_data:
        payload["team_plan_data"] = team_plan_data
        if not entry_point or entry_point == "direct_purchase_redirect":
            payload["entry_point"] = "team_workspace_purchase_modal"

    from curl_cffi.requests import AsyncSession

    try:
        async with _ResolvedProxy(acc.proxy_url) as resolved:
            proxies = (
                {"https": resolved.url, "http": resolved.url} if resolved.url else None
            )
            async with AsyncSession(
                proxies=proxies, impersonate="chrome136"
            ) as session:
                session.headers.update(
                    {
                        "Authorization": f"Bearer {acc.access_token}",
                        "Content-Type": "application/json",
                    }
                )
                resp = await session.post(
                    "https://chatgpt.com/backend-api/payments/checkout",
                    json=payload,
                    timeout=30,
                )
                if resp.status_code != 200:
                    raise HTTPException(
                        resp.status_code,
                        f"Checkout failed: {resp.text[:500]}",
                    )
        return resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Checkout request failed: {exc}") from exc


# ── Extension API ──────────────────────────────────────────────


@app.get("/api/extensions")
async def list_extensions() -> list[dict[str, Any]]:
    from app.db import Extension as ExtensionDB
    from app.extensions import EXTENSIONS_DIR, discover_extensions, get_loaded

    manifests = discover_extensions()
    loaded = get_loaded()
    results = []
    for m in manifests:
        db_ext = await ExtensionDB.get_or_none(id=m.id)
        has_ui = (EXTENSIONS_DIR / m.id / "ui.json").exists()
        results.append(
            {
                "id": m.id,
                "name": m.name,
                "description": m.description,
                "version": m.version,
                "author": m.author,
                "settings_schema": m.settings_schema,
                "enabled": db_ext.enabled if db_ext else False,
                "settings": db_ext.settings if db_ext else {},
                "loaded": m.id in loaded,
                "has_ui": has_ui,
            }
        )
    return results


@app.post("/api/extensions/{ext_id}/enable")
async def enable_extension(ext_id: str) -> dict[str, Any]:
    from app.db import Extension as ExtensionDB
    from app.extensions import discover_extensions, load_extension

    manifests = {m.id: m for m in discover_extensions()}
    if ext_id not in manifests:
        raise HTTPException(404, "Extension not found")

    db_ext, _ = await ExtensionDB.get_or_create(
        id=ext_id, defaults={"enabled": True, "settings": {}}
    )
    if not db_ext.enabled:
        db_ext.enabled = True
        await db_ext.save()

    load_extension(app, ext_id)
    return {"id": ext_id, "enabled": True}


@app.post("/api/extensions/{ext_id}/disable")
async def disable_extension(ext_id: str) -> dict[str, Any]:
    from app.db import Extension as ExtensionDB

    db_ext = await ExtensionDB.get_or_none(id=ext_id)
    if not db_ext:
        raise HTTPException(404, "Extension not found")

    db_ext.enabled = False
    await db_ext.save()
    return {"id": ext_id, "enabled": False, "note": "Restart required to fully unload"}


@app.get("/api/extensions/{ext_id}/settings")
async def get_extension_settings(ext_id: str) -> dict[str, Any]:
    from app.db import Extension as ExtensionDB

    db_ext = await ExtensionDB.get_or_none(id=ext_id)
    return db_ext.settings if db_ext else {}


@app.post("/api/extensions/{ext_id}/settings")
async def save_extension_settings(ext_id: str, body: dict[str, Any]) -> dict[str, Any]:
    from app.db import Extension as ExtensionDB

    db_ext, _ = await ExtensionDB.get_or_create(
        id=ext_id, defaults={"enabled": False, "settings": {}}
    )
    db_ext.settings = body
    await db_ext.save()
    return db_ext.settings


@app.get("/api/extensions/{ext_id}/ui")
async def get_extension_ui_schema(ext_id: str) -> dict[str, Any]:
    from app.extensions import get_extension_ui

    ui = get_extension_ui(ext_id)
    if ui is None:
        raise HTTPException(404, "Extension has no UI")
    return ui


@app.get("/api/accounts/{account_id}/customer-portal")
async def get_customer_portal(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/payments/customer_portal",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to get customer portal: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/codex-settings")
async def get_codex_settings(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/wham/settings/user",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch codex settings: {resp.text[:300]}",
                )
            return resp.json()


@app.patch("/api/accounts/{account_id}/codex-settings")
async def update_codex_settings(account_id: str, request: Request) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    body = await request.json()

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update(
                {
                    "Authorization": f"Bearer {acc.access_token}",
                    "Content-Type": "application/json",
                }
            )
            resp = await session.patch(
                "https://chatgpt.com/backend-api/wham/settings/user",
                json=body,
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to update codex settings: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/amphora")
async def get_amphora(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/amphora",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch amphora: {resp.text[:300]}",
                )
            return resp.json()


@app.delete("/api/accounts/{account_id}/browser-context")
async def delete_browser_context(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.delete(
                "https://chatgpt.com/backend-api/agent/browser_context",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to delete browser context: {resp.text[:300]}",
                )
            return resp.json()


@app.delete("/api/accounts/{account_id}/conversations")
async def delete_all_conversations(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.patch(
                "https://chatgpt.com/backend-api/conversations",
                json={"is_visible": False},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to delete conversations: {resp.text[:300]}",
                )
            return resp.json()


@app.post("/api/accounts/{account_id}/archive-all-chats")
async def archive_all_chats(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.patch(
                "https://chatgpt.com/backend-api/conversations",
                json={"is_archived": True},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to archive conversations: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/archived-chats")
async def get_archived_chats(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated&is_archived=true",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch archived chats: {resp.text[:300]}",
                )
            return resp.json()


@app.patch("/api/accounts/{account_id}/conversations/{conversation_id}/unarchive")
async def unarchive_conversation(
    account_id: str, conversation_id: str
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.patch(
                f"https://chatgpt.com/backend-api/conversation/{conversation_id}",
                json={"is_archived": False},
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to unarchive conversation: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/notification-settings")
async def get_notification_settings(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.get(
                "https://chatgpt.com/backend-api/notifications/settings",
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to fetch notification settings: {resp.text[:300]}",
                )
            return resp.json()


@app.patch("/api/accounts/{account_id}/notification-settings")
async def update_notification_settings(
    account_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            resp = await session.patch(
                "https://chatgpt.com/backend-api/notifications/settings",
                json=body,
                timeout=15,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    resp.status_code,
                    f"Failed to update notification settings: {resp.text[:300]}",
                )
            return resp.json()


@app.get("/api/accounts/{account_id}/workspace-id")
async def get_workspace_id(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    if not acc.access_token:
        raise HTTPException(400, "Account has no active session")

    import register as reg_module
    from curl_cffi.requests import AsyncSession

    async with _ResolvedProxy(acc.proxy_url) as resolved:
        proxies = (
            {"https": resolved.url, "http": resolved.url} if resolved.url else None
        )
        async with AsyncSession(proxies=proxies, impersonate="chrome136") as session:
            session.headers.update({"Authorization": f"Bearer {acc.access_token}"})
            try:
                check_data = await reg_module.get_account_info(session)
            except Exception as exc:
                raise HTTPException(
                    502, f"Failed to fetch account info: {exc}"
                ) from exc
            ordering = check_data.get("account_ordering")
            if isinstance(ordering, list) and ordering:
                return {"workspace_id": str(ordering[0])}
            raise HTTPException(
                400, "Could not determine workspace ID from account info"
            )


@app.get("/api/workflow-runs")
async def list_workflow_runs() -> list[dict[str, Any]]:
    runs = sorted(
        _workflow_runs.values(),
        key=lambda r: r.get("started_at", ""),
        reverse=True,
    )
    return [{k: v for k, v in r.items() if k not in ("logs", "params")} for r in runs]


@app.get("/api/workflow-runs/{run_id}")
async def get_workflow_run(run_id: str) -> dict[str, Any]:
    run = _workflow_runs.get(run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found")
    return {k: v for k, v in run.items() if k != "params"}


@app.post("/api/workflow-runs/{run_id}/start")
async def start_workflow_run(run_id: str) -> dict[str, str]:
    run = _workflow_runs.get(run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found")
    if run["status"] not in ("pending", "error"):
        raise HTTPException(400, f"Run cannot be started (status={run['status']})")

    params = run.get("params")
    if not params:
        raise HTTPException(400, "No stored params for this run")

    wf_type = run["type"]
    future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
    _pending_otps[run_id] = future
    _update_run(run_id, status="starting")
    run["started_at"] = _now()
    run["finished_at"] = None
    run["error"] = None
    run["logs"] = []

    if wf_type == "register":
        req = AccountCreate(**params)
        account = await Account.get_or_none(id=run_id)
        if account:
            account.status = "registering"
            await account.save()
        asyncio.create_task(_run_register(run_id, req, future))
    elif wf_type == "login":
        req = LoginRequest(**params)
        account = await Account.get_or_none(id=run_id)
        if account:
            account.status = "logging_in"
            await account.save()
        asyncio.create_task(_run_login(run_id, req, future))
    elif wf_type == "codex_oauth":
        req = CodexOAuthRequest(**params)
        asyncio.create_task(_run_codex(req, future))
    elif wf_type == "codex_oauth_relay":
        req = CodexOAuthRequest(
            **{k: v for k, v in params.items() if k in CodexOAuthRequest.model_fields}
        )
        asyncio.create_task(_run_codex(req, future))
    elif wf_type == "codex_device":
        req = CodexDeviceRequest(**params)
        asyncio.create_task(_run_codex_device(req, future))
    else:
        raise HTTPException(400, f"Unknown workflow type: {wf_type}")

    return {"status": "started"}


@app.post("/api/workflow-runs/{run_id}/stop")
async def stop_workflow_run(run_id: str) -> dict[str, str]:
    run = _workflow_runs.get(run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found")
    active = {"starting", "running", "awaiting_otp"}
    if run["status"] not in active:
        raise HTTPException(400, f"Run is not active (status={run['status']})")
    _run_log(run_id, "Stopped by user")
    _finish_run(run_id, status="stopped")
    _pending_otps.pop(run_id, None)
    return {"status": "stopped"}


@app.delete("/api/workflow-runs/{run_id}")
async def delete_workflow_run(run_id: str) -> dict[str, str]:
    run = _workflow_runs.get(run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found")
    active = {"starting", "running", "awaiting_otp"}
    if run["status"] in active:
        raise HTTPException(400, "Cannot delete an active run — stop it first")
    _pending_otps.pop(run_id, None)
    del _workflow_runs[run_id]
    return {"status": "deleted"}


@app.get("/api/accounts/{account_id}", response_model=AccountOut)
async def get_account(account_id: str) -> dict[str, Any]:
    account = await Account.get_or_none(id=account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    rows = await Account.filter(id=account_id).values()
    resolved = await _resolve_proxy_labels(rows)
    return resolved[0]


@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: str) -> dict[str, str]:
    deleted = await Account.filter(id=account_id).delete()
    if not deleted:
        raise HTTPException(404, "Account not found")
    await Mailbox.filter(assigned_account_id=account_id).update(
        assigned_account_id=None, status="available"
    )
    return {"status": "deleted"}


@app.get("/api/accounts/{account_id}/mailbox")
async def get_account_mailbox(account_id: str) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    mb = await Mailbox.filter(assigned_account_id=account_id).first()
    if not mb:
        return {"mailbox": None}
    row = await Mailbox.filter(id=mb.id).first().values()
    return {"mailbox": row}


@app.post("/api/accounts/{account_id}/mailbox")
async def bind_account_mailbox(account_id: str, body: dict[str, Any]) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    mailbox_id = str(body.get("mailbox_id", "")).strip()
    if not mailbox_id:
        await Mailbox.filter(assigned_account_id=account_id).update(
            assigned_account_id=None, status="available"
        )
        return {"mailbox": None}

    mb = await Mailbox.get_or_none(id=mailbox_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")

    await Mailbox.filter(assigned_account_id=account_id).update(
        assigned_account_id=None, status="available"
    )
    await Mailbox.filter(id=mailbox_id).update(
        assigned_account_id=account_id, status="assigned"
    )
    row = await Mailbox.filter(id=mailbox_id).first().values()
    return {"mailbox": row}


@app.post("/api/accounts/{account_id}/refresh", response_model=AccountOut)
async def refresh_account(account_id: str) -> dict[str, Any]:
    from curl_cffi.requests import AsyncSession as CurlSession

    account = await Account.get_or_none(id=account_id)
    if not account:
        raise HTTPException(404, "Account not found")

    access_token = account.access_token or ""
    if not access_token:
        raise HTTPException(400, "Account has no access token")

    proxy_url = account.proxy_url

    try:
        async with _ResolvedProxy(proxy_url) as resolved:
            proxies = (
                {"http": resolved.url, "https": resolved.url} if resolved.url else None
            )

            async with CurlSession(proxies=proxies, impersonate="chrome136") as session:
                session.headers.update({"Authorization": f"Bearer {access_token}"})

                me_resp = await session.get(
                    "https://chatgpt.com/backend-api/me", timeout=15
                )
                me_data = me_resp.json() if me_resp.status_code == 200 else {}
                if not isinstance(me_data, dict):
                    me_data = {}

                check_resp = await session.get(
                    "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-540",
                    timeout=15,
                )
                check_data = check_resp.json() if check_resp.status_code == 200 else {}
                if not isinstance(check_data, dict):
                    check_data = {}

                quota_resp = await session.get(
                    "https://chatgpt.com/backend-api/wham/usage", timeout=15
                )
                quota_data = quota_resp.json() if quota_resp.status_code == 200 else {}
                if not isinstance(quota_data, dict):
                    quota_data = {}

        name = str(me_data.get("name") or "")
        plan = ""
        plan_expiry = ""
        accounts_info = check_data.get("accounts")
        if isinstance(accounts_info, dict):
            for acc_info in accounts_info.values():
                if isinstance(acc_info, dict):
                    entitlement = acc_info.get("entitlement")
                    if isinstance(entitlement, dict):
                        plan = str(entitlement.get("subscription_plan") or "free")
                        expires = entitlement.get("expires_at")
                        if expires:
                            plan_expiry = str(expires)
                    break

        codex_weekly_used = 0.0
        codex_weekly_reset_hours = 0
        codex_5h_used = 0.0
        codex_5h_reset_min = 0
        rate_limit = quota_data.get("rate_limit")
        if isinstance(rate_limit, dict):
            primary = rate_limit.get("primary_window")
            if isinstance(primary, dict):
                codex_5h_used = float(primary.get("used_percent", 0))
                reset_s = primary.get("reset_after_seconds", 0)
                codex_5h_reset_min = (
                    int(reset_s) // 60 if isinstance(reset_s, (int, float)) else 0
                )
            secondary = rate_limit.get("secondary_window")
            if isinstance(secondary, dict):
                codex_weekly_used = float(secondary.get("used_percent", 0))
                reset_s = secondary.get("reset_after_seconds", 0)
                codex_weekly_reset_hours = (
                    int(reset_s) // 3600 if isinstance(reset_s, (int, float)) else 0
                )

        if not plan and quota_data.get("plan_type"):
            plan = str(quota_data["plan_type"])

        await Account.filter(id=account_id).update(
            name=name,
            plan=plan,
            plan_expiry=plan_expiry,
            codex_weekly_used=codex_weekly_used,
            codex_weekly_reset_hours=codex_weekly_reset_hours,
            codex_5h_used=codex_5h_used,
            codex_5h_reset_min=codex_5h_reset_min,
        )
        rows = await Account.filter(id=account_id).values()
        resolved = await _resolve_proxy_labels(rows)
        return resolved[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Failed to refresh account: {exc}")


@app.patch("/api/accounts/{account_id}/proxy", response_model=AccountOut)
async def update_account_proxy(account_id: str, body: dict[str, Any]) -> dict[str, Any]:
    acc = await Account.get_or_none(id=account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    proxy_url = body.get("proxy_url")
    if proxy_url is not None:
        proxy_url = str(proxy_url).strip() or None
    await Account.filter(id=account_id).update(proxy_url=proxy_url)
    rows = await Account.filter(id=account_id).values()
    resolved = await _resolve_proxy_labels(rows)
    return resolved[0]


@app.post("/api/accounts/register", response_model=TaskOut)
async def register_account(req: AccountCreate) -> dict[str, str]:
    account_id = str(uuid.uuid4())[:8]
    await Account.create(
        id=account_id,
        email=req.email,
        status="registering",
        proxy_url=req.proxy_url,
        password=req.password or "",
        created_at=_now(),
    )

    await _register_run(
        account_id,
        workflow_type="register",
        email=req.email,
        proxy_url=req.proxy_url,
        run_name=req.run_name,
        params=req.model_dump(),
    )

    if req.auto_start:
        future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
        _pending_otps[account_id] = future
        _update_run(account_id, status="starting")
        asyncio.create_task(_run_register(account_id, req, future))
    else:
        await Account.filter(id=account_id).update(status="pending")
        _update_run(account_id, status="pending")

    return {
        "task_id": account_id,
        "account_id": account_id,
        "type": "register",
        "status": "pending" if not req.auto_start else "awaiting_otp",
    }


async def _run_register(
    account_id: str, req: AccountCreate, otp_future: asyncio.Future[str]
) -> None:
    from models import ProxyConfig
    from register import RegistrationSession

    otp_fn, is_manual = await _get_otp_fn(account_id, req.email, otp_future)
    _update_run(account_id, manual_otp=is_manual)

    async def password_provider() -> str:
        return req.password or "default_password_123!"

    with _VerboseCapture(account_id, req.verbose):
        try:
            _run_log(account_id, "Resolving proxy...")
            async with _ResolvedProxy(req.proxy_url) as resolved:
                if resolved.url != req.proxy_url:
                    _run_log(account_id, f"Proxy resolved to {resolved.url}")
                proxy = ProxyConfig(url=resolved.url)
                async with await RegistrationSession.create(proxy=proxy) as reg:
                    _run_log(account_id, "Checking IP region...")
                    await reg.check_region()
                    await asyncio.sleep(0.5)
                    _run_log(account_id, "Getting CSRF token...")
                    await reg.get_csrf()
                    await asyncio.sleep(0.5)
                    _run_log(account_id, f"Signing in as {req.email}...")
                    await reg.signin(req.email)
                    await asyncio.sleep(0.5)
                    _run_log(account_id, "Submitting email...")
                    page_type = await reg.submit_email()
                    _run_log(account_id, f"  page_type={page_type}")
                    await asyncio.sleep(0.5)
                    _run_log(account_id, "Setting password...")
                    await reg.set_password(password_provider)
                    await asyncio.sleep(0.5)

                    await Account.filter(id=account_id).update(status="awaiting_otp")
                    _update_run(account_id, status="awaiting_otp")
                    _run_log(account_id, "Waiting for OTP verification...")

                    await reg.verify_otp(otp_fn, timeout=180)
                    _update_run(account_id, status="running")
                    _run_log(account_id, "OTP verified. Creating account...")
                    await asyncio.sleep(0.5)
                    _run_log(
                        account_id,
                        f"  name={req.name}, birthdate={req.birthdate}, password={req.password}",
                    )
                    await reg.create_account(req.name, req.birthdate)
                    await asyncio.sleep(0.5)
                    _run_log(account_id, "Establishing session...")
                    session_data = await reg.establish_session()

                    access_token = ""
                    if isinstance(session_data, dict):
                        access_token = str(session_data.get("accessToken") or "")

                    await Account.filter(id=account_id).update(
                        status="active" if access_token else "session_invalid",
                        session_token=json.dumps(session_data),
                        access_token=access_token,
                        last_login=_now(),
                    )
                    _run_log(account_id, "Registration complete")
                    _update_run(
                        account_id,
                        output={
                            "account_id": account_id,
                            "access_token": bool(access_token),
                        },
                    )
                    _finish_run(account_id, status="success")
        except Exception as exc:
            await Account.filter(id=account_id).delete()
            _run_log(account_id, f"Error: {exc}")
            _finish_run(account_id, status="error", error=str(exc))
        finally:
            _pending_otps.pop(account_id, None)


@app.post("/api/accounts/import-session", response_model=AccountOut)
async def import_session(body: dict[str, Any]) -> dict[str, Any]:
    session_json = body.get("session_json", "")
    email = str(body.get("email", "")).strip()
    proxy_url = str(body.get("proxy_url", "")).strip() or None

    if isinstance(session_json, str):
        try:
            session_data = json.loads(session_json)
        except json.JSONDecodeError:
            raise HTTPException(400, "Invalid JSON")
    elif isinstance(session_json, dict):
        session_data = session_json
    else:
        raise HTTPException(400, "session_json must be a JSON string or object")

    if not isinstance(session_data, dict):
        raise HTTPException(400, "Session data must be a JSON object")

    access_token = str(session_data.get("accessToken") or "").strip()
    if not access_token:
        raise HTTPException(400, "Session JSON missing accessToken")

    if not email:
        user_info = session_data.get("user")
        if isinstance(user_info, dict):
            email = str(user_info.get("email") or "").strip()
    if not email:
        raise HTTPException(400, "Email is required (not found in session JSON either)")

    existing = await Account.filter(email=email).first()
    if existing:
        await Account.filter(id=existing.id).update(
            status="active",
            session_token=json.dumps(session_data),
            access_token=access_token,
            proxy_url=proxy_url,
            last_login=_now(),
        )
        account_id = existing.id
    else:
        account_id = str(uuid.uuid4())[:8]
        await Account.create(
            id=account_id,
            email=email,
            status="active",
            session_token=json.dumps(session_data),
            access_token=access_token,
            proxy_url=proxy_url,
            last_login=_now(),
            created_at=_now(),
        )

    try:
        return await refresh_account(account_id)
    except Exception:
        rows = await Account.filter(id=account_id).values()
        resolved = await _resolve_proxy_labels(rows)
        return resolved[0]


@app.post("/api/accounts/login", response_model=TaskOut)
async def login_account(req: LoginRequest) -> dict[str, str]:
    account_id = str(uuid.uuid4())[:8]

    existing = await Account.filter(email=req.email).first()
    if existing:
        account_id = existing.id
    else:
        await Account.create(
            id=account_id,
            email=req.email,
            status="logging_in",
            proxy_url=req.proxy_url,
            created_at=_now(),
        )
    await Account.filter(id=account_id).update(status="logging_in")

    await _register_run(
        account_id,
        workflow_type="login",
        email=req.email,
        proxy_url=req.proxy_url,
        run_name=req.run_name,
        params=req.model_dump(),
    )

    if req.auto_start:
        future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
        _pending_otps[account_id] = future
        _update_run(account_id, status="starting")
        asyncio.create_task(_run_login(account_id, req, future))
    else:
        await Account.filter(id=account_id).update(status="pending")
        _update_run(account_id, status="pending")

    return {
        "task_id": account_id,
        "account_id": account_id,
        "type": "login",
        "status": "pending" if not req.auto_start else "awaiting_otp",
    }


async def _run_login(
    account_id: str, req: LoginRequest, otp_future: asyncio.Future[str]
) -> None:
    from login import LoginSession
    from models import ProxyConfig

    otp_fn, is_manual = await _get_otp_fn(account_id, req.email, otp_future)
    _update_run(account_id, manual_otp=is_manual)

    with _VerboseCapture(account_id, req.verbose):
        try:
            _run_log(account_id, "Resolving proxy...")
            async with _ResolvedProxy(req.proxy_url) as resolved:
                if resolved.url != req.proxy_url:
                    _run_log(account_id, f"Proxy resolved to {resolved.url}")
                proxy = ProxyConfig(url=resolved.url)
                async with await LoginSession.create(proxy=proxy) as session:
                    _run_log(account_id, "Getting CSRF token...")
                    await session.get_csrf()
                    _run_log(account_id, f"Signing in as {req.email}...")
                    await session.signin(req.email)
                    _run_log(account_id, "Submitting email...")
                    await session.submit_email()

                    await Account.filter(id=account_id).update(status="awaiting_otp")
                    _update_run(account_id, status="awaiting_otp")
                    _run_log(account_id, "Waiting for OTP verification...")

                    await session.verify_otp(otp_fn, timeout=180)
                    _update_run(account_id, status="running")
                    _run_log(account_id, "OTP verified. Establishing session...")
                    session_data = await session.establish_session()

                    access_token = ""
                    if isinstance(session_data, dict):
                        access_token = str(session_data.get("accessToken") or "")

                    await Account.filter(id=account_id).update(
                        status="active" if access_token else "session_invalid",
                        session_token=json.dumps(session_data),
                        access_token=access_token,
                        cookies=json.dumps(session.cookies()),
                        last_login=_now(),
                    )
                    _run_log(account_id, "Login complete")
                    _update_run(
                        account_id,
                        output={
                            "account_id": account_id,
                            "access_token": bool(access_token),
                        },
                    )
                    _finish_run(account_id, status="success")
        except Exception as exc:
            await Account.filter(id=account_id).delete()
            _run_log(account_id, f"Error: {exc}")
            _finish_run(account_id, status="error", error=str(exc))
        finally:
            _pending_otps.pop(account_id, None)


@app.post("/api/accounts/otp")
async def submit_otp(req: OTPSubmit) -> dict[str, str]:
    future = _pending_otps.get(req.account_id)
    if not future:
        raise HTTPException(404, "No pending OTP for this account")
    if future.done():
        raise HTTPException(400, "OTP already submitted")
    future.set_result(req.otp)
    return {"status": "submitted"}


@app.post("/api/accounts/codex", response_model=TaskOut)
async def codex_oauth(req: CodexOAuthRequest) -> dict[str, str]:
    account = await Account.get_or_none(id=req.account_id)
    if not account:
        raise HTTPException(404, "Account not found")

    run_proxy = account.proxy_url if req.proxy_url is None else (req.proxy_url or None)
    await _register_run(
        req.account_id,
        workflow_type="codex_oauth",
        email=account.email,
        proxy_url=run_proxy,
        run_name=req.run_name,
        params=req.model_dump(),
    )

    if req.auto_start:
        future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
        _pending_otps[req.account_id] = future
        _update_run(req.account_id, status="starting")
        asyncio.create_task(_run_codex(req, future))
    else:
        _update_run(req.account_id, status="pending")

    return {
        "task_id": req.account_id,
        "account_id": req.account_id,
        "type": "codex_oauth",
        "status": "pending" if not req.auto_start else "awaiting_otp",
    }


async def _run_codex(req: CodexOAuthRequest, otp_future: asyncio.Future[str]) -> None:
    from models import ProxyConfig
    from oauth_codex import CodexOAuthSession

    account = await Account.get_or_none(id=req.account_id)
    if not account:
        _finish_run(req.account_id, status="error", error="Account not found")
        return

    otp_fn, is_manual = await _get_otp_fn(req.account_id, account.email, otp_future)
    _update_run(req.account_id, manual_otp=is_manual)

    with _VerboseCapture(req.account_id, req.verbose):
        try:
            if req.proxy_url is None:
                proxy_url = account.proxy_url
            elif req.proxy_url == "":
                proxy_url = None
            else:
                proxy_url = req.proxy_url
            _run_log(req.account_id, "Resolving proxy...")
            async with _ResolvedProxy(proxy_url) as resolved:
                if resolved.url != proxy_url:
                    _run_log(req.account_id, f"Proxy resolved to {resolved.url}")
                proxy = ProxyConfig(url=resolved.url) if resolved.url else None
                async with await CodexOAuthSession.create(
                    req.authorize_url, proxy=proxy
                ) as session:
                    _update_run(req.account_id, status="awaiting_otp")
                    _run_log(req.account_id, "Authorizing OAuth session...")
                    await session.authorize()
                    _run_log(req.account_id, f"Submitting email {account.email}...")
                    await session.submit_email(account.email)
                    _run_log(req.account_id, "Waiting for OTP verification...")
                    await session.verify_otp(otp_fn, timeout=180)
                    _update_run(req.account_id, status="running")
                    _run_log(req.account_id, "OTP verified. Selecting workspace...")
                    await session.select_workspace(req.workspace_id)

                    callback_url = session.callback_url or ""
                    _run_log(req.account_id, f"Callback URL: {callback_url}")
                    _update_run(req.account_id, callback_url=callback_url)
                    await Account.filter(id=req.account_id).update(
                        codex_token=callback_url,
                    )
                    _run_log(req.account_id, "Codex OAuth complete")
                    _update_run(
                        req.account_id,
                        output={
                            "callback_url": callback_url,
                        },
                    )
                    _finish_run(req.account_id, status="success")
        except Exception as exc:
            _run_log(req.account_id, f"Error: {exc}")
            _finish_run(req.account_id, status="error", error=str(exc))
        finally:
            _pending_otps.pop(req.account_id, None)


@app.post("/api/accounts/codex-device", response_model=TaskOut)
async def codex_device_login(req: CodexDeviceRequest) -> dict[str, str]:
    account = await Account.get_or_none(id=req.account_id)
    if not account:
        raise HTTPException(404, "Account not found")

    run_proxy = account.proxy_url if req.proxy_url is None else (req.proxy_url or None)
    await _register_run(
        req.account_id,
        workflow_type="codex_device",
        email=account.email,
        proxy_url=run_proxy,
        run_name=req.run_name or f"codex-device-{req.account_id[:6]}",
        params=req.model_dump(),
    )

    if req.auto_start:
        future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
        _pending_otps[req.account_id] = future
        _update_run(req.account_id, status="starting")
        asyncio.create_task(_run_codex_device(req, future))
    else:
        _update_run(req.account_id, status="pending")

    return {
        "task_id": req.account_id,
        "account_id": req.account_id,
        "type": "codex_device",
        "status": "pending" if not req.auto_start else "awaiting_otp",
    }


async def _run_codex_device(
    req: CodexDeviceRequest, otp_future: asyncio.Future[str]
) -> None:
    from codex_device import DeviceCodeSession
    from models import ProxyConfig

    account = await Account.get_or_none(id=req.account_id)
    if not account:
        _finish_run(req.account_id, status="error", error="Account not found")
        return

    otp_fn, is_manual = await _get_otp_fn(req.account_id, account.email, otp_future)
    _update_run(req.account_id, manual_otp=is_manual)

    with _VerboseCapture(req.account_id, req.verbose):
        try:
            if req.proxy_url is None:
                proxy_url = account.proxy_url
            elif req.proxy_url == "":
                proxy_url = None
            else:
                proxy_url = req.proxy_url
            _run_log(req.account_id, "Resolving proxy...")
            async with _ResolvedProxy(proxy_url) as resolved:
                if resolved.url != proxy_url:
                    _run_log(req.account_id, f"Proxy resolved to {resolved.url}")
                proxy = ProxyConfig(url=resolved.url) if resolved.url else None
                async with await DeviceCodeSession.create(
                    req.user_code, req.device_code, proxy=proxy
                ) as session:
                    _run_log(req.account_id, "Starting device auth flow...")
                    await session.start_device_auth()

                    _update_run(req.account_id, status="awaiting_otp")
                    _run_log(req.account_id, f"Submitting email {account.email}...")
                    await session.submit_email(account.email)

                    _run_log(req.account_id, "Waiting for OTP verification...")
                    await session.verify_otp(otp_fn, timeout=180)

                    _update_run(req.account_id, status="running")
                    _run_log(
                        req.account_id, f"Selecting workspace {req.workspace_id}..."
                    )
                    await session.select_workspace(req.workspace_id)

                    _run_log(req.account_id, "Authorizing device code...")
                    result = await session.authorize_device()

                    _run_log(
                        req.account_id,
                        f"Device auth result: {result.get('status')}",
                    )
                    _run_log(
                        req.account_id,
                        "Codex device login complete — CLI will pick up the authorization automatically",
                    )
                    _update_run(
                        req.account_id,
                        output={
                            "device_code": req.device_code,
                            "user_code": req.user_code,
                            "auth_result": result.get("status", "unknown"),
                        },
                    )
                    _finish_run(req.account_id, status="success")
        except Exception as exc:
            _run_log(req.account_id, f"Error: {exc}")
            _finish_run(req.account_id, status="error", error=str(exc))
        finally:
            _pending_otps.pop(req.account_id, None)


from app.db import CdkProvider


class _CdkHandler:
    def __init__(self, provider: CdkProvider) -> None:
        self.provider = provider
        self.base = provider.base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.provider.auth_type == "api_key" and self.provider.auth_value:
            h["X-API-Key"] = self.provider.auth_value
        elif self.provider.auth_type == "bearer" and self.provider.auth_value:
            h["Authorization"] = f"Bearer {self.provider.auth_value}"
        return h


class _ActivateCdkHandler(_CdkHandler):
    async def validate(self, client: Any, code: str) -> dict[str, Any]:
        resp = await client.get(f"{self.base}/keys/{code}", headers=self._headers())
        if resp.status_code != 200:
            raise HTTPException(
                resp.status_code, f"CDK validation failed: {resp.text[:300]}"
            )
        return resp.json()

    async def activate(
        self, client: Any, code: str, session_json: str
    ) -> dict[str, Any]:
        resp = await client.post(
            f"{self.base}/keys/activate-session",
            json={"code": code, "session": session_json},
            headers=self._headers(),
        )
        if resp.status_code != 200:
            raise HTTPException(
                resp.status_code, f"Activation failed: {resp.text[:300]}"
            )
        return resp.json()

    async def poll(self, client: Any, code: str) -> dict[str, Any]:
        resp = await client.get(
            f"{self.base}/keys/{code}/activation", headers=self._headers()
        )
        if resp.status_code != 200:
            return {"status": "polling_error", "status_code": resp.status_code}
        return resp.json()

    async def bulk_status(self, client: Any, codes: list[str]) -> dict[str, Any]:
        resp = await client.post(
            f"{self.base}/keys/bulk-status",
            json={"codes": codes},
            headers=self._headers(),
        )
        if resp.status_code != 200:
            raise HTTPException(
                resp.status_code, f"Bulk status failed: {resp.text[:300]}"
            )
        return resp.json()


_CDK_HANDLER_MAP: dict[str, type[_CdkHandler]] = {
    "activatecdk": _ActivateCdkHandler,
}


def _get_cdk_handler(provider: CdkProvider) -> _CdkHandler:
    cls = _CDK_HANDLER_MAP.get(provider.provider_type, _ActivateCdkHandler)
    return cls(provider)


async def _resolve_cdk_provider(provider_id: str) -> CdkProvider:
    p = await CdkProvider.get_or_none(id=provider_id)
    if not p:
        raise HTTPException(404, "CDK provider not found")
    if not p.is_enabled:
        raise HTTPException(400, "CDK provider is disabled")
    return p


@app.get("/api/cdk-providers")
async def list_cdk_providers() -> list[dict[str, Any]]:
    providers = await CdkProvider.all().order_by("-created_at")
    return [
        {
            "id": p.id,
            "name": p.name,
            "provider_type": p.provider_type,
            "base_url": p.base_url,
            "auth_type": p.auth_type,
            "is_enabled": p.is_enabled,
            "settings": p.settings,
            "created_at": p.created_at,
        }
        for p in providers
    ]


@app.post("/api/cdk-providers")
async def create_cdk_provider(body: dict[str, Any]) -> dict[str, Any]:
    pid = str(uuid.uuid4())[:8]
    name = str(body.get("name", "")).strip()
    provider_type = str(body.get("provider_type", "activatecdk")).strip()
    base_url = str(body.get("base_url", "")).strip()
    if not name or not base_url:
        raise HTTPException(400, "name and base_url are required")

    p = await CdkProvider.create(
        id=pid,
        name=name,
        provider_type=provider_type,
        base_url=base_url,
        auth_type=str(body.get("auth_type", "none")),
        auth_value=str(body.get("auth_value", "")),
        is_enabled=body.get("is_enabled", True),
        settings=body.get("settings"),
        created_at=_now(),
    )
    return {
        "id": p.id,
        "name": p.name,
        "provider_type": p.provider_type,
        "base_url": p.base_url,
    }


@app.patch("/api/cdk-providers/{provider_id}")
async def update_cdk_provider(provider_id: str, body: dict[str, Any]) -> dict[str, str]:
    p = await CdkProvider.get_or_none(id=provider_id)
    if not p:
        raise HTTPException(404, "CDK provider not found")
    updates: dict[str, Any] = {}
    for field in (
        "name",
        "provider_type",
        "base_url",
        "auth_type",
        "auth_value",
        "is_enabled",
        "settings",
    ):
        if field in body:
            updates[field] = body[field]
    if updates:
        await CdkProvider.filter(id=provider_id).update(**updates)
    return {"status": "updated"}


@app.delete("/api/cdk-providers/{provider_id}")
async def delete_cdk_provider(provider_id: str) -> dict[str, str]:
    deleted = await CdkProvider.filter(id=provider_id).delete()
    if not deleted:
        raise HTTPException(404, "CDK provider not found")
    return {"status": "deleted"}


@app.get("/api/cdk-providers/{provider_id}/validate/{code}")
async def cdk_validate(provider_id: str, code: str) -> dict[str, Any]:
    import httpx

    provider = await _resolve_cdk_provider(provider_id)
    handler = _get_cdk_handler(provider)
    async with httpx.AsyncClient(timeout=15) as client:
        return await handler.validate(client, code)


@app.post("/api/cdk-providers/{provider_id}/bulk-status")
async def cdk_bulk_status(provider_id: str, body: dict[str, Any]) -> dict[str, Any]:
    import httpx

    codes = body.get("codes", [])
    if not codes:
        raise HTTPException(400, "codes array is required")

    provider = await _resolve_cdk_provider(provider_id)
    handler = _get_cdk_handler(provider)
    async with httpx.AsyncClient(timeout=15) as client:
        return await handler.bulk_status(client, codes)


@app.post("/api/accounts/{account_id}/cdk-activate")
async def cdk_activate(account_id: str, body: dict[str, Any]) -> dict[str, str]:
    account = await Account.get_or_none(id=account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    if not account.session_token:
        raise HTTPException(400, "Account has no session data — login first")

    code = str(body.get("code", "")).strip()
    provider_id = str(body.get("provider_id", "")).strip()
    if not code:
        raise HTTPException(400, "CDK code is required")
    if not provider_id:
        raise HTTPException(400, "provider_id is required")

    await _resolve_cdk_provider(provider_id)

    run_id = f"cdk_{account_id[:6]}_{code[:6]}"
    await _register_run(
        run_id,
        workflow_type="cdk_activate",
        email=account.email,
        proxy_url=account.proxy_url,
        run_name=f"CDK {code}",
        params={"account_id": account_id, "code": code, "provider_id": provider_id},
    )
    _update_run(run_id, status="running")
    asyncio.create_task(_run_cdk_activate(run_id, account_id, code, provider_id))

    return {
        "task_id": run_id,
        "account_id": account_id,
        "type": "cdk_activate",
        "status": "running",
    }


async def _run_cdk_activate(
    run_id: str, account_id: str, code: str, provider_id: str
) -> None:
    import httpx

    account = await Account.get_or_none(id=account_id)
    if not account:
        _finish_run(run_id, status="error", error="Account not found")
        return

    provider = await CdkProvider.get_or_none(id=provider_id)
    if not provider:
        _finish_run(run_id, status="error", error="CDK provider not found")
        return

    handler = _get_cdk_handler(provider)

    try:
        _run_log(run_id, f"Validating CDK: {code} (provider: {provider.name})")
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                key_info = await handler.validate(client, code)
            except HTTPException as he:
                _run_log(run_id, f"Validation failed: {he.detail}")
                _finish_run(run_id, status="error", error=str(he.detail))
                return

            _run_log(
                run_id,
                f"CDK valid — plan: {key_info.get('plan')}, term: {key_info.get('term')}, status: {key_info.get('status')}",
            )

            if key_info.get("status") != "available":
                _finish_run(
                    run_id,
                    status="error",
                    error=f"CDK is not available (status: {key_info.get('status')})",
                )
                return

            session_json = account.session_token or ""
            if not session_json:
                _finish_run(run_id, status="error", error="No session JSON available")
                return

            _run_log(run_id, "Starting activation...")
            try:
                activate_data = await handler.activate(client, code, session_json)
            except HTTPException as he:
                _run_log(run_id, f"Activation failed: {he.detail}")
                _finish_run(run_id, status="error", error=str(he.detail))
                return

            _run_log(run_id, f"Activation started: {activate_data.get('status')}")

            _run_log(run_id, "Polling activation status...")
            for attempt in range(120):
                await asyncio.sleep(2)
                poll_data = await handler.poll(client, code)
                poll_status = poll_data.get("status", "").lower()

                if poll_status == "activated":
                    _run_log(
                        run_id, f"CDK activated for {poll_data.get('activated_email')}"
                    )
                    _update_run(
                        run_id,
                        output={
                            "code": code,
                            "provider": provider.name,
                            "plan": poll_data.get("plan"),
                            "term": poll_data.get("term"),
                            "activated_email": poll_data.get("activated_email"),
                        },
                    )
                    _finish_run(run_id, status="success")
                    return
                elif poll_status == "error":
                    _run_log(run_id, f"Activation error: {poll_data}")
                    _finish_run(
                        run_id,
                        status="error",
                        error=f"CDK activation error: {json.dumps(poll_data)}",
                    )
                    return
                elif attempt % 10 == 0:
                    _run_log(run_id, f"Still activating... (attempt {attempt + 1})")

            _finish_run(
                run_id, status="error", error="Activation timed out after 4 minutes"
            )
    except Exception as exc:
        _run_log(run_id, f"Error: {exc}")
        _finish_run(run_id, status="error", error=str(exc))


@app.post("/api/accounts/{account_id}/post-register", response_model=TaskOut)
async def post_register_flow(account_id: str) -> dict[str, str]:
    account = await Account.get_or_none(id=account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    if not account.access_token:
        raise HTTPException(400, "Account has no active session")

    run_id = str(uuid.uuid4())[:8]
    await _register_run(
        run_id,
        workflow_type="post_register",
        email=account.email,
        proxy_url=account.proxy_url,
        run_name=f"post-register-{account_id[:6]}",
    )
    _update_run(run_id, status="running")
    asyncio.create_task(_run_post_register(run_id, account_id))

    return {
        "task_id": run_id,
        "account_id": account_id,
        "type": "post_register",
        "status": "running",
    }


async def _run_post_register(run_id: str, account_id: str) -> None:
    import register as reg_module
    from curl_cffi.requests import AsyncSession

    account = await Account.get_or_none(id=account_id)
    if not account:
        _finish_run(run_id, status="error", error="Account not found")
        return

    log_handler = _RunLogHandler(run_id)
    log_handler.setFormatter(logging.Formatter("%(message)s"))
    log_handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    prev_level = root_logger.level
    root_logger.setLevel(logging.DEBUG)
    root_logger.addHandler(log_handler)

    try:
        _run_log(run_id, "Resolving proxy...")
        async with _ResolvedProxy(account.proxy_url) as resolved:
            if resolved.url != account.proxy_url:
                _run_log(run_id, f"Proxy resolved to {resolved.url}")
            proxies = (
                {"https": resolved.url, "http": resolved.url} if resolved.url else None
            )
            async with AsyncSession(
                proxies=proxies, impersonate="chrome136"
            ) as session:
                session.headers.update(
                    {"Authorization": f"Bearer {account.access_token}"}
                )
                _run_log(run_id, "Running post-registration flow...")
                result = await reg_module.register_flow(session)
                _run_log(run_id, f"Flow complete: {len(result)} steps executed")
                for key, val in result.items():
                    status = "OK" if val else "empty"
                    _run_log(run_id, f"  {key}: {status}")
                _finish_run(run_id, status="success")
    except Exception as exc:
        _run_log(run_id, f"Error: {exc}")
        _finish_run(run_id, status="error", error=str(exc))
    finally:
        root_logger.removeHandler(log_handler)
        root_logger.setLevel(prev_level)


@app.get("/api/users", response_model=list[UserOut])
async def list_users() -> list[dict[str, Any]]:
    users = await User.all().values()
    for u in users:
        u.setdefault("name", "")
        u.setdefault("role", "user")
    return users


@app.post("/api/users", response_model=UserOut)
async def create_user(request: Request, req: UserCreate) -> dict[str, Any]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    existing = await User.filter(email=req.email).first()
    if existing:
        raise HTTPException(409, "User with this email already exists")
    if req.role not in ("owner", "admin", "manager", "user"):
        raise HTTPException(400, "Invalid role")
    user_id = str(uuid.uuid4())[:8]
    user = await User.create(
        id=user_id,
        email=req.email,
        name=req.name,
        role=req.role,
        password_hash=_hash_password(req.password),
        created_at=_now(),
    )
    rows = await User.filter(id=user_id).values()
    return rows[0]


@app.delete("/api/users/{user_id}")
async def delete_user(request: Request, user_id: str) -> dict[str, str]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    target_role = user.role or "user"
    if (
        caller_role == "admin"
        and ROLE_HIERARCHY.get(target_role, 0) >= ROLE_HIERARCHY["admin"]
    ):
        raise HTTPException(403, "Cannot delete admin or owner users")
    if caller_role != "owner" and target_role == "owner":
        raise HTTPException(403, "Cannot delete owner")
    await user.delete()
    return {"status": "deleted"}


@app.patch("/api/users/{user_id}")
async def update_user(
    request: Request, user_id: str, req: UserUpdate
) -> dict[str, Any]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    target_role = user.role or "user"
    if (
        caller_role == "admin"
        and ROLE_HIERARCHY.get(target_role, 0) >= ROLE_HIERARCHY["admin"]
    ):
        raise HTTPException(403, "Cannot modify admin or owner users")
    if req.name is not None:
        user.name = req.name
    if req.email is not None:
        dup = await User.filter(email=req.email).exclude(id=user_id).first()
        if dup:
            raise HTTPException(409, "Email already in use")
        user.email = req.email
    if req.role is not None:
        if req.role not in ROLE_HIERARCHY:
            raise HTTPException(400, "Invalid role")
        if (
            caller_role == "admin"
            and ROLE_HIERARCHY.get(req.role, 0) >= ROLE_HIERARCHY["admin"]
        ):
            raise HTTPException(403, "Cannot assign admin or owner role")
        user.role = req.role
    await user.save()
    rows = await User.filter(id=user_id).values()
    return rows[0]


@app.post("/api/users/login")
async def user_login(req: UserLogin) -> dict[str, Any]:
    from datetime import datetime, timezone

    pw_hash = _hash_password(req.password)
    settings = await Settings.get_or_none(id=1)
    require_2fa = settings.require_2fa if settings else False
    password_expiry_days = settings.password_expiry_days if settings else 0

    user = await User.filter(email=req.email, password_hash=pw_hash).first()
    if not user:
        raise HTTPException(401, "Invalid email or password")

    user.last_login = _now()
    await user.save()
    totp_enabled = bool(user.totp_enabled)

    password_expired = False
    if password_expiry_days > 0:
        changed_at = user.password_changed_at or user.created_at or ""
        if changed_at:
            try:
                changed_dt = datetime.fromisoformat(changed_at.replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - changed_dt).days
                password_expired = elapsed >= password_expiry_days
            except (ValueError, TypeError):
                pass

    if totp_enabled:
        tfa_token = secrets.token_urlsafe(32)
        _2fa_sessions[tfa_token] = {
            "user_id": user.id,
            "created_at": time.time(),
        }
        return {
            "status": "2fa_required",
            "2fa_session": tfa_token,
            "totp_enabled": True,
            "require_2fa": require_2fa,
            "password_expired": password_expired,
        }
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "user_id": user.id,
        "email": user.email,
        "created_at": time.time(),
    }
    return {
        "status": "ok",
        "user": {"id": user.id, "email": user.email},
        "token": token,
        "totp_enabled": False,
        "require_2fa": require_2fa,
        "password_expired": password_expired,
    }


@app.get("/api/api-keys")
async def list_api_keys(request: Request) -> list[dict[str, Any]]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    return (
        await ApiKey.all()
        .order_by("-created_at")
        .values(
            "id",
            "name",
            "key_prefix",
            "user_id",
            "created_at",
            "last_used",
        )
    )


@app.post("/api/api-keys")
async def create_api_key(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")
    user_id = await _require_user_id(request)
    key = f"cam_{secrets.token_hex(16)}"
    api_key = {
        "id": _new_id(),
        "name": name,
        "key_hash": _api_key_hash(key),
        "key_prefix": key[:8],
        "user_id": user_id,
        "created_at": _now(),
        "last_used": None,
    }
    await ApiKey.create(**api_key)
    return {
        "id": api_key["id"],
        "name": api_key["name"],
        "key_prefix": api_key["key_prefix"],
        "user_id": api_key["user_id"],
        "created_at": api_key["created_at"],
        "last_used": api_key["last_used"],
        "key": key,
    }


@app.delete("/api/api-keys/{api_key_id}")
async def delete_api_key(request: Request, api_key_id: str) -> dict[str, str]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    deleted = await ApiKey.filter(id=api_key_id).delete()
    if not deleted:
        raise HTTPException(404, "API key not found")
    return {"status": "deleted"}


@app.get("/api/users/{user_id}")
async def get_user(user_id: str) -> dict[str, Any]:
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    rows = await User.filter(id=user_id).values()
    u = rows[0]
    u.setdefault("name", "")
    u.setdefault("last_login", "")
    u.setdefault("totp_enabled", False)
    u.setdefault("role", "user")
    return u


@app.post("/api/users/{user_id}/reset-password")
async def reset_user_password(
    request: Request, user_id: str, req: PasswordReset
) -> dict[str, str]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    target_role = user.role or "user"
    if (
        caller_role == "admin"
        and ROLE_HIERARCHY.get(target_role, 0) >= ROLE_HIERARCHY["admin"]
    ):
        raise HTTPException(403, "Cannot reset password for admin or owner users")
    if not req.new_password.strip():
        raise HTTPException(400, "Password cannot be empty")
    user.password_hash = _hash_password(req.new_password.strip())
    user.password_changed_at = _now()
    await user.save()
    return {"status": "password_reset"}


@app.get("/api/proxies", response_model=list[ProxyOut])
async def list_proxies() -> list[dict[str, Any]]:
    proxies = await Proxy.all().values()
    for p in proxies:
        p["url"] = _build_proxy_url(p)
    return proxies


@app.post("/api/proxies/test", response_model=ProxyTestResult)
async def test_proxy_url(req: ProxyCreate) -> dict[str, Any]:
    from curl_cffi.requests import AsyncSession as CurlSession

    proxy_data: dict[str, Any] = {
        "protocol": req.protocol,
        "host": req.host,
        "port": req.port,
        "username": req.username,
        "password": req.password,
    }
    proxy_url = _build_proxy_url(proxy_data)

    try:
        start = time.monotonic()
        async with CurlSession(
            proxies={"http": proxy_url, "https": proxy_url},
            impersonate="chrome136",
        ) as session:
            trace_resp = await session.get(
                "https://cloudflare.com/cdn-cgi/trace", timeout=15
            )
            latency = int((time.monotonic() - start) * 1000)

            ip = ""
            loc = ""
            ip_match = re.search(r"^ip=(.+)$", trace_resp.text, re.MULTILINE)
            if ip_match:
                ip = ip_match.group(1).strip()
            loc_match = re.search(r"^loc=(.+)$", trace_resp.text, re.MULTILINE)
            if loc_match:
                loc = loc_match.group(1).strip()

            geo_resp = await session.get(
                f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,timezone,as,org",
                timeout=10,
            )
            geo = geo_resp.json() if geo_resp.status_code == 200 else {}
            if not isinstance(geo, dict):
                geo = {}

        return {
            "ip": ip,
            "country": geo.get("country", loc),
            "country_code": geo.get("countryCode", loc),
            "region": geo.get("regionName", ""),
            "city": geo.get("city", ""),
            "asn": geo.get("as", ""),
            "org": geo.get("org", ""),
            "timezone": geo.get("timezone", ""),
            "latency_ms": latency,
        }
    except Exception as exc:
        raise HTTPException(502, f"Proxy test failed: {exc}")


@app.post("/api/proxies", response_model=ProxyOut)
async def create_proxy(req: ProxyCreate) -> dict[str, Any]:
    proxy_id = str(uuid.uuid4())[:8]
    proxy_data: dict[str, Any] = {
        "id": proxy_id,
        "protocol": req.protocol,
        "host": req.host,
        "port": req.port,
        "username": req.username,
        "password": req.password,
        "label": req.label or f"{req.host}:{req.port}",
        "created_at": _now(),
        "last_test": None,
    }
    proxy_data["url"] = _build_proxy_url(proxy_data)
    await Proxy.create(**proxy_data)
    return proxy_data


@app.delete("/api/proxies/{proxy_id}")
async def delete_proxy(proxy_id: str) -> dict[str, str]:
    deleted = await Proxy.filter(id=proxy_id).delete()
    if not deleted:
        raise HTTPException(404, "Proxy not found")
    return {"status": "deleted"}


@app.patch("/api/proxies/{proxy_id}")
async def update_proxy_label(proxy_id: str, body: dict[str, Any]) -> dict[str, Any]:
    proxy = await Proxy.get_or_none(id=proxy_id)
    if not proxy:
        raise HTTPException(404, "Proxy not found")
    new_label = body.get("label")
    if new_label is not None:
        proxy.label = new_label
        await proxy.save()
    row = {
        "id": proxy.id,
        "protocol": proxy.protocol,
        "host": proxy.host,
        "port": proxy.port,
        "username": proxy.username,
        "password": proxy.password,
        "label": proxy.label,
        "group": proxy.group,
        "subscription_id": proxy.subscription_id or "",
        "url": proxy.url,
        "created_at": proxy.created_at,
        "last_test": proxy.last_test,
    }
    return row


@app.post("/api/proxies/{proxy_id}/test", response_model=ProxyTestResult)
async def test_proxy(proxy_id: str) -> dict[str, Any]:
    from curl_cffi.requests import AsyncSession as CurlSession

    proxy = await Proxy.get_or_none(id=proxy_id)
    if not proxy:
        raise HTTPException(404, "Proxy not found")

    xray_protocols = {"vmess", "vless", "trojan", "shadowsocks"}
    xray_node_id = None
    proxy_url = ""

    try:
        if proxy.protocol in xray_protocols and proxy.subscription_id is not None:
            from app.xray_manager import start_node, stop_node

            sub = await Subscription.get_or_none(id=proxy.subscription_id)
            if not sub:
                raise HTTPException(400, "Subscription not found for this proxy")
            node_index = proxy.node_index or 0
            nodes = sub.nodes or []
            if node_index >= len(nodes):
                raise HTTPException(400, "Node not found in subscription")
            node = nodes[node_index]
            xray_node_id = f"{proxy.subscription_id}:{node_index}"
            port = await start_node(xray_node_id, node)
            proxy_url = f"socks5://127.0.0.1:{port}"
        else:
            p = await Proxy.filter(id=proxy_id).first().values()
            proxy_url = _build_proxy_url(p)

        start = time.monotonic()
        async with CurlSession(
            proxies={"http": proxy_url, "https": proxy_url},
            impersonate="chrome136",
        ) as session:
            trace_resp = await session.get(
                "https://cloudflare.com/cdn-cgi/trace", timeout=15
            )
            latency = int((time.monotonic() - start) * 1000)

            ip = ""
            loc = ""
            ip_match = re.search(r"^ip=(.+)$", trace_resp.text, re.MULTILINE)
            if ip_match:
                ip = ip_match.group(1).strip()
            loc_match = re.search(r"^loc=(.+)$", trace_resp.text, re.MULTILINE)
            if loc_match:
                loc = loc_match.group(1).strip()

            geo_resp = await session.get(
                f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,timezone,as,org",
                timeout=10,
            )
            geo = geo_resp.json() if geo_resp.status_code == 200 else {}
            if not isinstance(geo, dict):
                geo = {}

        result: dict[str, Any] = {
            "ip": ip,
            "country": geo.get("country", loc),
            "country_code": geo.get("countryCode", loc),
            "region": geo.get("regionName", ""),
            "city": geo.get("city", ""),
            "asn": geo.get("as", ""),
            "org": geo.get("org", ""),
            "timezone": geo.get("timezone", ""),
            "latency_ms": latency,
        }

        proxy.last_test = result
        await proxy.save()

        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Proxy test failed: {exc}")
    finally:
        if xray_node_id:
            from app.xray_manager import stop_node

            await stop_node(xray_node_id)


@app.get("/api/outlook", response_model=OutlookConfigOut)
async def get_outlook_config() -> dict[str, Any]:
    cfg = await OutlookConfigDB.get_or_none(id=1)
    if not cfg:
        return {"configured": False, "tenant_id": "", "client_id": ""}
    return {
        "configured": bool(cfg.tenant_id and cfg.client_id and cfg.client_secret),
        "tenant_id": cfg.tenant_id or "",
        "client_id": cfg.client_id or "",
    }


@app.post("/api/outlook", response_model=OutlookConfigOut)
async def set_outlook_config(req: OutlookConfigSchema) -> dict[str, Any]:
    from app.outlook_otp import configure

    await OutlookConfigDB.update_or_create(
        id=1,
        defaults={
            "tenant_id": req.tenant_id,
            "client_id": req.client_id,
            "client_secret": req.client_secret,
        },
    )
    configure(req.tenant_id, req.client_id, req.client_secret)
    return {
        "configured": True,
        "tenant_id": req.tenant_id,
        "client_id": req.client_id,
    }


_OTP_PATTERN = re.compile(r"code is\s*(\d{6})", re.IGNORECASE)
_OTP_FALLBACK = re.compile(r"\b\d{6}\b")


def _extract_mail_otp(text: str) -> str | None:
    match = _OTP_PATTERN.search(text)
    if match:
        return match.group(1)
    fallback = _OTP_FALLBACK.search(text)
    return fallback.group(0) if fallback else None


@app.get("/api/mailboxes", response_model=list[MailboxOut])
async def list_mailboxes() -> list[dict[str, Any]]:
    return await Mailbox.all().values()


@app.post("/api/mailboxes", response_model=MailboxOut)
async def create_mailbox(req: MailboxCreate) -> dict[str, Any]:
    existing = await Mailbox.filter(email=req.email).first()
    if existing:
        raise HTTPException(409, "Mailbox already exists")
    mb_id = str(uuid.uuid4())[:8]
    await Mailbox.create(
        id=mb_id,
        email=req.email,
        password=req.password,
        refresh_token=req.refresh_token,
        client_id=req.client_id,
        status="available",
        created_at=_now(),
    )
    rows = await Mailbox.filter(id=mb_id).values()
    return rows[0]


def _parse_mailbox_lines(text: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for line in text.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("----")
        if len(parts) >= 4:
            results.append(
                {
                    "email": parts[0].strip(),
                    "password": parts[1].strip(),
                    "refresh_token": parts[2].strip(),
                    "client_id": parts[3].strip(),
                }
            )
        elif len(parts) == 2:
            results.append(
                {
                    "email": parts[0].strip(),
                    "password": parts[1].strip(),
                    "refresh_token": "",
                    "client_id": "",
                }
            )
        elif "@" in parts[0]:
            results.append(
                {
                    "email": parts[0].strip(),
                    "password": "",
                    "refresh_token": "",
                    "client_id": "",
                }
            )
    return results


async def _import_mailbox_items(items: list[dict[str, str]]) -> dict[str, int]:
    imported = 0
    skipped = 0
    for item in items:
        email = item.get("email", "").strip()
        if not email:
            continue
        exists = await Mailbox.filter(email=email).exists()
        if exists:
            skipped += 1
            continue
        mb_id = str(uuid.uuid4())[:8]
        await Mailbox.create(
            id=mb_id,
            email=email,
            password=item.get("password", ""),
            refresh_token=item.get("refresh_token", ""),
            client_id=item.get("client_id", ""),
            status="available",
            created_at=_now(),
        )
        imported += 1
    return {"imported": imported, "skipped": skipped}


@app.post("/api/mailboxes/import")
async def import_mailboxes(items: list[MailboxCreate]) -> dict[str, Any]:
    parsed = [
        {
            "email": item.email,
            "password": item.password,
            "refresh_token": item.refresh_token,
            "client_id": item.client_id,
        }
        for item in items
    ]
    return await _import_mailbox_items(parsed)


@app.post("/api/mailboxes/import-text")
async def import_mailboxes_text(body: dict[str, str]) -> dict[str, Any]:
    text = body.get("text", "")
    if not text.strip():
        raise HTTPException(400, "Empty text")

    text = text.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            if not isinstance(data, list):
                raise HTTPException(400, "JSON must be an array")
            items = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                items.append(
                    {
                        "email": item.get("Email") or item.get("email") or "",
                        "password": item.get("Password") or item.get("password") or "",
                        "refresh_token": item.get("RefreshToken")
                        or item.get("refreshToken")
                        or item.get("refresh_token")
                        or "",
                        "client_id": item.get("ClientId")
                        or item.get("clientId")
                        or item.get("client_id")
                        or "",
                    }
                )
            return await _import_mailbox_items(items)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Invalid JSON: {exc}")

    return await _import_mailbox_items(_parse_mailbox_lines(text))


@app.post("/api/mailboxes/import-file")
async def import_mailboxes_file(file: UploadFile) -> dict[str, Any]:
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded")

    text = text.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            if not isinstance(data, list):
                raise HTTPException(400, "JSON must be an array")
            items = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                items.append(
                    {
                        "email": item.get("Email") or item.get("email") or "",
                        "password": item.get("Password") or item.get("password") or "",
                        "refresh_token": item.get("RefreshToken")
                        or item.get("refreshToken")
                        or item.get("refresh_token")
                        or "",
                        "client_id": item.get("ClientId")
                        or item.get("clientId")
                        or item.get("client_id")
                        or "",
                    }
                )
            return await _import_mailbox_items(items)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Invalid JSON: {exc}")

    return await _import_mailbox_items(_parse_mailbox_lines(text))


@app.delete("/api/mailboxes/{mb_id}")
async def delete_mailbox(mb_id: str) -> dict[str, str]:
    deleted = await Mailbox.filter(id=mb_id).delete()
    if not deleted:
        raise HTTPException(404, "Mailbox not found")
    return {"status": "deleted"}


@app.post("/api/mailboxes/{mb_id}/claim")
async def claim_mailbox(mb_id: str, account_id: str = "") -> dict[str, Any]:
    mb = await Mailbox.get_or_none(id=mb_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")
    mb.status = "assigned"
    if account_id:
        mb.assigned_account_id = account_id
    await mb.save()
    rows = await Mailbox.filter(id=mb_id).values()
    return rows[0]


@app.post("/api/mailboxes/{mb_id}/unassign")
async def unassign_mailbox(mb_id: str) -> dict[str, Any]:
    mb = await Mailbox.get_or_none(id=mb_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")
    mb.status = "available"
    mb.assigned_account_id = None
    await mb.save()
    rows = await Mailbox.filter(id=mb_id).values()
    return rows[0]


async def _exchange_outlook_token(refresh_token: str, client_id: str) -> str:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data={
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": "https://graph.microsoft.com/.default offline_access",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Token exchange failed: {resp.text[:200]}")
        return resp.json()["access_token"]


@app.get("/api/mailboxes/{mb_id}/mails", response_model=list[MailboxMailSummary])
async def get_mailbox_mails(mb_id: str) -> list[dict[str, Any]]:
    mb = await Mailbox.get_or_none(id=mb_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")

    refresh_token = mb.refresh_token or ""
    client_id = mb.client_id or ""
    if not refresh_token or not client_id:
        raise HTTPException(400, "Mailbox missing refresh_token or client_id")

    access_token = await _exchange_outlook_token(refresh_token, client_id)

    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for folder in ("inbox", "junkemail"):
            url = (
                f"https://graph.microsoft.com/v1.0/me/mailFolders/"
                f"{folder}/messages?$top=20&$orderby=receivedDateTime desc"
                f"&$select=id,subject,receivedDateTime,from,bodyPreview"
            )
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code >= 400:
                continue
            data = resp.json()
            for msg in data.get("value", []):
                from_obj = msg.get("from", {})
                from_addr = ""
                ea = (
                    from_obj.get("emailAddress", {})
                    if isinstance(from_obj, dict)
                    else {}
                )
                if isinstance(ea, dict):
                    from_addr = ea.get("address", "")

                subject = msg.get("subject", "")
                preview = msg.get("bodyPreview", "")
                otp = _extract_mail_otp(f"{subject} {preview}")

                results.append(
                    {
                        "id": msg.get("id", ""),
                        "from_addr": from_addr,
                        "subject": subject,
                        "received_at": msg.get("receivedDateTime", ""),
                        "is_otp": otp is not None,
                        "otp_code": otp,
                    }
                )

    results.sort(key=lambda x: x.get("received_at", ""), reverse=True)
    return results


@app.get("/api/mailboxes/{mb_id}/otp")
async def get_mailbox_otp(mb_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone, timedelta

    mb = await Mailbox.get_or_none(id=mb_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")

    refresh_token = mb.refresh_token or ""
    client_id = mb.client_id or ""
    if not refresh_token or not client_id:
        raise HTTPException(400, "Mailbox missing refresh_token or client_id")

    access_token = await _exchange_outlook_token(refresh_token, client_id)
    cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=2)

    async with httpx.AsyncClient(timeout=30) as client:
        for folder in ("inbox", "junkemail"):
            url = (
                f"https://graph.microsoft.com/v1.0/me/mailFolders/"
                f"{folder}/messages?$top=10&$orderby=receivedDateTime desc"
                f"&$select=id,subject,receivedDateTime,from,bodyPreview"
            )
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code >= 400:
                continue
            data = resp.json()
            for msg in data.get("value", []):
                from_obj = msg.get("from", {})
                from_addr = ""
                if isinstance(from_obj, dict):
                    ea = from_obj.get("emailAddress", {})
                    if isinstance(ea, dict):
                        from_addr = ea.get("address", "")
                if from_addr.lower() != "noreply@tm.openai.com":
                    continue
                received = msg.get("receivedDateTime", "")
                if received:
                    try:
                        received_dt = datetime.fromisoformat(
                            received.replace("Z", "+00:00")
                        )
                        if received_dt < cutoff_dt:
                            continue
                    except ValueError:
                        pass
                subject = msg.get("subject", "")
                preview = msg.get("bodyPreview", "")
                otp = _extract_mail_otp(f"{subject} {preview}")
                if otp:
                    return {
                        "otp_code": otp,
                        "subject": subject,
                        "received_at": msg.get("receivedDateTime", ""),
                    }

    raise HTTPException(404, "No OTP found in the last 2 minutes")


@app.get("/api/mailboxes/{mb_id}/mails/{mail_id}", response_model=MailboxMailDetail)
async def get_mailbox_mail(mb_id: str, mail_id: str) -> dict[str, Any]:
    mb = await Mailbox.get_or_none(id=mb_id)
    if not mb:
        raise HTTPException(404, "Mailbox not found")

    refresh_token = mb.refresh_token or ""
    client_id = mb.client_id or ""
    if not refresh_token or not client_id:
        raise HTTPException(400, "Mailbox missing refresh_token or client_id")

    access_token = await _exchange_outlook_token(refresh_token, client_id)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://graph.microsoft.com/v1.0/me/messages/{mail_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if resp.status_code == 404:
        raise HTTPException(404, "Mail not found")
    if resp.status_code >= 400:
        raise HTTPException(502, "Failed to fetch mail")

    msg = resp.json()
    if not isinstance(msg, dict):
        raise HTTPException(502, "Invalid response")

    from_obj = msg.get("from", {})
    from_addr = ""
    if isinstance(from_obj, dict):
        ea = from_obj.get("emailAddress", {})
        if isinstance(ea, dict):
            from_addr = ea.get("address", "")

    body_obj = msg.get("body", {})
    body_text = ""
    if isinstance(body_obj, dict):
        body_text = body_obj.get("content", "")

    subject = msg.get("subject", "")
    otp = _extract_mail_otp(f"{subject} {re.sub(r'<[^>]+>', ' ', body_text)}")

    return {
        "id": msg.get("id", mail_id),
        "from_addr": from_addr,
        "subject": subject,
        "body": body_text,
        "received_at": msg.get("receivedDateTime", ""),
        "is_otp": otp is not None,
        "otp_code": otp,
    }


_proxy_tokens: dict[str, float] = {}
PROXY_TOKEN_TTL = 600


@app.post("/api/proxy-session")
async def create_proxy_session() -> dict[str, str]:
    token = secrets.token_urlsafe(32)
    _proxy_tokens[token] = time.time() + PROXY_TOKEN_TTL
    return {"token": token}


@app.get("/api/proxy-resource")
async def proxy_resource(url: str = "", token: str = "") -> Any:
    from fastapi.responses import Response

    if not token or token not in _proxy_tokens:
        raise HTTPException(403, "Invalid or missing session token")
    if _proxy_tokens[token] < time.time():
        del _proxy_tokens[token]
        raise HTTPException(403, "Session expired")

    if not url:
        raise HTTPException(400, "Missing url parameter")

    allowed_schemes = ("http://", "https://")
    if not any(url.startswith(s) for s in allowed_schemes):
        raise HTTPException(400, "Invalid URL scheme")

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url)
        content_type = resp.headers.get("content-type", "application/octet-stream")
        return Response(
            content=resp.content,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=3600"},
        )
    except Exception as exc:
        raise HTTPException(502, f"Failed to fetch resource: {exc}")


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    s = await Settings.get_or_none(id=1)
    if not s:
        return {
            "org_name": "ChatGPT Account Manager",
            "allowed_ips": [],
            "require_2fa": False,
            "allow_email_change": False,
            "allow_password_change": True,
            "password_expiry_days": 0,
            "session_timeout_min": 0,
            "share_policy": {
                "enabled": True,
                "max_hours": 720,
                "allow_session": True,
                "allow_mailbox": True,
                "allowed_roles": ["admin", "manager", "operator"],
            },
            "access_policy": {"session_view_roles": ["admin"]},
        }
    return {
        "org_name": s.org_name,
        "allowed_ips": s.allowed_ips,
        "require_2fa": s.require_2fa,
        "allow_email_change": s.allow_email_change,
        "allow_password_change": s.allow_password_change,
        "password_expiry_days": s.password_expiry_days,
        "session_timeout_min": s.session_timeout_min,
        "share_policy": s.share_policy,
        "access_policy": s.access_policy,
    }


@app.post("/api/settings")
async def save_settings(request: Request, req: OrgSettings) -> dict[str, Any]:
    caller_role = await _get_caller_role(request)
    if ROLE_HIERARCHY.get(caller_role, 0) < ROLE_HIERARCHY["admin"]:
        raise HTTPException(403, "Insufficient permissions")
    await Settings.update_or_create(
        id=1,
        defaults={
            "org_name": req.org_name,
            "allowed_ips": req.allowed_ips,
            "require_2fa": req.require_2fa,
            "allow_email_change": req.allow_email_change,
            "allow_password_change": req.allow_password_change,
            "password_expiry_days": req.password_expiry_days,
            "session_timeout_min": req.session_timeout_min,
            "share_policy": req.share_policy.model_dump() if req.share_policy else {},
            "access_policy": req.access_policy.model_dump()
            if req.access_policy
            else {},
        },
    )
    return {
        "org_name": req.org_name,
        "allowed_ips": req.allowed_ips,
        "require_2fa": req.require_2fa,
        "allow_email_change": req.allow_email_change,
        "allow_password_change": req.allow_password_change,
        "password_expiry_days": req.password_expiry_days,
        "session_timeout_min": req.session_timeout_min,
        "share_policy": req.share_policy.model_dump() if req.share_policy else {},
        "access_policy": req.access_policy.model_dump() if req.access_policy else {},
    }


@app.post("/api/users/{user_id}/totp-setup", response_model=TOTPSetupOut)
async def totp_setup(user_id: str) -> dict[str, Any]:
    import base64
    import io
    import pyotp
    import qrcode

    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")

    secret = pyotp.random_base32()
    user.totp_secret = secret
    await user.save()

    email = user.email or "user"
    settings = await Settings.get_or_none(id=1)
    issuer = settings.org_name if settings else "ChatGPT Manager"
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)

    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    return {"secret": secret, "qr_uri": uri, "qr_base64": qr_b64}


@app.post("/api/users/{user_id}/totp-verify")
async def totp_verify(user_id: str, req: TOTPVerify) -> dict[str, str]:
    import pyotp

    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    secret = user.totp_secret or ""
    if not secret:
        raise HTTPException(400, "2FA not set up")
    totp = pyotp.TOTP(secret)
    if not totp.verify(req.code, valid_window=1):
        raise HTTPException(401, "Invalid 2FA code")
    user.totp_enabled = True
    await user.save()
    return {"status": "verified"}


@app.post("/api/users/{user_id}/totp-disable")
async def totp_disable(user_id: str) -> dict[str, str]:
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.totp_secret = None
    user.totp_enabled = False
    await user.save()
    return {"status": "disabled"}


@app.post("/api/users/{user_id}/profile")
async def update_profile(user_id: str, req: UserProfileUpdate) -> dict[str, str]:
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if req.name is not None:
        user.name = req.name
    if req.new_password and req.new_password.strip():
        user.password_hash = _hash_password(req.new_password.strip())
    await user.save()
    return {"status": "updated"}


@app.post("/api/auth/verify-2fa")
async def verify_2fa_login(body: dict[str, str]) -> dict[str, Any]:
    import pyotp

    session_token = body.get("2fa_session", "")
    code = body.get("code", "")
    if not session_token or session_token not in _2fa_sessions:
        raise HTTPException(401, "Invalid or expired 2FA session")

    session_data = _2fa_sessions[session_token]
    if time.time() - session_data["created_at"] > 300:
        del _2fa_sessions[session_token]
        raise HTTPException(401, "2FA session expired")

    user_id = session_data["user_id"]
    user = await User.get_or_none(id=user_id)
    if not user:
        del _2fa_sessions[session_token]
        raise HTTPException(404, "User not found")
    secret = user.totp_secret or ""
    if not secret:
        del _2fa_sessions[session_token]
        raise HTTPException(400, "2FA not configured")
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(401, "Invalid 2FA code")

    del _2fa_sessions[session_token]
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "user_id": user_id,
        "email": user.email,
        "created_at": time.time(),
    }
    return {"status": "ok", "token": token}


@app.get("/api/auth/me")
async def auth_me(request: StarletteRequest) -> dict[str, Any]:
    auth_user = await _get_auth_user(request)
    if not auth_user:
        raise HTTPException(401, "Not authenticated")
    user = await User.get_or_none(id=auth_user["user_id"])
    if not user:
        raise HTTPException(401, "User not found")
    settings = await Settings.get_or_none(id=1)
    return {
        "user": {"id": user.id, "email": user.email},
        "role": user.role or "user",
        "totp_enabled": bool(user.totp_enabled),
        "require_2fa": settings.require_2fa if settings else False,
    }


@app.post("/api/auth/logout")
async def auth_logout(request: StarletteRequest) -> dict[str, str]:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        _sessions.pop(token, None)
    return {"status": "ok"}


@app.post("/api/me/profile")
async def me_profile(request: Request, req: UserProfileUpdate) -> dict[str, str]:
    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if req.email is not None:
        settings = await Settings.get_or_none(id=1)
        if not (settings and settings.allow_email_change):
            raise HTTPException(403, "Email change is disabled by administrator")
        dup = await User.filter(email=req.email).exclude(id=user_id).first()
        if dup:
            raise HTTPException(409, "Email already in use")
        user.email = req.email
    if req.name is not None:
        user.name = req.name
    await user.save()
    return {"status": "updated"}


@app.post("/api/me/change-password")
async def me_change_password(request: Request, req: ChangePassword) -> dict[str, str]:
    import pyotp

    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    settings = await Settings.get_or_none(id=1)
    if settings and not settings.allow_password_change:
        raise HTTPException(403, "Password change is disabled by administrator")
    if user.password_hash != _hash_password(req.current_password):
        raise HTTPException(401, "Current password is incorrect")
    if user.totp_enabled:
        if not req.totp_code:
            raise HTTPException(400, "2FA code required")
        secret = user.totp_secret or ""
        if not secret or not pyotp.TOTP(secret).verify(req.totp_code, valid_window=1):
            raise HTTPException(401, "Invalid 2FA code")
    if not req.new_password.strip():
        raise HTTPException(400, "New password cannot be empty")
    user.password_hash = _hash_password(req.new_password.strip())
    user.password_changed_at = _now()
    await user.save()
    return {"status": "password_changed"}


@app.post("/api/me/totp-setup", response_model=TOTPSetupOut)
async def me_totp_setup(request: Request) -> dict[str, Any]:
    import base64
    import io
    import pyotp
    import qrcode

    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")

    secret = pyotp.random_base32()
    user.totp_secret = secret
    await user.save()

    email = user.email or "user"
    settings = await Settings.get_or_none(id=1)
    issuer = settings.org_name if settings else "ChatGPT Manager"
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)

    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    return {"secret": secret, "qr_uri": uri, "qr_base64": qr_b64}


@app.post("/api/me/totp-verify")
async def me_totp_verify(request: Request, req: TOTPVerify) -> dict[str, str]:
    import pyotp

    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    secret = user.totp_secret or ""
    if not secret:
        raise HTTPException(400, "2FA not set up")
    totp = pyotp.TOTP(secret)
    if not totp.verify(req.code, valid_window=1):
        raise HTTPException(401, "Invalid 2FA code")
    user.totp_enabled = True
    await user.save()
    return {"status": "verified"}


@app.post("/api/me/totp-disable")
async def me_totp_disable(request: Request) -> dict[str, str]:
    user_id = await _require_user_id(request)
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.totp_secret = None
    user.totp_enabled = False
    await user.save()
    return {"status": "disabled"}


@app.get("/api/owner-contact")
async def get_owner_contact() -> dict[str, str]:
    owner = await User.filter(role="owner").first()
    settings = await Settings.first()
    org_name = settings.org_name if settings else "ChatGPT Account Manager"
    return {
        "email": owner.email if owner else "",
        "org_name": org_name,
    }


@app.get("/api/subscriptions")
async def list_subscriptions() -> list[dict[str, Any]]:
    subs = await Subscription.all().values()
    for s in subs:
        s["metadata"] = s.pop("metadata_", {})
    return subs


@app.post("/api/subscriptions/preview")
async def preview_subscription(req: SubscriptionCreate) -> dict[str, Any]:
    from app.subscription import extract_url, parse_subscription

    actual_url = extract_url(req.url)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(actual_url)
        resp.raise_for_status()
        raw = resp.text

    nodes, metadata = parse_subscription(raw)
    return {
        "name": req.name,
        "url": req.url,
        "resolved_url": actual_url,
        "node_count": len(nodes),
        "metadata": metadata,
        "nodes": [
            {
                "protocol": n["protocol"],
                "name": n.get("name", ""),
                "address": n.get("address", ""),
                "port": n.get("port", 0),
            }
            for n in nodes
        ],
    }


@app.post("/api/subscriptions")
async def create_subscription(req: SubscriptionCreate) -> dict[str, Any]:
    from app.subscription import extract_url, parse_subscription

    sub_id = str(uuid.uuid4())[:8]

    actual_url = extract_url(req.url)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(actual_url)
        resp.raise_for_status()
        raw = resp.text

    nodes, metadata = parse_subscription(raw)
    sub = await Subscription.create(
        id=sub_id,
        name=req.name,
        url=req.url,
        resolved_url=actual_url,
        nodes=nodes,
        metadata_=metadata,
        updated_at=_now(),
    )

    for i, node in enumerate(nodes):
        proxy_id = str(uuid.uuid4())[:8]
        await Proxy.create(
            id=proxy_id,
            protocol=node["protocol"],
            host=node.get("address", ""),
            port=node.get("port", 0),
            username="",
            password="",
            label=node.get("name", "")
            or f"{node['protocol']}:{node.get('address', '')}",
            group=req.name,
            subscription_id=sub_id,
            node_index=i,
            url=f"{node['protocol']}://{node.get('address', '')}:{node.get('port', 0)}",
            created_at=_now(),
        )

    result = await Subscription.filter(id=sub_id).values()
    r = result[0]
    r["metadata"] = r.pop("metadata_", {})
    return r


@app.post("/api/subscriptions/{sub_id}/refresh")
async def refresh_subscription(sub_id: str) -> dict[str, Any]:
    from app.subscription import extract_url, parse_subscription

    sub = await Subscription.get_or_none(id=sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")

    actual_url = extract_url(sub.resolved_url or sub.url)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(actual_url)
        resp.raise_for_status()
        raw = resp.text

    nodes, metadata = parse_subscription(raw)
    sub.nodes = nodes
    sub.metadata_ = metadata
    sub.updated_at = _now()
    await sub.save()

    existing_proxies = await Proxy.filter(subscription_id=sub_id).all()
    existing_by_index: dict[int, Any] = {
        p.node_index: p for p in existing_proxies if p.node_index is not None
    }

    new_indices = set(range(len(nodes)))
    old_indices = set(existing_by_index.keys())

    for idx in old_indices - new_indices:
        await Proxy.filter(id=existing_by_index[idx].id).delete()

    for i, node in enumerate(nodes):
        if i in existing_by_index:
            await Proxy.filter(id=existing_by_index[i].id).update(
                protocol=node["protocol"],
                host=node.get("address", ""),
                port=node.get("port", 0),
                label=node.get("name", "")
                or f"{node['protocol']}:{node.get('address', '')}",
                url=f"{node['protocol']}://{node.get('address', '')}:{node.get('port', 0)}",
            )
        else:
            proxy_id = str(uuid.uuid4())[:8]
            await Proxy.create(
                id=proxy_id,
                protocol=node["protocol"],
                host=node.get("address", ""),
                port=node.get("port", 0),
                username="",
                password="",
                label=node.get("name", "")
                or f"{node['protocol']}:{node.get('address', '')}",
                group=sub.name,
                subscription_id=sub_id,
                node_index=i,
                url=f"{node['protocol']}://{node.get('address', '')}:{node.get('port', 0)}",
                created_at=_now(),
            )

    result = await Subscription.filter(id=sub_id).values()
    r = result[0]
    r["metadata"] = r.pop("metadata_", {})
    return r


@app.delete("/api/subscriptions/{sub_id}")
async def delete_subscription(sub_id: str) -> dict[str, str]:
    from app.xray_manager import stop_node, get_running_nodes

    sub = await Subscription.get_or_none(id=sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    running = get_running_nodes()
    for nid in list(running.keys()):
        if nid.startswith(f"{sub_id}:"):
            await stop_node(nid)
    await sub.delete()
    await Proxy.filter(subscription_id=sub_id).delete()
    return {"status": "deleted"}


@app.post("/api/subscriptions/{sub_id}/nodes/{node_index}/start")
async def start_subscription_node(sub_id: str, node_index: int) -> dict[str, Any]:
    from app.xray_manager import start_node

    sub = await Subscription.get_or_none(id=sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    nodes = sub.nodes or []
    if node_index < 0 or node_index >= len(nodes):
        raise HTTPException(404, "Node not found")
    node = nodes[node_index]
    node_id = f"{sub_id}:{node_index}"
    try:
        port = await start_node(node_id, node)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return {
        "node_id": node_id,
        "local_port": port,
        "proxy_url": f"socks5://127.0.0.1:{port}",
    }


@app.post("/api/subscriptions/{sub_id}/nodes/{node_index}/stop")
async def stop_subscription_node(sub_id: str, node_index: int) -> dict[str, str]:
    from app.xray_manager import stop_node

    node_id = f"{sub_id}:{node_index}"
    await stop_node(node_id)
    return {"status": "stopped"}


@app.get("/api/subscriptions/running")
async def list_running_nodes() -> dict[str, Any]:
    from app.xray_manager import get_running_nodes

    return get_running_nodes()


@app.post("/api/xray/stop/{node_id:path}")
async def stop_xray_node(node_id: str) -> dict[str, str]:
    from app.xray_manager import stop_node

    await stop_node(node_id)
    return {"status": "stopped"}


@app.get("/api/proxy-risk/{ip}")
async def get_proxy_risk(ip: str) -> dict[str, Any]:
    import httpx

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"https://ip.net.coffee/api/iprisk/{ip}")
        if resp.status_code != 200:
            raise HTTPException(
                resp.status_code, f"IP risk check failed: {resp.text[:300]}"
            )
        return resp.json()
