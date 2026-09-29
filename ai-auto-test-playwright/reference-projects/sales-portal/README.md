# Sales Portal reference tests

This directory is a **versioned backup** of the Sales Portal pytest project. The live copy used by the platform worker lives on the Docker volume (`/data/projects/sales-portal/tests/`), typically bind-mounted from `docker/data/projects/sales-portal/`.

## What is included

- `tests/specs/`, `pages/`, `data/`, `plans/`, `recorded/`, `conftest.py`, `pytest.ini`, `requirements.txt`, `fixtures/hkid-sample.png`

## Excluded from sync

- `tests/fixtures/auth.json` (session secrets)
- `tests/.runs/`, `report.html`, `.pytest_cache/`

## One-way sync (volume → reference)

From repo root:

```bash
./scripts/sync-reference-sales-portal.sh
```

Or manually:

```bash
SRC=ai-auto-test-playwright/docker/data/projects/sales-portal/tests
DEST=ai-auto-test-playwright/reference-projects/sales-portal/tests
mkdir -p "$DEST"
(cd "$SRC" && tar cf - \
  --exclude='fixtures/auth.json' --exclude='.runs' --exclude='report.html' --exclude='.pytest_cache' \
  .) | (cd "$DEST" && tar xf -)
```

After editing tests on the worker volume, run the script again to refresh this backup.
