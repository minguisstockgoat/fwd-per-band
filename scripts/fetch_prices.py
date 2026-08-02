#!/usr/bin/env python3
"""엑셀 EPS 시계열의 각 일자에 대한 KRX 종가/시가총액 백필."""
from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import krx

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eps", type=Path, default=ROOT / "raw" / "eps_history.json")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    eps = json.loads(args.eps.read_text(encoding="utf-8"))
    dates: list[str] = eps["dates"]

    done, empty = 0, []

    def work(date: str) -> tuple[str, int]:
        return date, len(krx.fetch_day(date))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for date, count in pool.map(work, dates):
            done += 1
            if not count:
                empty.append(date)
            if done % 25 == 0:
                print(f"{done}/{len(dates)} ... {date} rows={count}", flush=True)

    print(f"완료: {len(dates)}일, 데이터 없는 날 {len(empty)}건 {empty[:10]}")


if __name__ == "__main__":
    main()
