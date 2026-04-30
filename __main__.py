import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

from exceptions import AutomateError
from models import ProxyConfig
from register import RegistrationSession, register_flow

log = logging.getLogger("automate")

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"

LEVEL_STYLES = {
    "DEBUG": DIM,
    "INFO": CYAN,
    "WARNING": YELLOW,
    "ERROR": RED,
    "CRITICAL": f"{BOLD}{RED}",
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


def _setup_logging(*, verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(ColorFormatter())
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    logging.getLogger("curl_cffi").setLevel(logging.WARNING)


def _prompt(label: str, *, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"  {label}{suffix}: ").strip()
    return value or default


async def console_otp_provider(email: str) -> str:
    return await asyncio.to_thread(input, f"\n  Enter OTP code for {email}: ")


async def console_password_provider() -> str:
    return await asyncio.to_thread(input, "\n  Enter password: ")


async def _run_once(proxy: ProxyConfig, email: str) -> bool:
    log.info(f"{BOLD}{MAGENTA}{'═' * 50}{RESET}")
    log.info(f"{BOLD}{MAGENTA}  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    log.info(f"{BOLD}{MAGENTA}{'═' * 50}{RESET}")

    start = time.monotonic()
    try:
        async with await RegistrationSession.create(proxy=proxy) as reg:
            await reg.check_region()
            await asyncio.sleep(0.5)
            await reg.get_csrf()
            await asyncio.sleep(0.5)
            await reg.signin(email)
            await asyncio.sleep(0.5)
            await reg.submit_email()
            await asyncio.sleep(0.5)
            await reg.set_password(console_password_provider)
            await asyncio.sleep(0.5)
            await reg.verify_otp(console_otp_provider)
            await asyncio.sleep(0.5)

            name = await asyncio.to_thread(input, "\n  Enter name (default: Neo): ")
            name = name.strip() or "Neo"
            birthdate = await asyncio.to_thread(
                input, "  Enter birthdate YYYY-MM-DD (default: 2000-02-20): "
            )
            birthdate = birthdate.strip() or "2000-02-20"

            await reg.create_account(name, birthdate)
            await asyncio.sleep(0.5)
            session_data = await reg.establish_session()

            result: dict[str, object] = {}
            if session_data:
                result["session"] = session_data
            result["cookies"] = reg.cookies()

            run_flow = await asyncio.to_thread(
                input, "\n  Run post-registration setup flow? (Y/n): "
            )
            if run_flow.strip().lower() not in ("n", "no"):
                result["register_flow"] = await register_flow(reg.inner_session)

        session_info = result.get("session") if isinstance(result, dict) else {}
        user_email = (
            str((session_info or {}).get("user", {}).get("email") or email)
            if isinstance(session_info, dict)
            else email
        )
        email_slug = user_email.replace("@", "_")
        filename = f"account_{email_slug}_{int(time.time())}.json"
        Path(filename).write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        elapsed = time.monotonic() - start
        log.info(
            f"{GREEN}{BOLD}✓ Registration complete{RESET}  {DIM}({elapsed:.1f}s){RESET}"
        )
        log.info(f"  {DIM}Email:{RESET}  {user_email}")
        log.info(f"  {DIM}Saved:{RESET}  {filename}")
        return True

    except AutomateError as exc:
        elapsed = time.monotonic() - start
        log.error(
            f"{RED}{BOLD}✗ Registration failed{RESET}  {DIM}({elapsed:.1f}s){RESET}"
        )
        log.error(f"  {RED}{type(exc).__name__}: {exc}{RESET}")
        return False
    except Exception:
        elapsed = time.monotonic() - start
        log.error(
            f"{RED}{BOLD}✗ Unexpected error{RESET}  {DIM}({elapsed:.1f}s){RESET}",
            exc_info=True,
        )
        return False


async def _main() -> None:
    print(f"\n  {BOLD}OpenAI Auto-Registrar{RESET}\n")

    proxy_url = _prompt("Proxy URL (enter to skip)", default="") or None
    email = _prompt("Email")
    if not email:
        print(f"  {RED}Email is required.{RESET}")
        return

    verbose_input = _prompt("Verbose logging? (y/N)", default="N")
    verbose = verbose_input.lower() in ("y", "yes")

    _setup_logging(verbose=verbose)

    proxy = ProxyConfig(url=proxy_url)

    log.info("")
    log.info(f"  {DIM}Proxy:{RESET}    {proxy.url or 'direct (no proxy)'}")
    log.info(f"  {DIM}Email:{RESET}    {email}")
    log.info("")

    await _run_once(proxy, email)


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print(f"\n  {YELLOW}Interrupted by user{RESET}")


if __name__ == "__main__":
    main()
