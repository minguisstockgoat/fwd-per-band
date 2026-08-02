#!/usr/bin/env python3
"""검증: 엑셀 EPS + KRX 종가로 계산한 Fwd PER 이 FnGuide 표기값과 일치하는지 확인."""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import fnguide

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=20)
    ap.add_argument("--codes", nargs="*")
    args = ap.parse_args()

    idx = json.loads((ROOT / "docs" / "data" / "index.json").read_text(encoding="utf-8"))
    ok = [r for r in idx["stocks"] if r["status"] == "ok"]
    end = idx["meta"]["end"]
    picks = (
        [r for r in ok if r["code"] in args.codes]
        if args.codes
        else ok[:5] + random.sample(ok[5:], min(args.n - 5, len(ok) - 5))
    )

    diffs = []
    for r in picks:
        cns = fnguide.consensus(r["code"])
        if not cns.get("per_fwd") or cns.get("base_date") != end:
            print(f"{r['code']} {r['name']:12s} 기준일 불일치({cns.get('base_date')}) 또는 값 없음")
            continue
        mine, theirs = r["per"], cns["per_fwd"]
        gap = (mine / theirs - 1) * 100
        diffs.append(abs(gap))
        flag = "  " if abs(gap) < 1 else " <<"
        print(f"{r['code']} {r['name']:14s} 계산 {mine:9.3f} / FnGuide {theirs:9.2f}  차이 {gap:+6.2f}%{flag}")

    if diffs:
        diffs.sort()
        print(f"\nn={len(diffs)}  중앙값 {diffs[len(diffs)//2]:.2f}%  최대 {diffs[-1]:.2f}%")


if __name__ == "__main__":
    main()
