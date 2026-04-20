from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException

logger = logging.getLogger(__name__)

_app: FastAPI | None = None


async def _get_settings() -> dict[str, Any]:
    from app.db import Extension as ExtensionDB

    db_ext = await ExtensionDB.get_or_none(id="relay_codex")
    if not db_ext or not db_ext.settings:
        return {}
    return db_ext.settings


async def _relay_headers(settings: dict[str, Any]) -> dict[str, str]:
    api_key = settings.get("relay_api_key", "")
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


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


def register(app: FastAPI) -> None:
    global _app
    _app = app

    @app.post("/api/ext/relay-codex/connect/{account_id}")
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

        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(
                400,
                "Relay base URL not configured. Go to Extensions → Relay Codex Provider → Configure.",
            )

        label_prefix = settings.get("default_provider_label", "Auto")
        label = f"{label_prefix} - {acc.email}"

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=30) as client:
            create_resp = await client.post(
                f"{base_url}/providers",
                json={
                    "family": "CODEX",
                    "type": "MAIN",
                    "label": label,
                },
                headers=headers,
            )
            if create_resp.status_code not in (200, 201):
                raise HTTPException(
                    502, f"Failed to create provider on relay: {create_resp.text[:500]}"
                )

            provider_data = create_resp.json()
            provider_id = provider_data.get("data", provider_data).get("id")
            if not provider_id:
                raise HTTPException(
                    502, f"Relay returned no provider id: {create_resp.text[:500]}"
                )

            token_resp = await client.post(
                f"{base_url}/providers/{provider_id}/token",
                json={"accessToken": acc.codex_token},
                headers=headers,
            )
            if token_resp.status_code not in (200, 201):
                raise HTTPException(
                    502, f"Failed to submit token to relay: {token_resp.text[:500]}"
                )

        return {
            "status": "connected",
            "provider_id": provider_id,
            "label": label,
            "relay_base_url": base_url,
        }

    @app.post("/api/ext/relay-codex/start-auth/{account_id}")
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

        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        label_prefix = settings.get("default_provider_label", "Auto")
        label = opts.get("label") or f"{label_prefix} - {acc.email}"
        headers = await _relay_headers(settings)

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
                headers=headers,
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
                headers=headers,
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
            _wait_and_complete_auth(account_id, provider_id, base_url, headers)
        )

        return {
            "status": "workflow_created",
            "provider_id": provider_id,
            "email": acc.email,
        }

    @app.post("/api/ext/relay-codex/complete-auth/{provider_id}")
    async def complete_relay_auth(
        provider_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        callback_url = body.get("callbackUrl", "").strip()
        if not callback_url:
            raise HTTPException(400, "callbackUrl is required")

        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{base_url}/providers/{provider_id}/token",
                json={"callbackUrl": callback_url},
                headers=headers,
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(502, f"Failed to complete auth: {resp.text[:500]}")

            sync_resp = await client.post(
                f"{base_url}/providers/{provider_id}/sync-models",
                headers=headers,
            )
            sync_ok = sync_resp.status_code in (200, 201)

        return {
            "status": "authenticated",
            "provider_id": provider_id,
            "models_synced": sync_ok,
        }

    @app.get("/api/ext/relay-codex/providers/{provider_id}")
    async def get_relay_provider_detail(provider_id: str) -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/providers/{provider_id}", headers=headers
            )
            if resp.status_code != 200:
                raise HTTPException(502, f"Failed to fetch provider: {resp.text[:500]}")
            return resp.json()

    @app.post("/api/ext/relay-codex/providers/{provider_id}/sync-models")
    async def sync_relay_provider_models(provider_id: str) -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{base_url}/providers/{provider_id}/sync-models",
                headers=headers,
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(502, f"Failed to sync models: {resp.text[:500]}")
            return resp.json()

    @app.post("/api/ext/relay-codex/providers/{provider_id}/refresh-token")
    async def refresh_relay_provider_token(provider_id: str) -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{base_url}/providers/{provider_id}/refresh-token",
                headers=headers,
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(502, f"Failed to refresh token: {resp.text[:500]}")
            return resp.json()

    @app.get("/api/ext/relay-codex/providers/{provider_id}/quota")
    async def get_relay_provider_quota(provider_id: str) -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/providers/{provider_id}/quota",
                headers=headers,
            )
            if resp.status_code != 200:
                raise HTTPException(502, f"Failed to fetch quota: {resp.text[:500]}")
            return resp.json()

    @app.get("/api/ext/relay-codex/proxies")
    async def list_relay_proxies() -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{base_url}/proxies", headers=headers)
            if resp.status_code != 200:
                raise HTTPException(502, f"Failed to list proxies: {resp.text[:500]}")
            return resp.json()

    @app.get("/api/ext/relay-codex/providers")
    async def list_relay_providers() -> dict[str, Any]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{base_url}/providers", headers=headers)
            if resp.status_code != 200:
                raise HTTPException(502, f"Failed to list providers: {resp.text[:500]}")
            return resp.json()

    @app.delete("/api/ext/relay-codex/providers/{provider_id}")
    async def delete_relay_provider(provider_id: str) -> dict[str, str]:
        settings = await _get_settings()
        base_url = settings.get("relay_base_url", "").rstrip("/")
        if not base_url:
            raise HTTPException(400, "Relay base URL not configured")

        headers = await _relay_headers(settings)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.delete(
                f"{base_url}/providers/{provider_id}", headers=headers
            )
            if resp.status_code not in (200, 204):
                raise HTTPException(
                    502, f"Failed to delete provider: {resp.text[:500]}"
                )
        return {"status": "deleted"}
