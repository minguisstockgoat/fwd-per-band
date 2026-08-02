/* 의존성 없는 SVG 라인차트 (십자선 + 툴팁 + 리사이즈 대응) */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var tipEl = null;

  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [], t = Math.ceil(min / step) * step;
    for (; t <= max + step * 1e-6; t += step) out.push(+t.toFixed(10));
    return out;
  }

  function fmtDate(d) { return d.slice(2, 4) + '/' + d.slice(4, 6); }

  function Chart(container, cfg) {
    this.box = container;
    this.cfg = cfg;
    this.draw();
    var self = this;
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.draw(); });
      this._ro.observe(container);
    }
  }

  Chart.prototype.draw = function () {
    var cfg = this.cfg, box = this.box;
    var W = box.clientWidth || 800, H = box.clientHeight || 320;
    if (W < 40 || H < 40) return;
    var m = { t: 12, r: cfg.padRight || 58, b: 24, l: 8 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var dates = cfg.dates, n = dates.length;

    var lo = Infinity, hi = -Infinity;
    cfg.series.forEach(function (s) {
      if (s.hidden) return;
      s.values.forEach(function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    (cfg.hlines || []).forEach(function (h) { if (h.value < lo) lo = h.value; if (h.value > hi) hi = h.value; });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
    lo -= pad; hi += pad;
    if (cfg.zeroFloor && lo < 0) lo = 0;

    var x = function (i) { return m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var y = function (v) { return m.t + ih - ((v - lo) / (hi - lo)) * ih; };

    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'cv' });

    // y grid
    niceTicks(lo, hi, 5).forEach(function (t) {
      var yy = y(t);
      if (yy < m.t - 1 || yy > m.t + ih + 1) return;
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: '#1c2434', 'stroke-width': 1 }));
      svg.appendChild(el('text', {
        x: m.l + iw + 6, y: yy + 3.5, fill: '#6b7890', 'font-size': 10, 'font-family': 'ui-monospace,monospace'
      }, cfg.fmtY ? cfg.fmtY(t) : t.toLocaleString()));
    });

    // x grid
    var step = Math.max(1, Math.round(n / 7));
    for (var i = 0; i < n; i += step) {
      svg.appendChild(el('line', { x1: x(i), x2: x(i), y1: m.t, y2: m.t + ih, stroke: '#161d2a', 'stroke-width': 1 }));
      svg.appendChild(el('text', {
        x: x(i), y: H - 8, fill: '#6b7890', 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace'
      }, fmtDate(dates[i])));
    }

    // 세로 음영 (드로다운 구간 등)
    (cfg.shades || []).forEach(function (s) {
      var x0 = x(s.from), x1 = x(s.to);
      svg.appendChild(el('rect', { x: Math.min(x0, x1), y: m.t, width: Math.max(1, Math.abs(x1 - x0)), height: ih, fill: s.color || '#ffffff08' }));
    });

    // 수평선 (평균 / ±1σ 등)
    (cfg.hlines || []).forEach(function (h) {
      var yy = y(h.value);
      svg.appendChild(el('line', {
        x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: h.color || '#39465e',
        'stroke-width': 1, 'stroke-dasharray': h.dash || '4 4'
      }));
      if (h.label) svg.appendChild(el('text', {
        x: m.l + 4, y: yy - 4, fill: h.color || '#6b7890', 'font-size': 10, 'font-family': 'ui-monospace,monospace'
      }, h.label));
    });

    // 라인
    cfg.series.forEach(function (s) {
      if (s.hidden) return;
      var d = '', pen = false;
      for (var i = 0; i < n; i++) {
        var v = s.values[i];
        if (v == null || !isFinite(v)) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      }
      if (!d) return;
      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.4,
        'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round', opacity: s.opacity || 1
      }));
      // 우측 끝 라벨
      if (s.endLabel) {
        for (var j = n - 1; j >= 0; j--) {
          if (s.values[j] != null && isFinite(s.values[j])) {
            svg.appendChild(el('text', {
              x: m.l + iw + 6, y: y(s.values[j]) + 3.5, fill: s.color, 'font-size': 9.5, 'font-family': 'ui-monospace,monospace'
            }, s.endLabel));
            break;
          }
        }
      }
    });

    // 십자선 + 히트영역
    var cross = el('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: '#8894ab', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(cross);
    var dots = el('g', { opacity: 0 });
    cfg.series.forEach(function (s) { if (!s.hidden) dots.appendChild(el('circle', { r: 3, fill: s.color, stroke: '#0b0e14', 'stroke-width': 1 })); });
    svg.appendChild(dots);

    var hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
    svg.appendChild(hit);
    box.innerHTML = '';
    box.appendChild(svg);

    if (!tipEl) tipEl = document.getElementById('tip');
    var visible = cfg.series.filter(function (s) { return !s.hidden; });

    function move(ev) {
      var r = svg.getBoundingClientRect();
      var px = ev.clientX - r.left;
      var i = Math.round(((px - m.l) / (iw || 1)) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
      dots.setAttribute('opacity', 1);
      Array.prototype.forEach.call(dots.childNodes, function (c, k) {
        var v = visible[k].values[i];
        if (v == null || !isFinite(v)) { c.setAttribute('opacity', 0); return; }
        c.setAttribute('opacity', 1); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v));
      });
      var html = '<b>' + dates[i].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') + '</b>';
      visible.forEach(function (s) {
        var v = s.values[i];
        html += '<br><i style="background:' + s.color + '"></i><span class="k">' + s.name + '</span> ' +
          (v == null || !isFinite(v) ? '-' : (cfg.fmtTip ? cfg.fmtTip(v, s) : v.toLocaleString()));
      });
      tipEl.innerHTML = html;
      tipEl.hidden = false;
      var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      var left = ev.clientX + 14, top = ev.clientY - th - 10;
      if (left + tw > innerWidth - 8) left = ev.clientX - tw - 14;
      if (top < 8) top = ev.clientY + 18;
      tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
    }
    function leave() { cross.setAttribute('opacity', 0); dots.setAttribute('opacity', 0); if (tipEl) tipEl.hidden = true; }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchmove', function (e) { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    hit.addEventListener('touchend', leave);
  };

  Chart.prototype.destroy = function () { if (this._ro) this._ro.disconnect(); this.box.innerHTML = ''; };

  global.Chart = { create: function (box, cfg) { return new Chart(box, cfg); } };
})(window);
