#!/usr/bin/env python3
"""KRX Data Marketplace OPEN API 얇은 래퍼 (유가증권/코스닥 일별매매정보).

KRX_API_KEY 환경변수를 사용한다. 일자별 응답은 cache/krx/{YYYYMMDD}.json 에 캐시.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache" / "krx"

ENDPOINTS = {
    "KOSPI": "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd",
    "KOSDAQ": "https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd",
}


class KrxError(RuntimeError):
    pass


def _api_key() -> str:
    key = os.environ.get("KRX_API_KEY", "").strip()
    if not key:
        raise KrxError("KRX_API_KEY 환경변수가 없습니다.")
    return key


def _call(url: str, date: str, retries: int = 3) -> list[dict]:
    req = urllib.request.Request(
        f"{url}?basDd={date}",
        headers={"AUTH_KEY": _api_key(), "User-Agent": "fwd-per-band/1.0"},
    )
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("OutBlock_1") or []
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise KrxError(f"KRX 호출 실패 {url} {date}: {last}")


def _num(value: str | None) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def fetch_day(date: str, use_cache: bool = True) -> dict[str, dict]:
    """{종목코드: {close, cap, shares, name, market}} 반환. 휴장일이면 빈 dict."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{date}.json"
    if use_cache and path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached:
            return cached

    out: dict[str, dict] = {}
    for market, url in ENDPOINTS.items():
        for row in _call(url, date):
            code = (row.get("ISU_CD") or row.get("ISU_SRT_CD") or "").strip()
            close = _num(row.get("TDD_CLSPRC"))
            if not code or not close:
                continue
            out[code] = {
                "name": (row.get("ISU_NM") or row.get("ISU_ABBRV") or "").strip(),
                "market": market,
                "close": close,
                "cap": _num(row.get("MKTCAP")),
                "shares": _num(row.get("LIST_SHRS")),
            }
    if out:
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def is_trading_day(date: str, use_cache: bool = True) -> bool:
    return bool(fetch_day(date, use_cache))
