import asyncio
import json
import logging
import shutil
import socket
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_xray_processes: dict[str, dict[str, Any]] = {}
_next_port = 20000


def _find_xray() -> str | None:
    local = Path(__file__).resolve().parents[1] / "bin" / "xray"
    if local.exists():
        return str(local)
    return shutil.which("xray")


def _allocate_port() -> int:
    global _next_port
    port = _next_port
    _next_port += 1
    return port


def _build_config(node: dict[str, Any], local_port: int) -> dict[str, Any]:
    protocol = node["protocol"]

    inbound = {
        "tag": "socks-in",
        "port": local_port,
        "listen": "127.0.0.1",
        "protocol": "socks",
        "settings": {"udp": True},
    }

    if protocol == "vmess":
        outbound = {
            "tag": "proxy",
            "protocol": "vmess",
            "settings": {
                "vnext": [
                    {
                        "address": node["address"],
                        "port": node["port"],
                        "users": [
                            {
                                "id": node["uuid"],
                                "alterId": node.get("alter_id", 0),
                                "security": node.get("security", "auto"),
                            }
                        ],
                    }
                ],
            },
            "streamSettings": _stream_settings(node),
        }
    elif protocol == "vless":
        user: dict[str, Any] = {
            "id": node["uuid"],
            "encryption": "none",
        }
        if node.get("flow"):
            user["flow"] = node["flow"]
        outbound = {
            "tag": "proxy",
            "protocol": "vless",
            "settings": {
                "vnext": [
                    {
                        "address": node["address"],
                        "port": node["port"],
                        "users": [user],
                    }
                ],
            },
            "streamSettings": _stream_settings(node),
        }
    elif protocol == "trojan":
        outbound = {
            "tag": "proxy",
            "protocol": "trojan",
            "settings": {
                "servers": [
                    {
                        "address": node["address"],
                        "port": node["port"],
                        "password": node["password"],
                    }
                ],
            },
            "streamSettings": _stream_settings(node),
        }
    elif protocol == "shadowsocks":
        outbound = {
            "tag": "proxy",
            "protocol": "shadowsocks",
            "settings": {
                "servers": [
                    {
                        "address": node["address"],
                        "port": node["port"],
                        "method": node["method"],
                        "password": node["password"],
                    }
                ],
            },
        }
    else:
        raise ValueError(f"Unsupported protocol: {protocol}")

    return {
        "inbounds": [inbound],
        "outbounds": [outbound],
    }


def _stream_settings(node: dict[str, Any]) -> dict[str, Any]:
    ss: dict[str, Any] = {"network": node.get("network", "tcp")}
    tls = node.get("tls", "")
    sni = node.get("sni", "") or node.get("host", "")

    if tls in ("tls", "xtls"):
        ss["security"] = "tls"
        ss["tlsSettings"] = {"serverName": sni, "allowInsecure": True}
    elif tls == "reality":
        ss["security"] = "reality"
        ss["realitySettings"] = {
            "serverName": sni,
            "fingerprint": node.get("fp", "chrome"),
            "publicKey": node.get("pbk", ""),
            "shortId": node.get("sid", ""),
        }

    network = node.get("network", "tcp")
    if network == "ws":
        ss["wsSettings"] = {
            "path": node.get("path", "/"),
            "headers": {"Host": node.get("host", "")},
        }
    elif network == "grpc":
        ss["grpcSettings"] = {"serviceName": node.get("path", "")}

    return ss


def _is_port_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


async def start_node(node_id: str, node: dict[str, Any]) -> int:
    if node_id in _xray_processes:
        entry = _xray_processes[node_id]
        proc = entry["process"]
        if proc.returncode is None and _is_port_listening(entry["port"]):
            return entry["port"]
        logger.warning(
            "xray process for %s is dead (rc=%s), restarting", node_id, proc.returncode
        )
        config_file: Path = entry["config_file"]
        config_file.unlink(missing_ok=True)
        del _xray_processes[node_id]

    xray_bin = _find_xray()
    if not xray_bin:
        raise RuntimeError("xray binary not found in PATH")

    port = _allocate_port()
    config = _build_config(node, port)

    config_file = Path(tempfile.mktemp(suffix=".json", prefix=f"xray_{node_id}_"))
    config_file.write_text(json.dumps(config))

    process = await asyncio.create_subprocess_exec(
        xray_bin,
        "run",
        "-config",
        str(config_file),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    for _ in range(20):
        await asyncio.sleep(0.5)
        if process.returncode is not None:
            stderr_data = await process.stderr.read() if process.stderr else b""
            config_file.unlink(missing_ok=True)
            raise RuntimeError(
                f"xray exited with code {process.returncode}: {stderr_data.decode(errors='replace')[:500]}"
            )
        if _is_port_listening(port):
            break
    else:
        process.kill()
        config_file.unlink(missing_ok=True)
        raise RuntimeError(f"xray failed to start listening on port {port} within 10s")

    _xray_processes[node_id] = {
        "process": process,
        "port": port,
        "config_file": config_file,
        "node": node,
    }
    logger.info("xray started for %s on port %d", node_id, port)
    return port


async def stop_node(node_id: str) -> None:
    entry = _xray_processes.pop(node_id, None)
    if not entry:
        return
    proc = entry["process"]
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
    config_file: Path = entry["config_file"]
    config_file.unlink(missing_ok=True)


def get_running_nodes() -> dict[str, dict[str, Any]]:
    return {
        nid: {"port": e["port"], "node": e["node"]}
        for nid, e in _xray_processes.items()
    }


async def stop_all() -> None:
    for nid in list(_xray_processes.keys()):
        await stop_node(nid)
