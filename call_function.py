import asyncio
import json
import logging
import sys
from pathlib import Path

from curl_cffi.requests import AsyncSession

from models import ProxyConfig
import register

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"

LEVEL_STYLES = {
    "DEBUG": DIM,
    "INFO": CYAN,
    "WARNING": YELLOW,
    "ERROR": RED,
    "CRITICAL": f"{BOLD}{RED}",
}

FUNCTIONS = {
    "me": register.get_me,
    "account": register.get_account_info,
    "consent": register.get_granular_consent,
    "notifications": register.get_notification_settings,
    "age": register.get_age_settings,
    "codex": register.get_codex_quota,
    "settings": register.get_user_settings,
    "segments": register.get_user_segments,
    "set_consent": register.set_granular_consent,
    "announcement": register.mark_announcement_viewed,
    "onboarding": register.set_onboarding_interests,
    "conv_init": register.init_conversation,
    "connectors": register.list_connectors,
    "register_flow": register.register_flow,
    "codex_oauth": register.codex_oauth,
}

FUNCTIONS_WITH_ARGS = {
    "announcement": lambda: _prompt("Announcement ID"),
}


class ColorFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = self.formatTime(record, "%H:%M:%S")
        ms = f"{record.msecs:03.0f}"
        level = record.levelname
        style = LEVEL_STYLES.get(level, "")
        level_tag = f"{style}{level:<8}{RESET}"
        name = f"{DIM}{record.name}{RESET}"
        msg = record.getMessage()
        line = f"{DIM}{ts}.{ms}{RESET} {level_tag} {name} {BOLD}│{RESET} {msg}"
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            line += f"\n{RED}{record.exc_text}{RESET}"
        return line


def _setup_logging() -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(ColorFormatter())
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)
    logging.getLogger("curl_cffi").setLevel(logging.WARNING)


def _prompt(label: str, *, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"  {label}{suffix}: ").strip()
    return value or default


def _load_session(path: str) -> dict[str, object]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Invalid session file: {path}")
    return data


def _list_session_files() -> list[str]:
    return sorted(str(p) for p in Path(".").glob("account_*.json"))


async def _run(session_path: str, proxy_url: str | None) -> None:
    session_data = _load_session(session_path)

    session_info = session_data.get("session")
    if not isinstance(session_info, dict):
        print(f"  {RED}No session info found in file{RESET}")
        return

    access_token = str(session_info.get("accessToken") or "").strip()
    if not access_token:
        print(f"  {RED}No accessToken found in session file{RESET}")
        return

    browser_profile = str(session_data.get("browser_profile") or "")
    if not browser_profile:
        from register import _pick_browser

        browser_profile = _pick_browser()

    proxies = ProxyConfig(url=proxy_url).as_proxy_spec()

    async with AsyncSession(proxies=proxies, impersonate=browser_profile) as session:
        session.headers.update(
            {
                "Authorization": f"Bearer {access_token}",
            }
        )

        cookies = session_data.get("cookies")
        if isinstance(cookies, dict):
            for key, value in cookies.items():
                if "@" in str(key):
                    name, domain = str(key).rsplit("@", 1)
                    session.cookies.set(name, str(value), domain=domain)
                else:
                    session.cookies.set(str(key), str(value))

        func_names = list(FUNCTIONS.keys())
        while True:
            print(f"\n  {DIM}Available functions:{RESET}")
            for i, name in enumerate(func_names, 1):
                print(f"    {i}. {name}")
            print(f"    q. quit")
            print()

            func_choice = _prompt("Function name or number", default="me")
            if func_choice.lower() in ("q", "quit", "exit"):
                break

            if func_choice.isdigit():
                try:
                    func_name = func_names[int(func_choice) - 1]
                except IndexError:
                    print(f"  {RED}Invalid choice{RESET}")
                    continue
            elif func_choice in FUNCTIONS:
                func_name = func_choice
            else:
                print(f"  {RED}Unknown function: {func_choice}{RESET}")
                continue

            print()
            fn = FUNCTIONS[func_name]
            if func_name in FUNCTIONS_WITH_ARGS:
                arg = FUNCTIONS_WITH_ARGS[func_name]()
                if not arg:
                    print(f"  {RED}Argument required{RESET}")
                    continue
                result = await fn(session, arg)
            else:
                result = await fn(session)
            print(json.dumps(result, indent=2, ensure_ascii=False))


async def _main() -> None:
    print(f"\n  {BOLD}ChatGPT Session Tool{RESET}\n")

    files = _list_session_files()
    if not files:
        print(f"  {RED}No session files found (account_*.json){RESET}")
        return

    print(f"  {DIM}Available sessions:{RESET}")
    for i, f in enumerate(files, 1):
        print(f"    {i}. {f}")
    print()

    choice = _prompt("Session number", default="1")
    try:
        idx = int(choice) - 1
        session_path = files[idx]
    except (ValueError, IndexError):
        print(f"  {RED}Invalid choice{RESET}")
        return

    proxy_url = _prompt("Proxy URL (enter to skip)", default="") or None

    await _run(session_path, proxy_url)


def main() -> None:
    _setup_logging()
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print(f"\n  {YELLOW}Interrupted{RESET}")


if __name__ == "__main__":
    main()
