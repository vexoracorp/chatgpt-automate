import base64
import json
import urllib.parse
from typing import Any


def extract_url(raw_url: str) -> str:
    raw_url = raw_url.strip()
    if raw_url.startswith("surge:///install-config?"):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(raw_url).query))
        return params.get("url", raw_url)
    if raw_url.startswith("shadowrocket://add/sub://"):
        rest = raw_url[len("shadowrocket://add/sub://") :]
        if "?" in rest:
            rest = rest.split("?")[0]
        rest = rest.rstrip("=")
        padding = 4 - len(rest) % 4
        if padding != 4:
            rest += "=" * padding
        try:
            return base64.b64decode(rest).decode()
        except Exception:
            pass
    if raw_url.startswith("clash://install-config?"):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(raw_url).query))
        return params.get("url", raw_url)
    return raw_url


import re as _re


_INFO_PATTERNS = [
    _re.compile(r"剩余流量[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"剩余[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"到期[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"套餐到期[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"过期[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"距离.*重置.*[：:]\s*(.+)", _re.IGNORECASE),
    _re.compile(r"网址导航", _re.IGNORECASE),
    _re.compile(r"官网", _re.IGNORECASE),
    _re.compile(r"telegram", _re.IGNORECASE),
    _re.compile(r"公告", _re.IGNORECASE),
    _re.compile(r"订阅", _re.IGNORECASE),
]


def _is_info_node(name: str) -> bool:
    for pat in _INFO_PATTERNS:
        if pat.search(name):
            return True
    return False


def _extract_metadata(nodes: list[dict[str, Any]]) -> dict[str, str]:
    meta: dict[str, str] = {}
    for node in nodes:
        name = node.get("name", "")
        m = _re.search(r"剩余流量[：:]\s*(.+)", name)
        if m:
            meta["remaining_traffic"] = m.group(1).strip()
            continue
        m = _re.search(r"套餐到期[：:]\s*(.+)", name)
        if not m:
            m = _re.search(r"到期[：:]\s*(.+)", name)
        if m:
            meta["expire_date"] = m.group(1).strip()
            continue
        m = _re.search(r"距离.*重置.*[：:]\s*(.+)", name)
        if m:
            meta["reset_in"] = m.group(1).strip()
    return meta


def parse_subscription(raw: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    try:
        decoded = base64.b64decode(raw.strip()).decode("utf-8", errors="ignore")
    except Exception:
        decoded = raw

    all_nodes: list[dict[str, Any]] = []
    for line in decoded.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        node = _parse_node(line)
        if node:
            all_nodes.append(node)

    metadata = _extract_metadata(all_nodes)
    proxy_nodes = [n for n in all_nodes if not _is_info_node(n.get("name", ""))]
    return proxy_nodes, metadata


def _parse_node(uri: str) -> dict[str, Any] | None:
    if uri.startswith("vmess://"):
        return _parse_vmess(uri)
    if uri.startswith("vless://"):
        return _parse_vless(uri)
    if uri.startswith("trojan://"):
        return _parse_trojan(uri)
    if uri.startswith("ss://"):
        return _parse_shadowsocks(uri)
    return None


def _parse_vmess(uri: str) -> dict[str, Any] | None:
    try:
        payload = uri[8:]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        data = json.loads(base64.b64decode(payload).decode())
        return {
            "protocol": "vmess",
            "name": data.get("ps", ""),
            "address": data.get("add", ""),
            "port": int(data.get("port", 0)),
            "uuid": data.get("id", ""),
            "alter_id": int(data.get("aid", 0)),
            "security": data.get("scy", "auto"),
            "network": data.get("net", "tcp"),
            "tls": data.get("tls", ""),
            "host": data.get("host", ""),
            "path": data.get("path", ""),
        }
    except Exception:
        return None


def _parse_vless(uri: str) -> dict[str, Any] | None:
    try:
        parsed = urllib.parse.urlparse(uri)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        name = urllib.parse.unquote(parsed.fragment) if parsed.fragment else ""
        return {
            "protocol": "vless",
            "name": name,
            "address": parsed.hostname or "",
            "port": parsed.port or 0,
            "uuid": parsed.username or "",
            "security": params.get("security", "none"),
            "network": params.get("type", "tcp"),
            "tls": params.get("security", ""),
            "sni": params.get("sni", ""),
            "flow": params.get("flow", ""),
            "path": params.get("path", ""),
            "host": params.get("host", ""),
        }
    except Exception:
        return None


def _parse_trojan(uri: str) -> dict[str, Any] | None:
    try:
        parsed = urllib.parse.urlparse(uri)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        name = urllib.parse.unquote(parsed.fragment) if parsed.fragment else ""
        return {
            "protocol": "trojan",
            "name": name,
            "address": parsed.hostname or "",
            "port": parsed.port or 0,
            "password": parsed.username or "",
            "sni": params.get("sni", parsed.hostname or ""),
            "network": params.get("type", "tcp"),
            "path": params.get("path", ""),
            "host": params.get("host", ""),
        }
    except Exception:
        return None


def _parse_shadowsocks(uri: str) -> dict[str, Any] | None:
    try:
        rest = uri[5:]
        if "#" in rest:
            rest, fragment = rest.rsplit("#", 1)
            name = urllib.parse.unquote(fragment)
        else:
            name = ""

        if "@" in rest:
            userinfo, hostport = rest.rsplit("@", 1)
            try:
                padding = 4 - len(userinfo) % 4
                if padding != 4:
                    userinfo += "=" * padding
                decoded = base64.b64decode(userinfo).decode()
                method, password = decoded.split(":", 1)
            except Exception:
                method, password = userinfo.split(":", 1)
        else:
            try:
                padding = 4 - len(rest) % 4
                if padding != 4:
                    rest += "=" * padding
                decoded = base64.b64decode(rest).decode()
                userinfo, hostport = decoded.rsplit("@", 1)
                method, password = userinfo.split(":", 1)
            except Exception:
                return None

        host, port_str = hostport.rsplit(":", 1)
        return {
            "protocol": "shadowsocks",
            "name": name,
            "address": host,
            "port": int(port_str),
            "method": method,
            "password": password,
        }
    except Exception:
        return None
