from typing import Literal

from pydantic import BaseModel


class AccountBase(BaseModel):
    email: str
    proxy_url: str | None = None


class AccountCreate(AccountBase):
    password: str | None = None
    name: str = "Neo"
    birthdate: str = "2000-02-20"
    run_name: str = ""
    auto_start: bool = True
    verbose: bool = False


class AccountOut(BaseModel):
    id: str
    email: str
    status: str
    name: str = ""
    plan: str = ""
    plan_expiry: str = ""
    codex_weekly_used: float = 0
    codex_weekly_reset_hours: int = 0
    codex_5h_used: float = 0
    codex_5h_reset_min: int = 0
    proxy_url: str | None = None
    proxy_label: str = ""
    proxy_test: dict | None = None
    session_token: str | None = None
    access_token: str | None = None
    codex_token: str | None = None
    password: str = ""
    created_at: str
    last_login: str | None = None


class LoginRequest(BaseModel):
    email: str
    proxy_url: str | None = None
    run_name: str = ""
    auto_start: bool = True
    verbose: bool = False


class OTPSubmit(BaseModel):
    account_id: str
    otp: str


class CodexOAuthRequest(BaseModel):
    account_id: str
    authorize_url: str
    workspace_id: str
    proxy_url: str | None = None
    run_name: str = ""
    auto_start: bool = True
    verbose: bool = False


class CodexDeviceRequest(BaseModel):
    account_id: str
    user_code: str
    device_code: str
    workspace_id: str
    proxy_url: str | None = None
    run_name: str = ""
    auto_start: bool = True
    verbose: bool = False


class TaskOut(BaseModel):
    task_id: str
    account_id: str
    type: str
    status: str


class UserCreate(BaseModel):
    email: str
    password: str
    name: str = ""
    role: str = "user"


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str = "user"
    created_at: str
    last_login: str = ""


class UserLogin(BaseModel):
    email: str
    password: str


class PasswordReset(BaseModel):
    new_password: str


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: str | None = None


class UserProfileUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    new_password: str | None = None


class ChangePassword(BaseModel):
    current_password: str
    new_password: str
    totp_code: str | None = None


class TOTPSetupOut(BaseModel):
    secret: str
    qr_uri: str
    qr_base64: str


class TOTPVerify(BaseModel):
    code: str


class OrgSettings(BaseModel):
    org_name: str = "ChatGPT Account Manager"
    allowed_ips: list[str] = []
    require_2fa: bool = False
    allow_email_change: bool = False
    allow_password_change: bool = True
    password_expiry_days: int = 0
    session_timeout_min: int = 0


class ProxyCreate(BaseModel):
    protocol: Literal["http", "https", "socks5"]
    host: str
    port: int
    username: str = ""
    password: str = ""
    label: str = ""


class ProxyOut(BaseModel):
    id: str
    protocol: str
    host: str
    port: int
    username: str
    password: str
    label: str
    group: str = ""
    subscription_id: str | None = ""
    url: str
    created_at: str
    last_test: dict | None = None


class ProxyTestResult(BaseModel):
    ip: str
    country: str
    country_code: str
    region: str
    city: str
    asn: str
    org: str
    timezone: str
    latency_ms: int


class OutlookConfig(BaseModel):
    tenant_id: str
    client_id: str
    client_secret: str


class OutlookConfigOut(BaseModel):
    configured: bool
    tenant_id: str = ""
    client_id: str = ""


class MailboxCreate(BaseModel):
    email: str
    password: str = ""
    refresh_token: str = ""
    client_id: str = ""


class MailboxOut(BaseModel):
    id: str
    email: str
    password: str
    refresh_token: str
    client_id: str
    status: str
    assigned_account_id: str | None = None
    created_at: str


class MailboxMailSummary(BaseModel):
    id: str
    from_addr: str
    subject: str
    received_at: str
    is_otp: bool
    otp_code: str | None = None


class MailboxMailDetail(BaseModel):
    id: str
    from_addr: str
    subject: str
    body: str
    received_at: str
    is_otp: bool
    otp_code: str | None = None


class SubscriptionCreate(BaseModel):
    name: str
    url: str
