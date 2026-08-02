#!/usr/bin/env python3
"""시드(엑셀) EPS 레벨을 FnGuide 현재값에 맞춰 보정 + 전 종목 검증 리포트.

엑셀에서 받은 EPS(Fwd.12M) 시계열과, 앞으로 매일 FnGuide 에서 역산할 EPS 의 '레벨'이
어긋나면 이어붙이는 순간 계단이 생긴다. 시드 마지막 일자 기준으로 두 값을 비교해
차이가 임계치를 넘는 종목만 과거 전체를 비율 보정한다(시계열 모양은 그대로).

  py scripts/calibrate.py            # 리포트만
  py scripts/calibrate.py --apply    # master.json 에 보정 반영
"""
from __future__ import annotations

import argparse
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import fnguide

ROOT = Path(__file__).resolve().parents[1]


def crawl(codes: list[str], workers: int, delay: float) -> dict[str, dict]:
    out: dict[str, dict] = {}

    def work(code: str):
        time.sleep(delay * random.uniform(0.6, 1.6))
        try:
            return code, fnguide.consensus(code)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {code}: {exc}", flush=True)
            return code, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (code, data) in enumerate(pool.map(work, codes), 1):
            if data:
                out[code] = data
            if i % 50 == 0:
                print(f"  {i}/{len(codes)}", flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", type=Path, default=ROOT / "raw" / "master.json")
    ap.add_argument("--snapshot", type=Path, default=ROOT / "raw" / "consensus_snapshot.json")
    ap.add_argument("--threshold", type=float, default=3.0, help="보정 임계치(%)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--reuse", action="store_true", help="기존 스냅샷 재사용")
    args = ap.parse_args()

    master = json.loads(args.master.read_text(encoding="utf-8"))
    dates, stocks = master["dates"], master["stocks"]
    codes = sorted(stocks)

    if args.reuse and args.snapshot.exists():
        snap = json.loads(args.snapshot.read_text(encoding="utf-8"))
    else:
        snap = crawl(codes, args.workers, args.delay)
        args.snapshot.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    print(f"컨센서스 스냅샷 {len(snap)}/{len(codes)}")

    rows, no_ref = [], []
    for code in codes:
        s = stocks[code]
        cns = snap.get(code) or {}
        per_fwd, base = cns.get("per_fwd"), cns.get("base_date")
        if not per_fwd or base not in dates:
            no_ref.append(code)
            continue
        i = dates.index(base)
        price, eps = s["price"][i], s["eps"][i]
        if not price or not eps or eps <= 0:
            no_ref.append(code)
            continue
        eps_fn = price / per_fwd
        gap = (eps / eps_fn - 1) * 100
        rows.append((abs(gap), gap, code, s["name"], eps, eps_fn, eps_fn / eps))

    rows.sort(reverse=True)
    bad = [r for r in rows if r[0] > args.threshold]
    print(f"\n비교 가능 {len(rows)}종목 / 기준값 없음 {len(no_ref)}종목")
    print(f"괴리 {args.threshold}% 초과: {len(bad)}종목")
    for _, gap, code, name, eps, eps_fn, ratio in bad:
        print(f"  {code} {name:14s} 엑셀 {eps:10.1f} / FnGuide {eps_fn:10.1f}  ({gap:+.1f}%)")
    mid = rows[len(rows) // 2][0] if rows else 0
    print(f"중앙 괴리 {mid:.2f}%")

    if args.apply and bad:
        calib = master.setdefault("calib", {})
        for _, _, code, _, _, _, ratio in bad:
            eps = stocks[code]["eps"]
            stocks[code]["eps"] = [round(e * ratio, 4) if e is not None else None for e in eps]
            calib[code] = round(ratio, 6)
        args.master.write_text(json.dumps(master, ensure_ascii=False), encoding="utf-8")
        print(f"\n{len(bad)}종목 EPS 레벨 보정 후 master 저장")


if __name__ == "__main__":
    main()
