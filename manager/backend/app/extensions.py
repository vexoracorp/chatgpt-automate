from __future__ import annotations

import importlib
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI

logger = logging.getLogger(__name__)

EXTENSIONS_DIR = Path(__file__).resolve().parent.parent / "extensions"


@dataclass
class ExtensionManifest:
    id: str
    name: str
    description: str = ""
    version: str = "0.0.1"
    author: str = ""
    settings_schema: dict[str, Any] = field(default_factory=dict)


class Extension(ABC):
    ext_id: str
    prefix: str

    def __init__(self) -> None:
        self.router = APIRouter(prefix=self.prefix)
        self.register_routes()

    async def settings(self) -> dict[str, Any]:
        from app.db import Extension as ExtensionDB

        db_ext = await ExtensionDB.get_or_none(id=self.ext_id)
        if not db_ext or not db_ext.settings:
            return {}
        return db_ext.settings

    @abstractmethod
    def register_routes(self) -> None: ...

    def mount(self, app: FastAPI) -> None:
        app.include_router(self.router)


_loaded: dict[str, ExtensionManifest] = {}


def discover_extensions() -> list[ExtensionManifest]:
    results: list[ExtensionManifest] = []
    if not EXTENSIONS_DIR.is_dir():
        return results

    for child in sorted(EXTENSIONS_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith(("_", ".")):
            continue
        manifest_path = child / "manifest.json"
        if not manifest_path.exists():
            logger.warning("Extension %s missing manifest.json, skipping", child.name)
            continue
        try:
            raw = json.loads(manifest_path.read_text())
            manifest = ExtensionManifest(
                id=raw.get("id", child.name),
                name=raw.get("name", child.name),
                description=raw.get("description", ""),
                version=raw.get("version", "0.0.1"),
                author=raw.get("author", ""),
                settings_schema=raw.get("settings_schema", {}),
            )
            results.append(manifest)
        except Exception:
            logger.exception("Failed to parse manifest for %s", child.name)
    return results


def load_extension(app: FastAPI, ext_id: str) -> bool:
    ext_dir = EXTENSIONS_DIR / ext_id
    init_file = ext_dir / "__init__.py"
    if not init_file.exists():
        logger.error("Extension %s has no __init__.py", ext_id)
        return False
    try:
        module = importlib.import_module(f"extensions.{ext_id}")

        ext_cls = None
        for attr in vars(module).values():
            if (
                isinstance(attr, type)
                and issubclass(attr, Extension)
                and attr is not Extension
            ):
                ext_cls = attr
                break

        if ext_cls is not None:
            instance = ext_cls()
            instance.mount(app)
        elif hasattr(module, "register"):
            module.register(app)
        else:
            logger.error("Extension %s has no Extension subclass or register()", ext_id)
            return False

        _loaded[ext_id] = next(
            (m for m in discover_extensions() if m.id == ext_id),
            ExtensionManifest(id=ext_id, name=ext_id),
        )
        logger.info("Loaded extension: %s", ext_id)
        return True
    except Exception:
        logger.exception("Failed to load extension %s", ext_id)
        return False


async def load_enabled_extensions(app: FastAPI) -> None:
    from app.db import Extension as ExtensionDB

    manifests = discover_extensions()
    for manifest in manifests:
        db_ext = await ExtensionDB.get_or_none(id=manifest.id)
        if db_ext and db_ext.enabled:
            load_extension(app, manifest.id)


def get_loaded() -> dict[str, ExtensionManifest]:
    return _loaded


def get_extension_ui(ext_id: str) -> dict[str, Any] | None:
    ui_path = EXTENSIONS_DIR / ext_id / "ui.json"
    if not ui_path.exists():
        return None
    try:
        return json.loads(ui_path.read_text())
    except Exception:
        logger.exception("Failed to parse ui.json for %s", ext_id)
        return None
