#!/usr/bin/env python3
"""raw/master.json -> docs/data/*.json (대시보드가 읽는 정적 데이터).

산출물
  docs/data/index.json          : 목록 화면용 종목 요약 (정렬/검색 대상)
  docs/data/stocks/{code}.json  : 상세 화면용 일별 주가·EPS·Fwd PER 시계열
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def per_series(price: list, eps: list) -> list:
    out = []
    for p, e in zip(price, eps):
        if p and e and e > 0:
            out.append(round(p / e, 3))
        else:
            out.append(None)
    return out


def recent_mdd(per: list, dates: list[str]) -> dict:
    """가장 최근 PER 고점(기간 내 최고치) 이후 최저점까지의 낙폭.

    고점 이후 아직 신고점을 회복하지 못했으므로 이 구간이 '가장 최근 드로다운'이다.
    """
    pts = [(i, v) for i, v in enumerate(per) if v is not None]
    if len(pts) < 2:
        return {}
    peak_i, peak_v = max(pts, key=lambda t: (t[1], t[0]))  # 동일 최고치면 나중 것
    after = [(i, v) for i, v in pts if i >= peak_i]
    trough_i, trough_v = min(after, key=lambda t: t[1])
    last_i, last_v = pts[-1]
    return {
        "mdd": round((trough_v / peak_v - 1) * 100, 2),
        "mdd_peak_date": dates[peak_i],
        "mdd_peak": peak_v,
        "mdd_trough_date": dates[trough_i],
        "mdd_trough": trough_v,
        "cur_dd": round((last_v / peak_v - 1) * 100, 2),
        "recovering": trough_i < last_i,
    }


def stats(per: list) -> dict:
    vals = [v for v in per if v is not None]
    if not vals:
        return {}
    n = len(vals)
    mean = sum(vals) / n
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / n) if n > 1 else 0.0
    ordered = sorted(vals)
    cur = next((v for v in reversed(per) if v is not None), None)
    rank = sum(1 for v in ordered if v <= cur) / n * 100 if cur is not None else None

    def q(p: float) -> float:
        if n == 1:
            return ordered[0]
        pos = p * (n - 1)
        lo = int(math.floor(pos))
        hi = min(lo + 1, n - 1)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)

    return {
        "per": cur,
        "per_avg": round(mean, 2),
        "per_sd": round(sd, 3),
        "per_min": round(ordered[0], 2),
        "per_max": round(ordered[-1], 2),
        "per_q1": round(q(0.25), 2),
        "per_med": round(q(0.5), 2),
        "per_q3": round(q(0.75), 2),
        "per_pct": round(rank, 1) if rank is not None else None,
        "samples": n,
    }


def pct_change(series: list, back: int) -> float | None:
    cur = next((v for v in reversed(series) if v is not None), None)
    if cur is None or len(series) <= back:
        return None
    prev = next((v for v in reversed(series[: -back or None]) if v is not None), None)
    if not prev:
        return None
    return round((cur / prev - 1) * 100, 2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", type=Path, default=ROOT / "raw" / "master.json")
    ap.add_argument("--outdir", type=Path, default=ROOT / "docs" / "data")
    args = ap.parse_args()

    master = json.loads(args.master.read_text(encoding="utf-8"))
    dates: list[str] = master["dates"]
    stock_dir = args.outdir / "stocks"
    stock_dir.mkdir(parents=True, exist_ok=True)

    index = []
    for code, s in master["stocks"].items():
        per = per_series(s["price"], s["eps"])
        st = stats(per)
        mdd = recent_mdd(per, dates) if st else {}
        if st:
            status = "ok"
        elif any(e is not None for e in s["eps"]):
            status = "loss"  # 컨센서스는 있으나 12M 선행 EPS 적자 -> PER 산출 불가
        else:
            status = "no_consensus"  # 애널리스트 커버리지 없음
        last_price = next((p for p in reversed(s["price"]) if p is not None), None)
        last_eps = next((e for e in reversed(s["eps"]) if e is not None), None)

        # 상세 파일에서는 'per' 키를 시계열로 쓰므로 스칼라 통계값은 이름을 바꾼다
        st_detail = dict(st)
        st_detail["per_last"] = st_detail.pop("per", None)

        (stock_dir / f"{code}.json").write_text(
            json.dumps(
                {
                    "code": code,
                    "name": s["name"],
                    "market": s["market"],
                    "status": status,
                    "dates": dates,
                    "price": s["price"],
                    "eps": s["eps"],
                    "per": per,
                    **st_detail,
                    **mdd,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        index.append(
            {
                "code": code,
                "name": s["name"],
                "market": s["market"],
                "status": status,
                "cap": s["cap"],
                "price": last_price,
                "eps": last_eps,
                "chg": pct_change(s["price"], 1),
                "per_chg_1m": pct_change(per, 20),
                "eps_chg_1m": pct_change(s["eps"], 20),
                **st,
                **mdd,
            }
        )

    index.sort(key=lambda r: -(r["cap"] or 0))
    meta = {
        "updated": master.get("updated", dates[-1]),
        "start": dates[0],
        "end": dates[-1],
        "count": len(index),
        "days": len(dates),
    }
    (args.outdir / "index.json").write_text(
        json.dumps({"meta": meta, "stocks": index}, ensure_ascii=False), encoding="utf-8"
    )
    print(f"site data: {len(index)}종목, {len(dates)}일 -> {args.outdir}")


if __name__ == "__main__":
    main()
