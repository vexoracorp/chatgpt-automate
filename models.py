import json
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from curl_cffi.requests import ProxySpec


@dataclass(frozen=True)
class OAuthStart:
    auth_url: str
    state: str
    code_verifier: str
    redirect_uri: str


@dataclass
class TokenConfig:
    id_token: str = ""
    access_token: str = ""
    refresh_token: str = ""
    account_id: str = ""
    email: str = ""
    expires_in: int = 0

    def to_json(self) -> str:
        """Serialize to the compact JSON format consumed by codex CLI tools."""
        now = int(time.time())
        return json.dumps(
            {
                "id_token": self.id_token,
                "access_token": self.access_token,
                "refresh_token": self.refresh_token,
                "account_id": self.account_id,
                "last_refresh": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                "email": self.email,
                "type": "codex",
                "expired": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(now + max(self.expires_in, 0)),
                ),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )


@dataclass
class ProxyConfig:
    url: str | None = None

    def as_proxy_spec(self) -> "ProxySpec | None":
        if not self.url:
            return None
        return {"http": self.url, "https": self.url}
