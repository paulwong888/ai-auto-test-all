from pathlib import Path

TRACE_DIR = Path(__file__).resolve().parent.parent / "test-results" / "traces"


def trace_path(test_name: str) -> Path:
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = test_name.replace("/", "_").replace("::", "__")
    return TRACE_DIR / f"{safe_name}.zip"
