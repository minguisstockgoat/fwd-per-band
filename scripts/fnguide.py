#!/usr/bin/env python3
"""FnGuide Company Guide(wcomp.fnguide.com) 컨센서스 크롤러.

`companyguide` 스킬과 동일한 공개 엔드포인트 / 헤더를 사용한다(로그인·세션 불필요).
Consensus 페이지에 embed 된 `cnsTrend` JSON 에서
  - 기준일자 (header[0].NM, 보통 전 영업일)
  - PER(Fwd. 12M)
  - 목표주가 / 투자의견(점수)
  - 연간 컨센서스 EPS (perforTrend)
를 뽑는다.

EPS(Fwd.12M) 자체는 페이지에 노출되지 않으므로
  EPS(Fwd.12M) = 기준일 수정주가 / PER(Fwd.12M)
로 역산한다(PER 소수 2자리 → 오차 0.1% 수준).
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

BASE = "https://wcomp.fnguide.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Referer": BASE + "/",
    "Accept-Language": "ko-KR,ko;q=0.9",
}


class FnGuideError(RuntimeError):
    pass


def _get(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=40) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(2.0 * (attempt + 1))
    raise FnGuideError(f"요청 실패 {url}: {last}")


def _embedded_json(html: str, key: str) -> dict | None:
    marker = f"{key}: "
    start = html.find(marker)
    if start < 0:
        return None
    start += len(marker)
    depth, in_str, esc = 0, False, False
    for i in range(start, len(html)):
        ch = html[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _num(value) -> float | None:
    if value in (None, "", "-", "N/A"):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def snapshot_per_fwd(code: str) -> float | None:
    """Snapshot 페이지 우측 밸류에이션 박스의 PER(Fwd.12M) 값."""
    html = _get(f"{BASE}/CompanyInfo/Snapshot?cmp_cd={code}")
    hits = [m.end() for m in re.finditer(r"PER\(Fwd\.12M\)", html)]
    if len(hits) < 2:
        return None
    tail = re.sub(r"<[^>]+>", "|", html[hits[1] : hits[1] + 600])
    # 라벨 바로 다음 칸만 본다. 값이 '-'(적자·미산출)면 그대로 None
    cell = next((t for t in (x.strip() for x in tail.split("|")) if t), None)
    return _num(cell)


def consensus(code: str) -> dict:
    """{base_date, per_fwd, target_price, opinion, eps_fy: {'2026/12': ...}} 반환."""
    html = _get(f"{BASE}/CompanyInfo/Consensus?cmp_cd={code}")
    out: dict = {
        "code": code,
        "base_date": None,
        "per_fwd": None,
        "per_fwd_1m": None,
        "target_price": None,
        "opinion": None,
        "eps_fy": {},
    }

    trend = _embedded_json(html, "cnsTrend")
    if trend:
        header = trend.get("header") or []
        if header:
            raw = str(header[0].get("NM") or "")
            if re.fullmatch(r"\d{4}/\d{2}/\d{2}", raw):
                out["base_date"] = raw.replace("/", "")
        for row in trend.get("data") or []:
            name = (row.get("ACC_NM") or "").strip()
            if name.startswith("PER(Fwd"):
                out["per_fwd"] = _num(row.get("VAL1"))
                out["per_fwd_1m"] = _num(row.get("VAL2"))
            elif name == "목표주가":
                out["target_price"] = _num(row.get("VAL1"))
            elif name.startswith("투자의견"):
                out["opinion"] = _num(row.get("VAL1"))

    if out["per_fwd"] is None:
        # 일부 종목(보험사 등)은 Consensus 그리드가 비어 있다 -> Snapshot 페이지에서 보완
        out["per_fwd"] = snapshot_per_fwd(code)
        if out["per_fwd"] is not None:
            out["source"] = "snapshot"

    periods = re.search(r"trendYYMM:\s*(\[[^\]]*\])", html)
    perfor = _embedded_json(html, "perforTrend")
    if periods and perfor:
        try:
            labels = [p["YYMM_F"] for p in json.loads(periods.group(1))]
        except (json.JSONDecodeError, KeyError):
            labels = []
        for row in perfor.get("data") or []:
            if (row.get("NAME") or "").strip() != "EPS":
                continue
            # VAL1~VAL3 = 과거 3개년, VAL4~VAL6 = trendYYMM(추정 3개년)
            for i, label in enumerate(labels):
                out["eps_fy"][label] = _num(row.get(f"VAL{i + 4}"))
            break
    return out


if __name__ == "__main__":
    import sys

    print(json.dumps(consensus(sys.argv[1] if len(sys.argv) > 1 else "005930"),
                     ensure_ascii=False, indent=2))
