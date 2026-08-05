(function () {
  'use strict';

  var DATA = null, META = null;
  var state = { q: '', market: 'ALL', sort: 'cap', dir: 'desc' };
  var charts = [];

  // ---------- helpers ----------
  var $ = function (s) { return document.querySelector(s); };
  function num(v, d) { return v == null || !isFinite(v) ? '-' : v.toLocaleString('ko-KR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function cap(v) {
    if (!v) return '-';
    var jo = v / 1e12;
    if (jo >= 1) return jo.toFixed(jo >= 10 ? 0 : 1) + '조';
    return Math.round(v / 1e8).toLocaleString() + '억';
  }
  function sign(v, d, suffix) {
    if (v == null || !isFinite(v)) return '<span class="na">-</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + (suffix || '') + '</span>';
  }
  function ymd(s) { return s ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : '-'; }

  // ---------- 목록 ----------
  function filtered() {
    var q = state.q.trim().toLowerCase().replace(/\s/g, '');
    var rows = DATA.filter(function (r) {
      if (state.market !== 'ALL' && r.market !== state.market) return false;
      if (!q) return true;
      return r.name.toLowerCase().replace(/\s/g, '').indexOf(q) >= 0 || r.code.indexOf(q) >= 0;
    });
    var k = state.sort, dir = state.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      if (k === 'name') return a.name.localeCompare(b.name, 'ko') * dir;
      var x = a[k], y = b[k];
      var xn = x == null || !isFinite(x), yn = y == null || !isFinite(y);
      if (xn && yn) return (b.cap || 0) - (a.cap || 0);
      if (xn) return 1;               // 값 없는 종목은 항상 뒤로
      if (yn) return -1;
      if (x === y) return (b.cap || 0) - (a.cap || 0);
      return (x - y) * dir;
    });
    return rows;
  }

  function gauge(r) {
    if (r.status !== 'ok' || r.per == null) return '';
    var lo = r.per_p05, hi = r.per_p95, span = hi - lo || 1;
    var pos = Math.max(0, Math.min(1, (r.per - lo) / span)) * 100;
    var q1 = Math.max(0, Math.min(1, (r.per_q1 - lo) / span)) * 100;
    var q3 = Math.max(0, Math.min(1, (r.per_q3 - lo) / span)) * 100;
    return '<div class="gauge" title="5~95% 구간 ' + r.per_p05 + ' ~ ' + r.per_p95 +
      ' (전체 ' + r.per_min + ' ~ ' + r.per_max + ')">' +
      '<u style="left:' + q1 + '%;width:' + Math.max(1, q3 - q1) + '%"></u>' +
      '<i style="left:' + pos + '%"></i></div>';
  }

  var BADGE = { loss: '적자', no_consensus: '커버리지 없음' };

  function renderList() {
    var rows = filtered();
    var html = rows.map(function (r, i) {
      var note = r.status !== 'ok' ? '<span class="mk">' + BADGE[r.status] + '</span>' : '';
      return '<tr data-code="' + r.code + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="left"><span class="nm">' + r.name + '</span><span class="cd">' + r.code + '</span>' +
        '<span class="mk">' + (r.market === 'KOSPI' ? 'KP' : 'KQ') + '</span>' + note + '</td>' +
        '<td>' + cap(r.cap) + '</td>' +
        '<td>' + num(r.price) + '</td>' +
        '<td>' + sign(r.chg, 2, '%') + '</td>' +
        '<td>' + num(r.eps) + '</td>' +
        '<td><b>' + (r.per == null ? '<span class="na">-</span>' : r.per.toFixed(2)) + '</b></td>' +
        '<td class="band">' + gauge(r) + '</td>' +
        '<td>' + (r.per_pct == null ? '<span class="na">-</span>' : r.per_pct.toFixed(0) + '%') + '</td>' +
        '<td>' + sign(r.mdd, 1, '%') + '</td>' +
        '<td>' + sign(r.cur_dd, 1, '%') + '</td>' +
        '<td>' + sign(r.per_chg_1m, 1, '%') + '</td>' +
        '</tr>';
    }).join('');
    $('#tbody').innerHTML = html || '<tr><td colspan="12" style="text-align:center;padding:30px;color:#5d6980">검색 결과 없음</td></tr>';
    $('#count').textContent = rows.length + ' / ' + DATA.length + ' 종목';

    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.sort === state.sort);
      th.classList.toggle('asc', th.dataset.sort === state.sort && state.dir === 'asc');
    });
    document.querySelectorAll('#quickSort .chip').forEach(function (c) {
      c.classList.toggle('on', c.dataset.sort === state.sort && c.dataset.dir === state.dir);
    });
  }

  // ---------- 상세 ----------
  var BAND_COLORS = ['#3d8bfd', '#4ecdc4', '#f5b301', '#ff9f43', '#ff5555'];

  function clearCharts() { charts.forEach(function (c) { c.destroy(); }); charts = []; }

  function renderDetail(d) {
    $('#dTitle').innerHTML = d.name + ' <small>' + d.code + ' · ' + d.market + '</small>';

    var last = function (a) { for (var i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    var price = last(d.price), eps = last(d.eps), per = last(d.per);
    var stats = [
      ['종가', num(price) + '원'],
      ['EPS(Fwd.12M)', num(eps) + '원'],
      ['Fwd PER', per == null ? '-' : per.toFixed(2) + 'x'],
      ['1년 밴드 5~95%', d.per_p05 == null ? '-' : d.per_p05.toFixed(1) + ' ~ ' + d.per_p95.toFixed(1)],
      ['밴드 위치', d.per_pct == null ? '-' : d.per_pct.toFixed(0) + '%'],
      ['최근 MDD', d.mdd == null ? '-' : d.mdd.toFixed(1) + '%'],
      ['현재 낙폭', d.cur_dd == null ? '-' : d.cur_dd.toFixed(1) + '%']
    ];
    $('#dStats').innerHTML = stats.map(function (s) {
      var cls = /MDD|낙폭/.test(s[0]) && s[1] !== '-' ? (parseFloat(s[1]) < 0 ? 'down' : 'up') : '';
      return '<div><span>' + s[0] + '</span><b class="' + cls + '">' + s[1] + '</b></div>';
    }).join('');

    clearCharts();

    if (d.status !== 'ok') {
      $('#bandChart').innerHTML = '<div style="padding:40px;color:#5d6980">' +
        (d.status === 'loss' ? '선행 12개월 EPS가 적자 구간이라 PER 밴드를 산출할 수 없습니다.' : '애널리스트 컨센서스가 없어 PER 밴드를 산출할 수 없습니다.') + '</div>';
      $('#bandLegend').innerHTML = '';
      charts.push(window.Chart.create($('#perChart'), {
        dates: d.dates, series: [{ name: '주가', values: d.price, color: '#e8edf7', width: 1.8 }],
        fmtY: function (v) { return v.toLocaleString(); }, fmtTip: function (v) { return v.toLocaleString() + '원'; }
      }));
      charts.push(window.Chart.create($('#epsChart'), {
        dates: d.dates, series: [{ name: 'EPS(Fwd.12M)', values: d.eps, color: '#4ecdc4', width: 1.8 }],
        fmtY: function (v) { return v.toLocaleString(); }, fmtTip: function (v) { return v.toLocaleString() + '원'; }
      }));
      return;
    }

    // --- PER 밴드 차트 ---
    var mults = [d.per_p05, d.per_q1, d.per_med, d.per_q3, d.per_p95];
    var bandSeries = mults.map(function (mv, i) {
      return {
        name: mv.toFixed(1) + 'x',
        values: d.eps.map(function (e) { return e && e > 0 ? e * mv : null; }),
        color: BAND_COLORS[i], width: 1, dash: '5 4', opacity: .85, endLabel: mv.toFixed(1) + 'x'
      };
    });
    // 밴드 배수가 극단적인 종목에서도 주가가 보이도록 y축은 주가 범위 기준으로 고정
    var pv = d.price.filter(function (v) { return v != null; });
    var pmin = Math.min.apply(null, pv), pmax = Math.max.apply(null, pv);
    charts.push(window.Chart.create($('#bandChart'), {
      dates: d.dates,
      series: bandSeries.concat([{ name: '주가', values: d.price, color: '#ffffff', width: 2 }]),
      yMin: Math.max(0, pmin * 0.45),
      yMax: pmax * 1.9,
      fmtY: function (v) { return v >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v).toLocaleString(); },
      fmtTip: function (v) { return Math.round(v).toLocaleString() + '원'; },
      zeroFloor: true
    }));
    $('#bandLegend').innerHTML = ['5%', '25%', '중앙', '75%', '95%'].map(function (lb, i) {
      return '<span><i style="background:' + BAND_COLORS[i] + '"></i>' + lb + ' ' + mults[i].toFixed(1) + 'x</span>';
    }).join('') + '<span><i style="background:#fff"></i>주가</span>';

    // --- PER 추이 ---
    var shades = [];
    if (d.mdd_peak_date && d.mdd_trough_date) {
      var a = d.dates.indexOf(d.mdd_peak_date), b = d.dates.indexOf(d.mdd_trough_date);
      if (a >= 0 && b > a) shades.push({ from: a, to: b, color: 'rgba(61,139,253,.10)' });
    }
    charts.push(window.Chart.create($('#perChart'), {
      dates: d.dates,
      series: [{ name: 'Fwd PER', values: d.per, color: '#f5b301', width: 1.8 }],
      hlines: [
        { value: d.per_avg, color: '#8894ab', label: '평균 ' + d.per_avg.toFixed(1) },
        { value: +(d.per_avg + d.per_sd).toFixed(3), color: '#3f4d66', label: '+1σ' },
        { value: +(d.per_avg - d.per_sd).toFixed(3), color: '#3f4d66', label: '-1σ' }
      ],
      shades: shades,
      fmtY: function (v) { return v.toFixed(v < 10 ? 1 : 0); },
      fmtTip: function (v) { return v.toFixed(2) + 'x'; }
    }));

    // --- EPS 추이 ---
    charts.push(window.Chart.create($('#epsChart'), {
      dates: d.dates,
      series: [{ name: 'EPS(Fwd.12M)', values: d.eps, color: '#4ecdc4', width: 1.8 }],
      fmtY: function (v) { return v >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v).toLocaleString(); },
      fmtTip: function (v) { return Math.round(v).toLocaleString() + '원'; }
    }));
  }

  var cache = {};
  function openDetail(code) {
    $('#listView').hidden = true;
    $('#detailView').hidden = false;
    window.scrollTo(0, 0);
    if (cache[code]) return renderDetail(cache[code]);
    $('#dTitle').textContent = '불러오는 중…';
    fetch('data/stocks/' + code + '.json?v=' + (META ? META.updated : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) { cache[code] = d; renderDetail(d); })
      .catch(function () { $('#dTitle').textContent = '데이터를 불러오지 못했습니다.'; });
  }

  function route() {
    var code = location.hash.replace(/^#\/?/, '');
    if (/^\d{6}$/.test(code)) openDetail(code);
    else {
      clearCharts();
      $('#detailView').hidden = true;
      $('#listView').hidden = false;
    }
  }

  // ---------- init ----------
  fetch('data/index.json?t=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (j) {
      DATA = j.stocks; META = j.meta;
      window.FPB_META = META;                       // refresh.js(지연 배지)가 읽는다
      window.dispatchEvent(new CustomEvent('fpb:meta', { detail: META }));
      $('#meta').innerHTML = '기준일 <b>' + ymd(META.end) + '</b> · 대상 <b>' + META.count + '</b>종목<br>' +
        '밴드구간 ' + ymd(META.start) + ' ~ ' + ymd(META.end) + ' (' + META.days + '거래일)';
      renderList();
      route();
    })
    .catch(function (e) {
      $('#tbody').innerHTML = '<tr><td colspan="12" style="padding:30px;text-align:center;color:#ff5555">데이터 로드 실패: ' + e + '</td></tr>';
    });

  $('#q').addEventListener('input', function (e) { state.q = e.target.value; renderList(); });
  $('#marketChips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    state.market = b.dataset.market;
    document.querySelectorAll('#marketChips .chip').forEach(function (c) { c.classList.toggle('on', c === b); });
    renderList();
  });
  $('#quickSort').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    state.sort = b.dataset.sort; state.dir = b.dataset.dir; renderList();
  });
  document.querySelector('thead').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]'); if (!th) return;
    var k = th.dataset.sort;
    if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort = k; state.dir = (k === 'name' || k === 'per' || k === 'per_pct') ? 'asc' : 'desc'; }
    renderList();
  });
  $('#tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-code]'); if (!tr) return;
    location.hash = tr.dataset.code;
  });
  $('#back').addEventListener('click', function () { location.hash = ''; });
  window.addEventListener('hashchange', route);
})();
