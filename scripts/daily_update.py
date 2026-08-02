#!/usr/bin/env python3
"""매일 누적 업데이트: KRX 종가 + FnGuide Fwd.12M 컨센서스 -> master.json 에 append.

동작
  1. master.json 의 마지막 일자 다음날부터 오늘까지 KRX 거래일을 찾는다.
  2. FnGuide Company Guide(Consensus)에서 종목별 PER(Fwd.12M)과 그 기준일자를 받는다.
     EPS(Fwd.12M) = 기준일 종가 / PER(Fwd.12M) 로 역산한다.
  3. 새 일자를 master 에 붙이고 build_site.py 로 정적 데이터를 다시 만든다.

FnGuide 페이지는 '전 영업일' 기준이므로 장 마감 후가 아니라
다음 날 아침(예: 08:10 KST)에 돌리면 종가와 컨센서스 기준일이 정확히 맞는다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import fnguide
import krx

ROOT = Path(__file__).resolve().parents[1]
KST = dt.timezone(dt.timedelta(hours=9))


def next_dates(last: str, today: str) -> list[str]:
    start = dt.datetime.strptime(last, "%Y%m%d").date() + dt.timedelta(days=1)
    end = dt.datetime.strptime(today, "%Y%m%d").date()
    out = []
    while start <= end:
        if start.weekday() < 5:
            out.append(start.strftime("%Y%m%d"))
        start += dt.timedelta(days=1)
    return out


def fetch_consensus(codes: list[str], workers: int, delay: float) -> dict[str, dict]:
    result: dict[str, dict] = {}

    def work(code: str) -> tuple[str, dict | None]:
        time.sleep(delay * random.uniform(0.6, 1.6))
        try:
            return code, fnguide.consensus(code)
        except Exception as exc:  # noqa: BLE001 - 개별 종목 실패는 건너뛴다
            print(f"  ! {code} 컨센서스 실패: {exc}", flush=True)
            return code, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (code, data) in enumerate(pool.map(work, codes), 1):
            if data:
                result[code] = data
            if i % 50 == 0:
                print(f"  컨센서스 {i}/{len(codes)}", flush=True)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", type=Path, default=ROOT / "raw" / "master.json")
    ap.add_argument("--today", default=dt.datetime.now(KST).strftime("%Y%m%d"))
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--skip-consensus", action="store_true",
                    help="EPS 를 직전 값으로 이월하고 시세만 붙인다")
    args = ap.parse_args()

    master = json.loads(args.master.read_text(encoding="utf-8"))
    dates: list[str] = master["dates"]
    stocks: dict[str, dict] = master["stocks"]

    candidates = next_dates(dates[-1], args.today)
    if not candidates:
        print("추가할 날짜 없음")
        return

    new_days: list[tuple[str, dict]] = []
    for date in candidates:
        day = krx.fetch_day(date, use_cache=False)
        if day:
            new_days.append((date, day))
        else:
            print(f"  - {date}: 휴장/미공개")
    if not new_days:
        print("신규 거래일 없음")
        return
    print(f"신규 거래일: {[d for d, _ in new_days]}")

    codes = sorted(stocks)
    consensus = {} if args.skip_consensus else fetch_consensus(codes, args.workers, args.delay)
    print(f"컨센서스 수집: {len(consensus)}/{len(codes)}")

    for date, day in new_days:
        dates.append(date)
        for code in codes:
            s = stocks[code]
            row = day.get(code)
            s["price"].append(row["close"] if row else None)
            if row:
                s["name"], s["market"], s["cap"] = row["name"], row["market"], row["cap"]

            eps = None
            cns = consensus.get(code)
            if cns and cns.get("per_fwd"):
                base = cns.get("base_date")
                ref = None
                if base and base in dates:
                    ref = s["price"][dates.index(base)]
                if ref is None:
                    ref = next((p for p in reversed(s["price"]) if p is not None), None)
                if ref:
                    eps = round(ref / cns["per_fwd"], 4)
            if eps is None:  # 컨센서스 없음/실패 -> 직전 값 이월
                eps = next((e for e in reversed(s["eps"]) if e is not None), None)
            s["eps"].append(eps)

    extra = master.setdefault("consensus", {})
    for code, cns in consensus.items():
        extra[code] = {
            "target_price": cns.get("target_price"),
            "opinion": cns.get("opinion"),
            "eps_fy": cns.get("eps_fy"),
            "per_fwd": cns.get("per_fwd"),
            "base_date": cns.get("base_date"),
        }

    master["updated"] = dates[-1]
    args.master.write_text(json.dumps(master, ensure_ascii=False), encoding="utf-8")
    print(f"master 갱신 완료: {dates[-1]} ({len(dates)}일)")


if __name__ == "__main__":
    main()
