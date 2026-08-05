#!/usr/bin/env python3
"""데이터가 실제로 최신인지 확인한다. 밀렸으면 비0으로 끝내 워크플로를 빨갛게 만든다.

daily_update.py 는 KRX/FnGuide 가 조용히 빈 응답을 줘도 "신규 거래일 없음" 으로
정상 종료한다. 그러면 워크플로는 초록불인데 사이트만 며칠째 굳는다 —
이 저장소에서 실제로 발생하는 실패 모드라 여기서 따로 막는다.

기준: master 의 마지막 일자가 '직전 영업일' 보다 N영업일 이상 뒤처지면 실패.
공휴일은 알 수 없으므로 연휴(최대 3영업일)까지는 통과시킨다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = dt.timezone(dt.timedelta(hours=9))


def weekdays_between(start: dt.date, end: dt.date) -> int:
    """start(제외) ~ end(포함) 사이 평일 수."""
    n = 0
    cur = start + dt.timedelta(days=1)
    while cur <= end:
        if cur.weekday() < 5:
            n += 1
        cur += dt.timedelta(days=1)
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", type=Path, default=ROOT / "raw" / "master.json")
    ap.add_argument("--max-lag", type=int, default=4,
                    help="허용 지연 영업일 수 (연휴 감안, 이 값 '이상'이면 실패)")
    args = ap.parse_args()

    master = json.loads(args.master.read_text(encoding="utf-8"))
    last = dt.datetime.strptime(master["dates"][-1], "%Y%m%d").date()

    today = dt.datetime.now(KST).date()
    target = today - dt.timedelta(days=1)          # 오늘 종가는 아직 없다
    while target.weekday() >= 5:
        target -= dt.timedelta(days=1)

    lag = weekdays_between(last, target)
    print(f"마지막 데이터 {last} / 목표 {target} / 지연 {lag}영업일")

    if lag >= args.max_lag:
        print(f"::error::데이터가 {lag}영업일 밀렸다. KRX OPEN API 키 만료 또는 "
              f"FnGuide 파싱 실패를 의심하라.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
