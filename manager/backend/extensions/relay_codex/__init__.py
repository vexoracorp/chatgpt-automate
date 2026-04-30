from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import HTTPException

from app.extensions import Extension

logger = logging.getLogger(__name__)


async def _wait_and_complete_auth(
    account_id: str,
    provider_id: str,
    base_url: str,
    headers: dict[str, str],
) -> None:
    from app.main import _run_log, _update_run, _finish_run, _workflow_runs

    for _ in range(600):
        await asyncio.sleep(1)
        run = _workflow_runs.get(account_id)
        if not run:
            break
        if run.get("status") == "success":
            callback_url = run.get("callback_url") or (run.get("output") or {}).get(
                "callback_url", ""
            )
            if not callback_url:
                _run_log(account_id, "Relay: OAuth succeeded but no callback_url found")
                _finish_run(
                    account_id, status="error", error="No callback URL from OAuth"
                )
                return
            try:
                _update_run(account_id, status="running")
                _run_log(
                    account_id,
                    f"Relay: Submitting callback URL to provider {provider_id}...",
                )
                async with httpx.AsyncClient(timeout=30) as client:
                    token_resp = await client.post(
                        f"{base_url}/providers/{provider_id}/token",
                        json={"callbackUrl": callback_url},
                        headers=headers,
                    )
                    if token_resp.status_code not in (200, 201):
                        _run_log(
                            account_id,
                            f"Relay: Token submission failed: {token_resp.text[:200]}",
                        )
                        _finish_run(
                            account_id,
                            status="error",
                            error="Relay token submission failed",
                        )
                        return

                    _run_log(account_id, "Relay: Token submitted. Syncing models...")
                    sync_resp = await client.post(
                        f"{base_url}/providers/{provider_id}/sync-models",
                        headers=headers,
                    )
                    if sync_resp.status_code in (200, 201):
                        _run_log(account_id, "Relay: Models synced successfully")
                    else:
                        _run_log(
                            account_id,
                            f"Relay: Model sync failed (non-critical): {sync_resp.status_code}",
                        )

                _run_log(
                    account_id, f"Relay: Provider {provider_id} connected and ready"
                )
                _finish_run(account_id, status="success")
            except Exception as exc:
                _run_log(account_id, f"Relay: Auto-complete failed: {exc}")
                _finish_run(account_id, status="error", error=str(exc))
            return
        if run.get("status") == "error":
            return

    _run_log(account_id, "Relay: Timed out waiting for OAuth workflow (10min)")
    _finish_run(account_id, status="error", error="Relay auth timed out")


