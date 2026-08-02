#!/usr/bin/env python3
"""엑셀 EPS 시드 + KRX 종가 -> raw/master.json (누적 시계열 원장).

master.json 스키마
{
  "dates":  ["20250801", ...],                       # 거래일 오름차순
  "stocks": {
     "005930": {"name":"삼성전자","market":"KOSPI","cap":1.53e15,
                "price":[...], "eps":[...]}          # 길이 = len(dates)
  },
  "updated": "20260731"
}
이후 daily_update.py 가 이 파일 뒤에 하루씩 붙인다.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import krx

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eps", type=Path, default=ROOT / "raw" / "eps_history.json")
    ap.add_argument("--out", type=Path, default=ROOT / "raw" / "master.json")
    args = ap.parse_args()

    seed = json.loads(args.eps.read_text(encoding="utf-8"))
    codes = sorted(seed["eps"])

    dates: list[str] = []
    day_cache: dict[str, dict] = {}
    for date in seed["dates"]:
        day = krx.fetch_day(date)
        if not day:
            print(f"  ! {date}: KRX 데이터 없음 -> 제외")
            continue
        dates.append(date)
        day_cache[date] = day

    stocks: dict[str, dict] = {}
    for code in codes:
        eps_by_date = dict(zip(seed["dates"], seed["eps"][code]))
        price, eps = [], []
        name, market, cap = seed["names"].get(code, code), "", None
        for date in dates:
            row = day_cache[date].get(code)
            if row:
                price.append(row["close"])
                name, market, cap = row["name"], row["market"], row["cap"]
            else:
                price.append(None)
            eps.append(eps_by_date.get(date))
        if not any(p is not None for p in price):
            print(f"  ! {code} {name}: KRX 시세 없음 -> 제외")
            continue
        stocks[code] = {
            "name": name,
            "market": market,
            "cap": cap,
            "price": price,
            "eps": eps,
        }

    master = {"dates": dates, "stocks": stocks, "updated": dates[-1]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(master, ensure_ascii=False), encoding="utf-8")
    print(f"master: {len(stocks)}종목 x {len(dates)}일 ({dates[0]}~{dates[-1]}) -> {args.out}")


if __name__ == "__main__":
    main()
