import os
from pathlib import Path


def load_backend_environment(paths: list[Path] | None = None) -> None:
    for env_path in paths or default_env_paths():
        if not env_path.exists():
            continue
        if _load_with_dotenv(env_path):
            continue
        _load_simple_env(env_path)


def default_env_paths() -> list[Path]:
    backend_dir = Path(__file__).resolve().parents[2]
    root_dir = backend_dir.parent
    return [root_dir / ".env", backend_dir / ".env"]


def _load_with_dotenv(env_path: Path) -> bool:
    try:
        from dotenv import load_dotenv
    except Exception:
        return False
    load_dotenv(dotenv_path=env_path, override=False)
    return True


def _load_simple_env(env_path: Path) -> None:
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = _strip_quotes(value.strip())


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value
