/* 수동 갱신 — GitHub Actions(daily-update) workflow_dispatch 호출 + 지연 배지
 *
 * 정적 페이지라 서버가 없다. 갱신은 Actions 워크플로가 하므로, 버튼은
 * GitHub API 로 workflow_dispatch 를 쏘고 런 상태를 폴링한다.
 * 토큰(fine-grained PAT, Actions: Read and write)은 이 브라우저의
 * localStorage 에만 저장한다 — 저장소는 public 이지만 토큰은 사람마다 별개다.
 * 토큰이 없으면 Actions 페이지를 새 탭으로 여는 것으로 대체한다.
 */
(function () {
  var REPO = 'minguisstockgoat/fwd-per-band';
  var WORKFLOW = 'update.yml';
  var TOKEN_KEY = 'fpb_gh_token';
  var ACTIONS_URL = 'https://github.com/' + REPO + '/actions/workflows/' + WORKFLOW;

  var $ = function (s) { return document.querySelector(s); };
  var btn, statusEl, panel, badgeEl;
  var busy = false, timer = null, poll = null, startedAt = 0;

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }

  function api(path, opts) {
    opts = opts || {};
    var h = { 'Accept': 'application/vnd.github+json' };
    if (token()) h['Authorization'] = 'Bearer ' + token();
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('https://api.github.com/repos/' + REPO + path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }

  // ---------- 지연 배지 ----------
  function kstToday() {
    var n = new Date();
    var utc = n.getTime() + n.getTimezoneOffset() * 60000;
    return new Date(utc + 9 * 3600000);
  }
  function ymd(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  // end(YYYYMMDD) 이후 오늘(KST) 전일까지 남은 영업일 수. 공휴일은 모르므로 근사치.
  function lagBizDays(end) {
    var y = +end.slice(0, 4), m = +end.slice(4, 6) - 1, d = +end.slice(6, 8);
    var cur = new Date(Date.UTC(y, m, d));
    var t = kstToday();
    var limit = ymd(t); // 오늘 종가는 아직 없으므로 전일까지가 목표
    var n = 0;
    while (true) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      var v = cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate();
      if (v >= limit) break;
      var w = cur.getUTCDay();
      if (w >= 1 && w <= 5) n++;
    }
    return n;
  }

  // 다음 자동 갱신 시각(영업일 08:10 KST) — '왜 오늘 날짜가 아닌가'를 헤더에서 바로 답한다.
  function nextUpdateLabel() {
    var t = kstToday();
    var d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
    var beforeRun = t.getHours() < 8 || (t.getHours() === 8 && t.getMinutes() < 10);
    if (!beforeRun) d.setUTCDate(d.getUTCDate() + 1);   // 오늘 회차는 지났다
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' 08:10';
  }

  function renderBadge(meta) {
    if (!badgeEl || !meta || !meta.end) return;
    var lag = lagBizDays(meta.end);
    badgeEl.hidden = false;
    if (lag <= 0) {
      badgeEl.className = 'freshness ok';
      badgeEl.textContent = '최신 · 다음 갱신 ' + nextUpdateLabel();
      badgeEl.title = '직전 영업일 종가까지 반영됨. 오늘 종가는 다음 갱신 회차에 붙는다(주말·휴일 뒤에는 기준일이 며칠 전으로 보이는 게 정상).';
    } else if (lag === 1) {
      badgeEl.className = 'freshness wait';
      badgeEl.textContent = '갱신 대기';
      badgeEl.title = '직전 영업일 종가가 아직 안 붙었다. 자동 갱신은 영업일 08:10 KST(러너 지연 최대 1시간).';
    } else {
      badgeEl.className = 'freshness stale';
      badgeEl.textContent = lag + '영업일 지연';
      badgeEl.title = '자동 갱신이 밀렸거나 실패했을 수 있다. 수동 갱신을 눌러보라. (공휴일이면 오탐일 수 있음)';
    }
  }

  // ---------- 토큰 패널 ----------
  function openPanel() {
    panel.hidden = false;
    var i = $('#tokenInput');
    i.value = token();
    i.focus();
    refreshLastRun();
  }
  function closePanel() { panel.hidden = true; }

  function refreshLastRun() {
    var el = $('#lastRun');
    el.textContent = '최근 실행 확인 중…';
    api('/actions/workflows/' + WORKFLOW + '/runs?per_page=1')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (j) {
        var run = j.workflow_runs && j.workflow_runs[0];
        if (!run) { el.textContent = '실행 기록 없음'; return; }
        var when = new Date(run.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        var res = run.status === 'completed' ? run.conclusion : run.status;
        el.innerHTML = '최근 실행 <b>' + when + '</b> · ' +
          '<a href="' + run.html_url + '" target="_blank" rel="noopener">' + res + '</a>';
      })
      .catch(function (s) { el.textContent = '실행 기록 조회 실패 (' + s + ')'; });
  }

  // ---------- 갱신 ----------
  function setStatus(msg, cls) {
    statusEl.hidden = !msg;
    statusEl.className = 'refresh-status' + (cls ? ' ' + cls : '');
    statusEl.innerHTML = msg || '';
  }
  function tick() {
    var s = Math.floor((Date.now() - startedAt) / 1000);
    btn.textContent = '갱신 중… ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function stop(msg, cls) {
    busy = false;
    clearInterval(timer); clearInterval(poll);
    btn.disabled = false;
    btn.textContent = '↻ 수동 갱신';
    setStatus(msg, cls);
  }

  function start() {
    if (busy) return;
    if (!token()) { openPanel(); return; }
    busy = true;
    btn.disabled = true;
    startedAt = Date.now();
    tick();
    timer = setInterval(tick, 1000);
    setStatus('워크플로 요청 중…');

    var prevId = 0;
    api('/actions/workflows/' + WORKFLOW + '/runs?per_page=1')
      .then(function (r) { return r.ok ? r.json() : { workflow_runs: [] }; })
      .then(function (j) {
        prevId = (j.workflow_runs && j.workflow_runs[0] && j.workflow_runs[0].id) || 0;
        return api('/actions/workflows/' + WORKFLOW + '/dispatches', {
          method: 'POST', body: { ref: 'main' }
        });
      })
      .then(function (r) {
        if (r.status === 204) { setStatus('러너 대기 중… (보통 2~4분)'); watch(prevId); return; }
        return r.text().then(function (t) {
          if (r.status === 401) throw new Error('토큰이 거부됐다(401). 만료됐거나 잘못된 토큰이다.');
          if (r.status === 403) throw new Error('권한 부족(403). PAT 에 Actions: Read and write 권한이 필요하다.');
          if (r.status === 404) throw new Error('워크플로를 못 찾았다(404). 저장소 접근 권한을 확인하라.');
          throw new Error('요청 실패(' + r.status + ') ' + t.slice(0, 120));
        });
      })
      .catch(function (e) {
        stop(e.message + ' · <a href="' + ACTIONS_URL + '" target="_blank" rel="noopener">Actions에서 직접 실행</a>', 'err');
      });
  }

  function watch(prevId) {
    var tries = 0;
    poll = setInterval(function () {
      if (++tries > 90) { stop('상태 확인 시간 초과. <a href="' + ACTIONS_URL + '" target="_blank" rel="noopener">Actions에서 확인</a>', 'err'); return; }
      api('/actions/workflows/' + WORKFLOW + '/runs?per_page=5')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (j) {
          var run = (j.workflow_runs || []).filter(function (x) { return x.id !== prevId; })[0];
          if (!run) return;
          if (run.status !== 'completed') {
            setStatus('실행 중 (' + run.status + ') · <a href="' + run.html_url + '" target="_blank" rel="noopener">로그</a>');
            return;
          }
          clearInterval(poll);
          if (run.conclusion === 'success') {
            setStatus('갱신 완료 · Pages 배포 반영 대기 중…');
            waitForData(run.html_url);
          } else {
            stop('실행 실패 (' + run.conclusion + ') · <a href="' + run.html_url + '" target="_blank" rel="noopener">로그 보기</a>', 'err');
          }
        })
        .catch(function () { /* 일시 오류는 다음 폴링에서 */ });
    }, 8000);
  }

  // 워크플로 성공 후 Pages 재배포까지 30초~2분. index.json 이 바뀌면 새로고침.
  function waitForData(runUrl) {
    var before = (window.FPB_META && window.FPB_META.end) || '';

    // 새 거래일이 없으면 워크플로는 '변경 없음'으로 끝난다 — index.json 은 영원히 안 바뀐다.
    // 이걸 폴링하면 2분 뒤 '배포가 늦어진다'는 경고가 떠서 고장난 것처럼 보인다(실제 오인 사례).
    if (before && lagBizDays(before) <= 0) {
      stop('이미 최신이다 — 기준일 ' + before + '(직전 영업일 종가)까지 반영돼 있어 갱신할 새 거래일이 없다. ' +
           '다음 갱신 ' + nextUpdateLabel() + ' · <a href="' + runUrl + '" target="_blank" rel="noopener">실행 로그</a>', 'ok');
      return;
    }

    var tries = 0;
    poll = setInterval(function () {
      if (++tries > 20) {
        stop('배포 반영이 늦어진다. 잠시 뒤 새로고침하라. · <a href="' + runUrl + '" target="_blank" rel="noopener">로그</a>', 'warn');
        return;
      }
      fetch('data/index.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.meta && j.meta.end !== before) {
            clearInterval(poll);
            setStatus('기준일 ' + j.meta.end + ' 반영됨. 새로고침…');
            setTimeout(function () { location.reload(); }, 800);
          }
        })
        .catch(function () {});
    }, 6000);
  }

  // ---------- 부트 ----------
  document.addEventListener('DOMContentLoaded', function () {
    btn = $('#refreshBtn');
    statusEl = $('#refreshStatus');
    panel = $('#tokenPanel');
    badgeEl = $('#freshness');
    if (!btn) return;

    btn.addEventListener('click', start);
    $('#tokenSetup').addEventListener('click', function (e) { e.preventDefault(); panel.hidden ? openPanel() : closePanel(); });
    $('#tokenSave').addEventListener('click', function () {
      var v = $('#tokenInput').value.trim();
      if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY);
      closePanel();
      setStatus(v ? '토큰 저장됨. 이제 수동 갱신을 누르면 바로 실행된다.' : '토큰 삭제됨.', 'ok');
    });
    $('#tokenClose').addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

    if (window.FPB_META) renderBadge(window.FPB_META);
    window.addEventListener('fpb:meta', function (e) { renderBadge(e.detail); });
  });
})();
