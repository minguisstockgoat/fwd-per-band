# Fwd PER Band — 코스피200 · 코스닥150

12개월 선행(Fwd.12M) PER 밴드 대시보드. GitHub Pages 정적 사이트 + 매일 자동 누적.

**Fwd PER = KRX 종가 ÷ EPS(Fwd.12M, 지배)**

## 화면

- **목록**: 종목명/코드 검색, 시장(KOSPI·KOSDAQ) 필터, 열 클릭 정렬
  (시가총액 · Fwd PER 오름/내림 · 밴드 백분위 · **최근 MDD** · 현재 낙폭 · PER 1개월 변화)
- **상세**(종목명 클릭): Fwd PER Band(주가 + EPS×배수 라인) · Fwd PER 추이(평균 ±1σ, 최근 드로다운 음영) · EPS 컨센서스 추이

지표 정의

| 항목 | 정의 |
|---|---|
| 1년 PER 밴드 | 최근 1년 Fwd PER의 5% / 25% / 중앙 / 75% / 95% 분위 (극단값에 밴드가 끌려가지 않도록 min·max 대신 5~95% 사용) |
| 밴드 % | 현재 PER의 1년 분포 내 백분위 |
| 제외 구간 | 선행 EPS가 자기 기간 최대치의 3% 미만인 날(흑자전환 부근)은 PER이 무의미해 산출에서 제외 |
| **최근 MDD** | 1년 내 PER 최고점 이후 최저점까지의 낙폭(%) — 최고점 이후 신고점이 없으므로 이 구간이 가장 최근 드로다운 |
| 현재 낙폭 | 그 최고점 대비 현재 PER 위치(%) |

## 데이터 파이프라인

```
엑셀(코200,닥150 12mf eps.xlsx)  ─┐
                                  ├─> raw/master.json ──> docs/data/*.json ──> GitHub Pages
KRX OPEN API 일별 종가/시총      ─┘         ▲
                                            │ 매일 append
                          FnGuide Company Guide(PER Fwd.12M)
```

- **과거 1년(2025-08-01 ~ 2026-07-31)**: 사용자가 추출한 엑셀의 `EPS(Fwd.12M, 지배)` 일별 시계열 + KRX 일별 종가
- **이후 매일**: KRX 종가 + FnGuide `PER(Fwd.12M)`에서 EPS 역산 (`EPS = 기준일 종가 ÷ PER(Fwd.12M)`)
- FnGuide는 `companyguide` 스킬과 같은 공개 페이지(`wcomp.fnguide.com`)만 사용한다. 로그인·세션 없음, 종목당 1요청/일, 3워커·랜덤 지연.

### 스크립트

| 스크립트 | 역할 |
|---|---|
| `scripts/parse_excel.py` | 엑셀 → `raw/eps_history.json` (시드 EPS) |
| `scripts/fetch_prices.py` | 시드 구간 KRX 일별 시세 백필 (`cache/krx/`) |
| `scripts/build_master.py` | 시드 EPS + 시세 → `raw/master.json` |
| `scripts/calibrate.py` | 엑셀 EPS 레벨을 FnGuide 현재값에 맞춰 검증·보정 |
| `scripts/daily_update.py` | 신규 거래일 append (KRX + FnGuide) |
| `scripts/build_site.py` | `raw/master.json` → `docs/data/` |
| `scripts/validate.py` | 계산 PER vs FnGuide 표기 PER 대조 |
| `scripts/check_freshness.py` | 데이터 지연 감시 (밀리면 워크플로 실패) |

### 최초 구축 순서

```bash
py scripts/parse_excel.py
py scripts/fetch_prices.py        # 243거래일 x KOSPI/KOSDAQ
py scripts/build_master.py
py scripts/calibrate.py --apply   # 레벨 보정(선택)
py scripts/build_site.py
```

## 검증

시드 마지막 일자(2026-07-31) 기준, 계산한 Fwd PER과 FnGuide 표기값 대조:
**비교 가능 259종목, 괴리 중앙값 0.02%** (PER 소수 2자리 반올림 오차 수준).

3% 이상 벌어진 2종목(한화생명 088350, 종근당 185750)은 엑셀 시계열의 레벨이 FnGuide와 달라
`calibrate.py --apply`로 과거 전체를 비율 보정했다(모양은 유지, `raw/master.json`의 `calib` 참조).
컨센서스가 없거나 선행 EPS가 적자인 종목은 PER을 산출하지 않고 목록에 `커버리지 없음` / `적자`로 표시한다.

## 운영

- **자동**: `.github/workflows/update.yml` — 월~토 08:10 KST(cron `10 23 * * 0-5`).
  스케줄 러너는 최대 1시간 늦게 뜬다. 토요일 실행이 있어야 금요일 종가가 월요일까지 밀리지 않는다.
- **데이터는 항상 T-1** — 08:10 KST 시점엔 당일 종가가 없으므로 사이트 기준일은 직전 영업일이다.
- **수동**: 대시보드 우상단 **↻ 수동 갱신** 버튼(아래) 또는 Actions 탭 → `daily-update` → Run workflow
- **필요 시크릿**: `KRX_API_KEY` (KRX Data Marketplace OPEN API 인증키)

```bash
gh secret set KRX_API_KEY --repo minguisstockgoat/fwd-per-band
```

### 수동 갱신 버튼 / 지연 배지

정적 페이지라 서버가 없다. 버튼은 GitHub API 로 `daily-update` 를 `workflow_dispatch` 하고
런 상태를 폴링하다가, 성공하면 Pages 재배포까지 기다렸다 자동 새로고침한다.

1. [Fine-grained PAT](https://github.com/settings/personal-access-tokens/new) 발급 —
   Repository access `fwd-per-band`, Permissions **Actions: Read and write**
2. 대시보드 우상단 ⚙ → 토큰 붙여넣고 저장 (브라우저 localStorage 에만 저장, 기기마다 1회)

토큰이 없으면 ⚙ 패널에서 Actions 페이지로 넘어가 직접 실행할 수 있다.
기준일 옆 배지는 `최신` / `갱신 대기`(오늘 자동 실행 전) / `N영업일 지연`(밀림 의심)을 보여준다.
공휴일은 판별하지 못하므로 연휴 뒤엔 오탐이 날 수 있다.

### 조용한 실패 방지

`daily_update.py` 는 KRX/FnGuide 가 빈 응답을 줘도 "신규 거래일 없음" 으로 정상 종료한다
(워크플로는 초록불인데 사이트만 굳는 실패 모드). 그래서 마지막 스텝에서
`scripts/check_freshness.py` 가 데이터가 4영업일 이상 밀렸는지 보고 밀렸으면 런을 실패시킨다.

## 한계

- 구성종목은 엑셀 추출 시점(2026-08) 기준으로 고정. 정기변경 반영은 엑셀을 다시 뽑아 시드를 재생성해야 한다.
- KRX 종가는 무수정주가. 시드 구간 중 액면분할·병합이 있었던 종목은 해당 시점에서 PER 시계열이 튈 수 있다.
- FnGuide 컨센서스는 참고자료이며 정확성이 보증되지 않는다. 투자 판단의 책임은 이용자에게 있다.
