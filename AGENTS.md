# AGENTS.md — chatgpt-automate

## Project Overview

Python 3.14+ project using `uv` as the package manager. Primary dependency: `curl-cffi` (HTTP client with browser impersonation). Greenfield — no established source code yet.

---

## Build & Run Commands

```bash
# Install dependencies
uv sync

# Run the project (once a main module exists)
uv run python -m chatgpt_automate

# Run a single Python file
uv run python path/to/file.py
```

## Testing

```bash
# Run all tests
uv run pytest

# Run a single test file
uv run pytest tests/test_example.py

# Run a single test function
uv run pytest tests/test_example.py::test_function_name

# Run with verbose output
uv run pytest -v

# Run tests matching a keyword
uv run pytest -k "keyword"
```

When adding tests, place them in `tests/` with filenames prefixed `test_`. Use `pytest` — do not use `unittest` unless there's a specific reason.

## Linting & Formatting

```bash
# Format code
uv run ruff format .

# Lint code
uv run ruff check .

# Lint and auto-fix
uv run ruff check --fix .

# Type checking
uv run pyright
```

Add `ruff` and `pyright` as dev dependencies when setting up:
```bash
uv add --dev ruff pyright pytest
```

---

## Code Style Guidelines

### Python Version

- Target Python 3.14+. Use modern syntax freely: `match` statements, `type` aliases, generic syntax (`def foo[T](x: T) -> T`), etc.

### Imports

- Standard library first, blank line, third-party, blank line, local imports.
- Use absolute imports. No relative imports unless within a package's internal modules.
- One import per line for `from` imports when there are 3+ names.

```python
import asyncio
import json
from pathlib import Path

from curl_cffi.requests import AsyncSession

from chatgpt_automate.client import ChatGPTClient
```

### Naming Conventions

- `snake_case` for functions, variables, modules, and file names.
- `PascalCase` for classes.
- `UPPER_SNAKE_CASE` for constants.
- Private members prefixed with `_`. No double underscores unless implementing dunder methods.
- Descriptive names. No single-letter variables except in comprehensions and lambdas.

### Type Annotations

- All public functions and methods must have type annotations (params + return).
- Use built-in generics: `list[str]`, `dict[str, int]`, `tuple[int, ...]`.
- Use `X | None` instead of `Optional[X]`.
- Use `type` statement for complex type aliases: `type Headers = dict[str, str]`.

### Error Handling

- Never use bare `except:` or `except Exception:` without re-raising or logging.
- Define custom exceptions inheriting from a project base exception when appropriate.
- Use specific exception types. Catch the narrowest exception possible.
- Always include context in error messages.

```python
# Good
except httpx.TimeoutException as e:
    raise ChatGPTTimeoutError(f"Request timed out after {timeout}s") from e

# Bad
except Exception:
    pass
```

### Async Patterns

- This project uses `curl_cffi` with async support. Prefer `async/await` for I/O operations.
- Use `asyncio.TaskGroup` for concurrent operations (Python 3.11+).
- Never use `asyncio.gather` with `return_exceptions=True` as a substitute for proper error handling.

### String Formatting

- Use f-strings for interpolation.
- Use triple-quoted strings for multi-line.
- No `%` formatting or `.format()` unless required by a library.

### Documentation

- Docstrings on all public classes and functions. Use Google-style docstrings.
- Keep docstrings concise — describe what, not how.

```python
def send_message(self, content: str, conversation_id: str | None = None) -> Message:
    """Send a message to ChatGPT and return the response.

    Args:
        content: The message text to send.
        conversation_id: Existing conversation to continue. Starts new if None.

    Returns:
        The assistant's response message.

    Raises:
        AuthenticationError: If the session token is invalid or expired.
    """
```

### Project Structure (Recommended)

```
chatgpt-automate/
├── AGENTS.md
├── pyproject.toml
├── uv.lock
├── src/
│   └── chatgpt_automate/
│       ├── __init__.py
│       ├── client.py
│       ├── models.py
│       └── exceptions.py
└── tests/
    ├── conftest.py
    └── test_client.py
```

Use `src/` layout to avoid import ambiguity.

### General Principles

- Keep functions short and focused. If a function exceeds ~30 lines, consider splitting.
- No `# type: ignore` or `# noqa` without an inline comment explaining why.
- No `Any` types unless interfacing with untyped third-party code, and even then, narrow as soon as possible.
- Prefer `dataclass` or `NamedTuple` over plain dicts for structured data.
- Prefer `pathlib.Path` over `os.path`.
- No mutable default arguments.
- Use `logging` module, not `print()`, for operational output.