class RelayCodexExtension(Extension):
    ext_id = "relay_codex"
    prefix = "/api/ext/relay-codex"

    async def headers(self, s: dict[str, Any] | None = None) -> dict[str, str]:
        if s is None:
            s = await self.settings()
        api_key = s.get("relay_api_key", "")
        hdrs: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            hdrs["Authorization"] = f"Bearer {api_key}"
        return hdrs

    async def base_url(self, s: dict[str, Any] | None = None) -> str:
        if s is None:
            s = await self.settings()
        url = s.get("relay_base_url", "").rstrip("/")
        if not url:
            raise HTTPException(400, "Relay base URL not configured")
        return url

    async def relay_request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        timeout: float = 15,
        ok_codes: tuple[int, ...] = (200,),
        error_prefix: str = "Relay request failed",
    ) -> Any:
        s = await self.settings()
        url = await self.base_url(s)
        hdrs = await self.headers(s)

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method, f"{url}{path}", json=json_body, headers=hdrs
            )
            if resp.status_code not in ok_codes:
                raise HTTPException(502, f"{error_prefix}: {resp.text[:500]}")
            if resp.status_code == 204:
                return {}
            return resp.json()

    def register_routes(self) -> None:
        router = self.router

        @router.post("/connect/{account_id}")
        async def connect_account_to_relay(
            account_id: str, body: dict[str, Any] | None = None
        ) -> dict[str, Any]:
            from app.db import Account

            acc = await Account.get_or_none(id=account_id)
            if not acc:
                raise HTTPException(404, "Account not found")
            if not acc.codex_token:
                raise HTTPException(
                    400, "Account has no codex_token. Run Codex login first."
                )

            s = await self.settings()
            base_url = await self.base_url(s)
            hdrs = await self.headers(s)

            label_prefix = s.get("default_provider_label", "Auto")
            label = f"{label_prefix} - {acc.email}"

            async with httpx.AsyncClient(timeout=30) as client:
                create_resp = await client.post(
                    f"{base_url}/providers",
                    json={"family": "CODEX", "type": "MAIN", "label": label},
                    headers=hdrs,
                )
                if create_resp.status_code not in (200, 201):
                    raise HTTPException(
                        502,
                        f"Failed to create provider on relay: {create_resp.text[:500]}",
                    )

                provider_data = create_resp.json()
                provider_id = provider_data.get("data", provider_data).get("id")
                if not provider_id:
                    raise HTTPException(
                        502,
                        f"Relay returned no provider id: {create_resp.text[:500]}",
                    )

                token_resp = await client.post(
                    f"{base_url}/providers/{provider_id}/token",
                    json={"accessToken": acc.codex_token},
                    headers=hdrs,
                )
                if token_resp.status_code not in (200, 201):
                    raise HTTPException(
                        502,
                        f"Failed to submit token to relay: {token_resp.text[:500]}",
                    )

            return {
                "status": "connected",
                "provider_id": provider_id,
                "label": label,
                "relay_base_url": base_url,
            }

        @router.post("/start-auth/{account_id}")
        async def start_relay_auth(
            account_id: str, body: dict[str, Any] | None = None
        ) -> dict[str, Any]:
            from app.db import Account
            from app.main import (
                _pending_otps,
                _register_run,
                _run_codex,
                _update_run,
                _run_log,
                get_workspace_id,
            )
            from app.models import CodexOAuthRequest

            opts = body or {}
            acc = await Account.get_or_none(id=account_id)
            if not acc:
                raise HTTPException(404, "Account not found")

            s = await self.settings()
            base_url = await self.base_url(s)
            hdrs = await self.headers(s)

            label_prefix = s.get("default_provider_label", "Auto")
            label = opts.get("label") or f"{label_prefix} - {acc.email}"

            provider_body: dict[str, Any] = {
                "family": opts.get("family", "CODEX"),
                "type": opts.get("type", "MAIN"),
                "label": label,
            }
            if opts.get("priority"):
                provider_body["priority"] = int(opts["priority"])
            if opts.get("proxyId"):
                provider_body["proxyId"] = opts["proxyId"]
            if "supportsVision" in opts:
                provider_body["supportsVision"] = bool(opts["supportsVision"])
            if opts.get("validFrom"):
                provider_body["validFrom"] = opts["validFrom"]
            if opts.get("validUntil"):
                provider_body["validUntil"] = opts["validUntil"]

            async with httpx.AsyncClient(timeout=30) as client:
                create_resp = await client.post(
                    f"{base_url}/providers",
                    json=provider_body,
                    headers=hdrs,
                )
                if create_resp.status_code not in (200, 201):
                    raise HTTPException(
                        502, f"Failed to create provider: {create_resp.text[:500]}"
                    )

                provider_data = create_resp.json()
                provider_id = provider_data.get("data", provider_data).get("id")
                if not provider_id:
                    raise HTTPException(502, "Relay returned no provider id")

                auth_resp = await client.post(
                    f"{base_url}/providers/{provider_id}/start-auth",
                    json={"authMethod": "oauth_url"},
                    headers=hdrs,
                )
                if auth_resp.status_code not in (200, 201):
                    raise HTTPException(
                        502, f"Failed to start auth: {auth_resp.text[:500]}"
                    )

                auth_data = auth_resp.json().get("data", {})
                auth_url = auth_data.get("authUrl", "")

            workspace_id = ""
            try:
                ws_data = await get_workspace_id(account_id)
                workspace_id = ws_data.get("workspace_id", "")
            except Exception:
                pass

            req = CodexOAuthRequest(
                account_id=account_id,
                authorize_url=auth_url,
                workspace_id=workspace_id,
                proxy_url=acc.proxy_url,
                run_name=f"relay-codex-{acc.email}",
                auto_start=True,
            )

            await _register_run(
                account_id,
                workflow_type="codex_oauth_relay",
                email=acc.email,
                proxy_url=acc.proxy_url,
                run_name=req.run_name,
                params={**req.model_dump(), "relay_provider_id": provider_id},
            )

            _run_log(account_id, f"Relay: Created provider {provider_id} ({label})")
            _run_log(account_id, "Relay: Starting Codex OAuth flow...")

            future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
            _pending_otps[account_id] = future
            _update_run(account_id, status="starting")
            asyncio.create_task(_run_codex(req, future))

            asyncio.create_task(
                _wait_and_complete_auth(account_id, provider_id, base_url, hdrs)
            )

            return {
                "status": "workflow_created",
                "provider_id": provider_id,
                "email": acc.email,
            }

        @router.post("/complete-auth/{provider_id}")
        async def complete_relay_auth(
            provider_id: str, body: dict[str, Any]
        ) -> dict[str, Any]:
            callback_url = body.get("callbackUrl", "").strip()
            if not callback_url:
                raise HTTPException(400, "callbackUrl is required")

            s = await self.settings()
            base_url = await self.base_url(s)
            hdrs = await self.headers(s)

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{base_url}/providers/{provider_id}/token",
                    json={"callbackUrl": callback_url},
                    headers=hdrs,
                )
                if resp.status_code not in (200, 201):
                    raise HTTPException(
                        502, f"Failed to complete auth: {resp.text[:500]}"
                    )

                sync_resp = await client.post(
                    f"{base_url}/providers/{provider_id}/sync-models",
                    headers=hdrs,
                )
                sync_ok = sync_resp.status_code in (200, 201)

            return {
                "status": "authenticated",
                "provider_id": provider_id,
                "models_synced": sync_ok,
            }

        @router.get("/providers/{provider_id}")
        async def get_relay_provider_detail(provider_id: str) -> dict[str, Any]:
            return await self.relay_request(
                "GET",
                f"/providers/{provider_id}",
                error_prefix="Failed to fetch provider",
            )

        @router.post("/providers/{provider_id}/sync-models")
        async def sync_relay_provider_models(provider_id: str) -> dict[str, Any]:
            return await self.relay_request(
                "POST",
                f"/providers/{provider_id}/sync-models",
                timeout=30,
                ok_codes=(200, 201),
                error_prefix="Failed to sync models",
            )

        @router.post("/providers/{provider_id}/refresh-token")
        async def refresh_relay_provider_token(provider_id: str) -> dict[str, Any]:
            return await self.relay_request(
                "POST",
                f"/providers/{provider_id}/refresh-token",
                timeout=30,
                ok_codes=(200, 201),
                error_prefix="Failed to refresh token",
            )

        @router.get("/providers/{provider_id}/quota")
        async def get_relay_provider_quota(provider_id: str) -> dict[str, Any]:
            return await self.relay_request(
                "GET",
                f"/providers/{provider_id}/quota",
                error_prefix="Failed to fetch quota",
            )

        @router.get("/proxies")
        async def list_relay_proxies() -> dict[str, Any]:
            return await self.relay_request(
                "GET",
                "/admin/proxies?isActive=true&limit=20",
                error_prefix="Failed to list proxies",
            )

        @router.get("/providers")
        async def list_relay_providers() -> dict[str, Any]:
            return await self.relay_request(
                "GET",
                "/providers",
                error_prefix="Failed to list providers",
            )

        @router.delete("/providers/{provider_id}")
        async def delete_relay_provider(provider_id: str) -> dict[str, str]:
            await self.relay_request(
                "DELETE",
                f"/providers/{provider_id}",
                ok_codes=(200, 204),
                error_prefix="Failed to delete provider",
            )
            return {"status": "deleted"}
