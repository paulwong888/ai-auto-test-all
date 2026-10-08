#!/usr/bin/env python3
"""预生成 HKID pool（算法同 https://pinkylam.me/playground/hkid/）。

用法（在 tests/ 目录下）：
  python scripts/generate_hkid_pool.py --count 39 --out data/hkid_pool.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_TESTS_ROOT = Path(__file__).resolve().parent.parent
if str(_TESTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_TESTS_ROOT))

from data.hkid_generator import generate_hkid, is_valid_hkid, to_portal_format  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate HKID pool JSON")
    parser.add_argument("--count", type=int, default=39, help="Number of HKIDs (default: 39)")
    parser.add_argument(
        "--out",
        type=Path,
        default=_TESTS_ROOT / "data" / "hkid_pool.json",
        help="Output JSON path",
    )
    args = parser.parse_args()

    seen: set[str] = set()
    hkids: list[str] = []
    attempts = 0
    max_attempts = args.count * 50

    while len(hkids) < args.count and attempts < max_attempts:
        attempts += 1
        raw = generate_hkid()
        if not is_valid_hkid(raw):
            continue
        portal = to_portal_format(raw)
        if portal in seen:
            continue
        seen.add(portal)
        hkids.append(portal)

    if len(hkids) < args.count:
        raise SystemExit(f"only generated {len(hkids)}/{args.count} unique HKIDs after {attempts} attempts")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"hkids": hkids}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(hkids)} HKIDs to {args.out}")


if __name__ == "__main__":
    main()
