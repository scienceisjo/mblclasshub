// =====================================================================
//  dashkit.js — MBL 수업허브 "대시보드 엔진"  (전역 window.DashKit)
//
//  ▣ 무엇인가
//    블록을 고르면 그 자리에서 우리 반 진짜 데이터로 대시보드가 완성됩니다.
//    프롬프트를 복사해 AI 에게 부탁하고 · 코드를 받아 · 메모장에 붙여 넣고 ·
//    확장자를 바꾸고 · 어딘가에 올리는 다섯 단계가 없습니다.
//    우리는 이미 진짜 데이터(mbl_data·mbl_reports)와 그래프 엔진을 갖고 있기 때문입니다.
//
//  ▣ 분명히 해 둘 것 — 이것은 "분석 대시보드" 입니다
//    센서 보드에서 값이 실시간으로 흘러드는 "계측 화면" 이 아닙니다.
//    이 앱에는 보드 직결 기능이 없습니다. 그래서 여기에는 "실시간 센서 연결" 같은
//    말이 한 군데도 없고, 모은 자료로 만들 수 있는 블록만 둡니다.
//
//  ▣ 쓰는 법
//    <script src="hub.js"></script>
//    <script src="lab-data.js"></script>
//    <script src="diagrams.js"></script><script src="graphs.js"></script>
//    <script src="dashkit.js"></script>
//
//    const ctx = { board, exp, group, role:'student', mode:'live' };
//    DashKit.mount(el, ctx, { layout, onSave(l){...}, onAI(l, ctx){...} });
//
//  ▣ 내보내는 것
//    DashKit.BLOCKS                     블록 정의 목록 [{key,name,group,need,w,desc}]
//    DashKit.canUse(key, ctx)           → {ok, why}   (지금 자료로 그릴 수 있는가)
//    DashKit.presets(ctx)               → [{key,name,desc,layout}]
//    DashKit.renderBlock(key, ctx, opt) → HTML 문자열
//    DashKit.render(layout, ctx)        → 대시보드 전체 HTML 문자열
//    DashKit.standalone(layout, ctx)    → 혼자 열리는 HTML 파일 전문
//    DashKit.mount(el, ctx, opt)        → 빌더 UI (고르기·순서·너비·미리보기·저장)
//    DashKit.fileName(ctx, layout)      → 대시보드_2학년3반_3모둠_….html
//    DashKit.readLayout(text)           → 내보낸 파일에서 layout 다시 읽기
//    DashKit.describe(layout, ctx)      → AI 협업 프롬프트에 붙일 구성 요약
//    DashKit.THEMES · DashKit.TF · DashKit.emptyLayout()
//
//  ▣ 설계 원칙
//    · 문자열을 만드는 순수 함수(render·standalone)와 빌더 UI(mount)를 나눠 두었습니다.
//      그래서 standalone 은 브라우저 없이 node 에서도 검증됩니다.
//    · 계산은 hub.js 에 맡깁니다 — Hub.stats · Hub.cellAt · Hub.num · Hub.predictGap ·
//      Hub.gradeQuiz · Hub.alignAnswers. (hub.js 가 아직 안 실려도 깨지지 않게 간이판을 둡니다.)
//    · 그래프는 index.html 이 window.chartSVG 로 내보내면 그것을 쓰고, 없으면
//      여기 폴백으로 그립니다. 두 길의 결과가 같도록 눈금·색·범례 규칙을 맞췄습니다.
//    · 내보낸 파일에는 실행 스크립트가 없습니다(정적 HTML + 인라인 SVG). 색은 실제 hex 로 박습니다.
//    · 외부 자원 0 · CDN 0 · 실시간 구독 0 · schema.sql 변경 0.
// =====================================================================

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashKit = api;
})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  //  0. 아주 작은 도구들
  // ─────────────────────────────────────────────────────────────────
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; });
  }
  function W() { return (typeof window !== 'undefined') ? window : null; }
  function HUB() { var w = W(); return (w && w.Hub) ? w.Hub : null; }
  function LABDB() { var w = W(); return (w && w.LAB) ? w.LAB : null; }

  //  숫자 읽기 — Hub.num 이 있으면 그것으로(1,234 · 1,5 같은 표기까지 읽습니다)
  function num(v) {
    var h = HUB();
    if (h && typeof h.num === 'function') return h.num(v);
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  //  표 한 칸 — Hub.cellAt 과 같은 규칙(배열 행도 {x,s0} 행도 읽습니다)
  function cellAt(row, col) {
    var h = HUB();
    if (h && typeof h.cellAt === 'function') return h.cellAt(row, col);
    if (row === null || row === undefined) return NaN;
    if (Array.isArray(row)) return num(row[col]);
    if (typeof row === 'object') {
      if (col === 0) return num(row.x);
      return num(row['s' + (col - 1)]);
    }
    return (col === 0) ? NaN : num(row);
  }
  //  최소제곱·요약 — Hub.stats 한 곳에서만 셉니다
  function stats(rows, si) {
    var h = HUB();
    if (h && typeof h.stats === 'function') return h.stats(rows, si);
    // hub.js 가 아직 안 실렸을 때만 쓰는 간이판 (수식은 Hub.stats 와 같습니다)
    var k = Math.max(0, Number(si) || 0), list = Array.isArray(rows) ? rows : [];
    var xs = [], ys = [], i;
    for (i = 0; i < list.length; i++) {
      var y = cellAt(list[i], k + 1);
      if (!isFinite(y)) continue;
      var x = cellAt(list[i], 0);
      xs.push(isFinite(x) ? x : xs.length); ys.push(y);
    }
    var o = { n: ys.length, first: null, last: null, delta: null, mean: null, min: null, max: null,
              slope: null, intercept: null, r2: null, xFirst: null, xLast: null };
    if (!ys.length) return o;
    var sum = 0, mn = ys[0], mx = ys[0];
    for (i = 0; i < ys.length; i++) { sum += ys[i]; if (ys[i] < mn) mn = ys[i]; if (ys[i] > mx) mx = ys[i]; }
    o.first = ys[0]; o.last = ys[ys.length - 1]; o.delta = o.last - o.first;
    o.mean = sum / ys.length; o.min = mn; o.max = mx; o.xFirst = xs[0]; o.xLast = xs[xs.length - 1];
    if (ys.length < 2) return o;
    var n = ys.length, sx = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += xs[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var den = n * sxx - sx * sx;
    if (den === 0) return o;
    var a = (n * sxy - sx * sum) / den, b = (sum - a * sx) / n;
    o.slope = a; o.intercept = b;
    var st = 0, sr = 0;
    for (i = 0; i < n; i++) { var e = ys[i] - (a * xs[i] + b); sr += e * e; st += (ys[i] - o.mean) * (ys[i] - o.mean); }
    o.r2 = (st === 0) ? null : (1 - sr / st);
    return o;
  }
  function predictGap(rows, pre, si) {
    var h = HUB();
    if (h && typeof h.predictGap === 'function') return h.predictGap(rows, pre, si);
    return { n: 0, maxDiff: null, atX: null, predicted: null, actual: null, meanDiff: null };
  }
  function alignAnswers(ans, qs, used) {
    var h = HUB();
    if (h && typeof h.alignAnswers === 'function') return h.alignAnswers(ans, qs, used);
    var out = [];
    for (var i = 0; i < (qs || []).length; i++) {
      if (used) used['q' + (i + 1)] = true;
      out.push(ans ? ans['q' + (i + 1)] : undefined);
    }
    return out;
  }
  function gradeQuiz(quiz, answers) {
    var h = HUB();
    if (h && typeof h.gradeQuiz === 'function') return h.gradeQuiz(quiz, answers);
    return { score: 0, max_score: 0, results: [] };
  }

  //  숫자를 짧게 — index.html 의 fmtNum 과 같은 규칙
  function fmtNum(v, dp) {
    var n = Number(v);
    if (v === null || v === undefined || !isFinite(n)) return '';
    if (dp !== undefined && dp !== null) return String(Number(n.toFixed(dp)));
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    var a = Math.abs(n);
    return String(Number(n.toFixed(a < 1 ? 4 : (a < 100 ? 2 : 1))));
  }
  //  아주 작거나 큰 값도 읽히게 — 0.00012 → 1.2×10⁻⁴ (데이터 실험실의 labNum 과 같은 규칙)
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sciNum(v) {
    var n = Number(v);
    if (v === null || v === undefined || !isFinite(n)) return '—';
    if (n === 0) return '0';
    var a = Math.abs(n);
    if (a < 1e-3 || a >= 1e6) {
      var s = n.toExponential(2).split('e');
      var ex = String(Number(s[1])).split('').map(function (c) { return SUP[c] || c; }).join('');
      return String(Number(s[0])) + '×10' + ex;
    }
    return String(Number(n.toPrecision(4)));
  }
  function fmtR2(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (Math.abs(v) >= 0.995) ? Number(v).toFixed(3) : Number(v).toFixed(2);
  }
  //  기울기 단위 = 세로축 단위 ÷ 가로축 단위 (1/cm² 처럼 뒤집힌 단위는 곱으로 적습니다)
  function slopeUnit(yu, xu) {
    var inv = false;
    if (xu && xu.indexOf('1/') === 0) { xu = xu.slice(2); inv = true; }
    if (yu && xu) return inv ? (yu + '·' + xu) : (yu + '/' + xu);
    if (yu) return yu;
    if (xu) return inv ? xu : ('1/' + xu);
    return '';
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function today8(d) {
    d = d || new Date();
    return String(d.getFullYear()) + p2(d.getMonth() + 1) + p2(d.getDate());
  }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' +
           p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  // ─────────────────────────────────────────────────────────────────
  //  1. 색 · 테마 — 내보낸 파일에서도 풀리도록 실제 hex 를 박습니다
  // ─────────────────────────────────────────────────────────────────
  var SERIES_HEX = ['#20B2A6', '#FF8C6B', '#54B4E8', '#FFC130', '#8B7FD4', '#4FB477', '#E88FB5'];
  var GROUP_HEX  = ['#20B2A6', '#54B4E8', '#FFC130', '#FF8C6B', '#8B7FD4', '#4FB477', '#E88FB5',
                    '#14867C', '#3E7FA8', '#C98A22'];
  var ACC = { mint: '#20B2A6', mintD: '#14867C', sun: '#FFC130', coral: '#FF8C6B', sky: '#54B4E8',
              g5: '#8B7FD4', g6: '#4FB477', g7: '#E88FB5', ok: '#37B58C', warn: '#E8873C', bad: '#E05A5A' };

  var THEMES = {
    light: { key: 'light', name: '밝게',
             bg: '#F4FBF6', paper: '#FFFFFF', cream: '#FFFDF6', ink: '#254753', muted: '#6E8A96',
             line: '#E4EFF1', line2: '#D3E6EA', head: '#14867C', soft: '#F3FAFB', base: '15px',
             shadow: '0 8px 22px rgba(37,71,83,.07)' },
    dark:  { key: 'dark', name: '진하게',
             bg: '#10262E', paper: '#183742', cream: '#1C3F4B', ink: '#EAF6F8', muted: '#9EC2CC',
             line: '#27505E', line2: '#35636F', head: '#7FE3D8', soft: '#14313B', base: '15px',
             shadow: '0 8px 22px rgba(0,0,0,.35)' },
    big:   { key: 'big', name: '아주 크게(전자칠판)',
             bg: '#F4FBF6', paper: '#FFFFFF', cream: '#FFFDF6', ink: '#1C3B47', muted: '#5A7C88',
             line: '#DCEDF0', line2: '#C6DFE5', head: '#0F7268', soft: '#F0F9FA', base: '22px',
             shadow: '0 10px 26px rgba(37,71,83,.10)' }
  };
  function theme(k) { return THEMES[k] || THEMES.light; }

  //  대시보드 뿌리에 CSS 변수를 실어 둡니다.
  //  · diagrams.js · graphs.js 의 SVG 가 var(--ink) 같은 이름을 쓰기 때문입니다.
  //  · 내보낸 파일에서도 그대로 풀립니다(남의 브라우저에는 우리 :root 가 없으니까요).
  function themeVars(T) {
    return '--ink:' + T.ink + ';--muted:' + T.muted + ';--paper:' + T.paper + ';--cream:' + T.cream +
           ';--line:' + T.line + ';--line-2:' + T.line2 + ';--mint:' + ACC.mint + ';--mint-d:' + ACC.mintD +
           ';--sun:' + ACC.sun + ';--coral:' + ACC.coral + ';--sky:' + ACC.sky +
           ';--g1:' + ACC.mint + ';--g2:' + ACC.sky + ';--g3:' + ACC.sun + ';--g4:' + ACC.coral +
           ';--g5:' + ACC.g5 + ';--g6:' + ACC.g6 + ';--g7:' + ACC.g7 +
           ';--ok:' + ACC.ok + ';--warn:' + ACC.warn + ';--bad:' + ACC.bad + ';';
  }

  //  대시보드 전용 CSS — 앱 안에서도, 내보낸 파일에서도 똑같이 씁니다.
  //  모든 규칙에 .dk-root 를 붙여 바깥 화면을 건드리지 않습니다.
  function css(themeKey) {
    var T = theme(themeKey);
    var R = '.dk-root';
    return [
      R + '{' + themeVars(T) + 'font-size:' + T.base + ';color:' + T.ink + ';background:' + T.bg + ';' +
        'font-family:-apple-system,system-ui,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;line-height:1.6;' +
        'box-sizing:border-box;padding:1em;border-radius:1em}',
      R + ' *{box-sizing:border-box}',
      R + ' .dk-head{margin:0 0 .9em;padding:0 .2em}',
      R + ' .dk-head h1{font-size:1.6em;margin:0 0 .15em;line-height:1.25;color:' + T.ink + '}',
      R + ' .dk-head .dk-meta{font-size:.82em;color:' + T.muted + ';line-height:1.7}',
      R + ' .dk-head .dk-meta b{color:' + T.ink + '}',
      R + ' .dk-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:.9em;align-items:start}',
      R + ' .dk-b{grid-column:span 12;background:' + T.paper + ';border:1px solid ' + T.line + ';' +
        'border-radius:1em;padding:.9em 1em;box-shadow:' + T.shadow + ';min-width:0;overflow:hidden}',
      R + ' .dk-b[data-w="4"]{grid-column:span 4}',
      R + ' .dk-b[data-w="6"]{grid-column:span 6}',
      R + ' .dk-b[data-w="12"]{grid-column:span 12}',
      R + ' .dk-b.dk-plain{background:none;border:0;box-shadow:none;padding:.2em .3em}',
      R + ' .dk-h{font-size:1em;font-weight:800;margin:0 0 .5em;color:' + T.head + ';letter-spacing:-.01em}',
      R + ' .dk-sub{font-size:.8em;color:' + T.muted + ';margin:.4em 0 0;line-height:1.6}',
      R + ' .dk-empty{font-size:.85em;color:' + T.muted + ';background:' + T.soft + ';border:1px dashed ' + T.line2 + ';' +
        'border-radius:.7em;padding:.8em .9em;text-align:center}',
      // 값 카드
      R + ' .dk-vals{display:flex;flex-wrap:wrap;gap:.7em}',
      R + ' .dk-v{flex:1 1 8em;min-width:7em;background:' + T.soft + ';border:1px solid ' + T.line + ';' +
        'border-radius:.8em;padding:.7em .8em}',
      R + ' .dk-v b{display:block;font-size:.78em;color:' + T.muted + ';font-weight:700;margin-bottom:.15em}',
      R + ' .dk-v em{font-style:normal;font-size:1.9em;font-weight:800;line-height:1.1;letter-spacing:-.02em}',
      R + ' .dk-v span{font-size:.8em;color:' + T.muted + ';margin-left:.25em;font-weight:700}',
      // 표
      R + ' .dk-tw{overflow-x:auto}',
      R + ' table.dk-t{border-collapse:collapse;width:100%;font-size:.82em;min-width:16em}',
      R + ' table.dk-t th,' + R + ' table.dk-t td{border:1px solid ' + T.line2 + ';padding:.35em .5em;text-align:center;white-space:nowrap}',
      R + ' table.dk-t th{background:' + T.soft + ';font-weight:700;color:' + T.ink + '}',
      R + ' table.dk-t td.dk-l{text-align:left;white-space:normal}',
      // 그래프
      R + ' .dk-chart{border:1px solid ' + T.line + ';border-radius:.7em;padding:.4em;overflow-x:auto;background:' + T.paper + '}',
      R + ' .dk-chart svg{display:block;width:100%;height:auto;max-width:44em;margin:0 auto}',
      R + ' .dk-lg{display:flex;flex-wrap:wrap;gap:.7em;margin-top:.4em;font-size:.78em;color:' + T.muted + '}',
      R + ' .dk-lg span{display:inline-flex;align-items:center;gap:.3em}',
      R + ' .dk-lg i{width:.7em;height:.7em;border-radius:.2em;display:inline-block}',
      // 그림(연결도·예시그래프)
      R + ' .dk-fig{border:1px solid ' + T.line + ';border-radius:.7em;padding:.5em;background:' + T.paper + '}',
      R + ' .dk-fig svg{display:block;width:100%;height:auto;max-width:34em;margin:0 auto}',
      // 목록 · 절차
      R + ' .dk-ul{margin:0;padding-left:1.1em;font-size:.88em}',
      R + ' .dk-ul li{margin:.25em 0}',
      R + ' .dk-steps{display:grid;gap:.5em}',
      R + ' .dk-step{display:flex;gap:.6em;background:' + T.soft + ';border:1px solid ' + T.line + ';' +
        'border-radius:.7em;padding:.55em .7em;font-size:.85em;line-height:1.6}',
      R + ' .dk-step i{flex:0 0 1.5em;height:1.5em;border-radius:50%;background:' + ACC.mint + ';color:#fff;' +
        'font-style:normal;font-weight:800;font-size:.8em;display:flex;align-items:center;justify-content:center}',
      // 문답
      R + ' .dk-q{border:1px solid ' + T.line2 + ';border-radius:.7em;padding:.6em .75em;margin:.45em 0;background:' + T.cream + '}',
      R + ' .dk-q b{display:block;font-size:.85em;margin-bottom:.25em;color:' + T.head + '}',
      R + ' .dk-q .dk-a{white-space:pre-wrap;font-size:.88em;line-height:1.7}',
      R + ' .dk-q .dk-a.dk-no{color:' + ACC.bad + ';font-weight:700}',
      // 막대(진행·정답률·순위)
      R + ' .dk-bars{display:grid;gap:.45em}',
      R + ' .dk-bar{display:grid;grid-template-columns:minmax(4.5em,8em) 1fr auto;gap:.6em;align-items:center;font-size:.82em}',
      R + ' .dk-bar .dk-nm{font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      R + ' .dk-bar .dk-tr{height:.75em;border-radius:999px;background:' + T.soft + ';border:1px solid ' + T.line + ';overflow:hidden}',
      R + ' .dk-bar .dk-tr i{display:block;height:100%;border-radius:999px;background:' + ACC.mint + '}',
      R + ' .dk-bar .dk-sc{color:' + T.muted + ';font-weight:700;white-space:nowrap}',
      R + ' .dk-bar.dk-me .dk-nm{color:' + ACC.mintD + '}',
      // 진행 현황 타일
      R + ' .dk-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5em,1fr));gap:.6em}',
      R + ' .dk-tile{border:1px solid ' + T.line + ';border-radius:.8em;padding:.6em .7em;background:' + T.soft + ';font-size:.8em}',
      R + ' .dk-tile b{display:block;font-size:1.05em;margin-bottom:.25em}',
      R + ' .dk-tile .dk-dots{display:flex;gap:.25em;margin-top:.35em;flex-wrap:wrap}',
      R + ' .dk-tile .dk-dots u{text-decoration:none;font-size:.85em;padding:.1em .4em;border-radius:.4em;' +
        'background:' + T.paper + ';border:1px solid ' + T.line2 + ';color:' + T.muted + '}',
      R + ' .dk-tile .dk-dots u.on{background:' + ACC.ok + ';border-color:' + ACC.ok + ';color:#fff;font-weight:700}',
      // 태그 · 뱃지
      R + ' .dk-tags{display:flex;flex-wrap:wrap;gap:.35em;margin:.3em 0}',
      R + ' .dk-tag{font-size:.75em;font-weight:700;padding:.15em .55em;border-radius:999px;' +
        'background:' + T.soft + ';border:1px solid ' + T.line2 + ';color:' + T.head + '}',
      R + ' .dk-o{color:' + ACC.ok + ';font-weight:800}',
      R + ' .dk-x{color:' + ACC.bad + ';font-weight:800}',
      R + ' .dk-star{color:' + ACC.sun + ';letter-spacing:.05em}',
      R + ' .dk-note{white-space:pre-wrap;font-size:.9em;line-height:1.75;border-left:.25em solid ' + ACC.sun + ';' +
        'background:' + T.cream + ';border-radius:0 .6em .6em 0;padding:.6em .8em}',
      R + ' .dk-title{font-size:1.9em;font-weight:800;line-height:1.25;letter-spacing:-.02em;margin:.2em 0}',
      R + ' hr.dk-hr{border:0;border-top:2px dashed ' + T.line2 + ';margin:.4em 0}',
      R + ' .dk-foot{margin-top:1.4em;padding-top:.8em;border-top:1px solid ' + T.line + ';' +
        'text-align:center;font-size:.72em;color:' + T.muted + ';line-height:1.7}',
      // 좁은 화면 — 칸을 접습니다
      '@media (max-width:820px){' + R + ' .dk-b[data-w="4"],' + R + ' .dk-b[data-w="6"]{grid-column:span 12}}',
      // 인쇄 — 그대로 누르면 PDF 가 됩니다
      '@media print{' + R + '{background:#fff;padding:0;font-size:12.5px}' +
        R + ' .dk-b{box-shadow:none;break-inside:avoid;page-break-inside:avoid}' +
        R + ' .dk-chart,' + R + ' .dk-fig{break-inside:avoid;page-break-inside:avoid}' +
        R + ' .dk-b[data-w="4"]{grid-column:span 6}}'
    ].join('\n');
  }

  // ─────────────────────────────────────────────────────────────────
  //  2. 축 변환 (데이터 실험실의 LAB_TF 와 같은 7종)
  // ─────────────────────────────────────────────────────────────────
  var TF = {
    none: { name: '그대로 두기',         lab: function (l) { return l; },              unit: function (u) { return u; },                        ok: function () { return true; },     f: function (v) { return v; } },
    inv : { name: '1/값 으로 바꾸기',    lab: function (l) { return '1/' + l; },       unit: function (u) { return u ? '1/' + u : ''; },        ok: function (v) { return v !== 0; }, f: function (v) { return 1 / v; } },
    sq  : { name: '제곱하기 (값²)',       lab: function (l) { return l + '²'; },        unit: function (u) { return u ? u + '²' : ''; },         ok: function () { return true; },     f: function (v) { return v * v; } },
    sqrt: { name: '제곱근 (√값)',         lab: function (l) { return '√' + l; },        unit: function (u) { return u ? '√' + u : ''; },         ok: function (v) { return v >= 0; },  f: function (v) { return Math.sqrt(v); } },
    log : { name: '로그로 보기 (log 값)', lab: function (l) { return 'log ' + l; },     unit: function () { return ''; },                        ok: function (v) { return v > 0; },   f: function (v) { return Math.log(v) / Math.LN10; } },
    inv2: { name: '1/값² 으로 바꾸기',    lab: function (l) { return '1/' + l + '²'; }, unit: function (u) { return u ? '1/' + u + '²' : ''; },  ok: function (v) { return v !== 0; }, f: function (v) { return 1 / (v * v); } },
    sub : { name: '값 − 최솟값',          lab: function (l) { return l + ' − 최솟값'; }, unit: function (u) { return u; },                       ok: function () { return true; },     f: function (v, m) { return v - m; }, needMin: true }
  };

  // ─────────────────────────────────────────────────────────────────
  //  3. ctx 다듬기 — 실시간·간편·합치기 결과가 모두 같은 모양이 되게
  // ─────────────────────────────────────────────────────────────────
  var FIG_DIAGRAM = {
    'sm-08': 'ohm',   'ez-22': 'ohm',
    'sm-05': 'boyle', 'ez-25': 'boyle', 'ez-26': 'boyle',
    'sm-06': 'photo', 'sm-07': 'photo',
    'sm-09': 'lux',   'sm-01': 'heat',
    'ez-16': 'layer', 'sm-10': 'cloud'
  };
  var FIG_GRAPH = {
    'sm-02': 'freeze', 'ez-06': 'freeze',
    'sm-06': 'photoV', 'sm-07': 'photoV',
    'ez-12': 'radeq',  'sm-09': 'inv2'
  };
  var GRAPH_CAP = {
    freeze: '이런 모양이 나오면 잘 된 것입니다 — 얼기 시작하면 온도가 0 ℃ 부근에서 한동안 평평하게 멈춰 있습니다.',
    photoV: '이런 모양이 나오면 잘 된 것입니다 — 빛을 비추는 동안 이산화 탄소가 줄고, 빛을 가리면 다시 늘어 V자가 됩니다.',
    radeq : '이런 모양이 나오면 잘 된 것입니다 — 처음에는 빠르게 오르다가 어느 온도부터 더 오르지 않고 평평해집니다.',
    inv2  : '이런 모양이 나오면 잘 된 것입니다 — 거리가 멀수록 가파르게 떨어지고, 가로축을 1/거리²로 바꾸면 직선이 됩니다.'
  };
  function figSVG(bag, key) {
    var w = W();
    if (!w || !key) return '';
    var d = (bag === 'D') ? w.DIAGRAMS : w.GRAPHS;
    return (d && typeof d[key] === 'string') ? d[key] : '';
  }

  var DEF_SPEC = { x: { label: '회차', unit: '' }, series: [{ label: '측정값', unit: '' }], chart: 'line' };

  function expOf(lesson, given) {
    if (given && typeof given === 'object') return given;
    var L = LABDB();
    try {
      if (L && typeof L.byId === 'function' && lesson && lesson.exp_id) return L.byId(lesson.exp_id) || null;
    } catch (e) {}
    return null;
  }
  function specOf(lesson, exp) {
    var ds = lesson && lesson.data_spec;
    if (ds && Array.isArray(ds.series) && ds.series.length) return ds;
    if (exp && exp.dataSpec && Array.isArray(exp.dataSpec.series) && exp.dataSpec.series.length) return exp.dataSpec;
    return DEF_SPEC;
  }
  //  줄을 언제나 [[x, s1, s2 …]] 배열 꼴로 — chartSVG 도 이 꼴을 받습니다.
  function toRows(rows, nSeries) {
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var a = [cellAt(r, 0)], got = false, i;
      for (i = 0; i < nSeries; i++) {
        var v = cellAt(r, i + 1);
        if (isFinite(v)) got = true;
        a.push(isFinite(v) ? v : null);
      }
      if (!got) return;                       // 값이 하나도 없는 줄은 버립니다
      if (!isFinite(a[0])) a[0] = null;
      out.push(a);
    });
    return out;
  }
  function pick(list, key, val) {
    for (var i = 0; i < (list || []).length; i++) if (String(list[i][key]) === String(val)) return list[i];
    return null;
  }
  function schoolOf() {
    var h = HUB(), w = W();
    try { if (h && typeof h.schoolName === 'function' && h.schoolName()) return h.schoolName(); } catch (e) {}
    if (w && w.MBL_CONFIG && w.MBL_CONFIG.SCHOOL) return String(w.MBL_CONFIG.SCHOOL);
    return '';
  }

  //  ★ 여기 한 곳에서만 board 를 읽습니다. 아래 블록들은 모두 이 결과만 봅니다.
  function prep(ctx) {
    ctx = ctx || {};
    if (ctx.__dk) return ctx.__dk;                       // 같은 렌더 안에서 두 번 세지 않게

    var b        = ctx.board || {};
    var lesson   = b.lesson || {};
    var groups   = Array.isArray(b.groups)   ? b.groups   : [];
    var dataAll  = Array.isArray(b.data)     ? b.data     : [];
    var reports  = Array.isArray(b.reports)  ? b.reports  : [];
    var feedback = Array.isArray(b.feedback) ? b.feedback : [];
    var quizAll  = Array.isArray(b.quiz)     ? b.quiz     : [];

    var exp    = expOf(lesson, ctx.exp);
    var spec   = specOf(lesson, exp);
    var series = (Array.isArray(spec.series) && spec.series.length) ? spec.series : DEF_SPEC.series;

    var role = (ctx.role === 'teacher') ? 'teacher' : 'student';
    var mode = (ctx.mode === 'simple')  ? 'simple'  : 'live';

    //  우리 모둠 — 학생은 ctx.group, 교사는 고른 모둠(없으면 자료가 있는 첫 모둠)
    var g = ctx.group || null, i, k;
    if (!g && groups.length) {
      var withData = null;
      for (i = 0; i < groups.length && !withData; i++) {
        if (pick(dataAll, 'group_id', groups[i].id)) withData = groups[i];
      }
      g = withData || groups[0];
    }
    var gid = g ? String(g.id) : '';
    var myD = gid ? pick(dataAll, 'group_id', gid) : (dataAll[0] || null);
    var myR = gid ? pick(reports, 'group_id', gid) : (reports[0] || null);
    var ans = (myR && myR.answers && typeof myR.answers === 'object') ? myR.answers : {};

    var rows = toRows(myD && myD.rows, series.length);
    var pre  = (myD && Array.isArray(myD.predict)) ? myD.predict : [];

    var questions = (lesson.form && Array.isArray(lesson.form.questions) && lesson.form.questions.length)
                  ? lesson.form.questions
                  : ((exp && Array.isArray(exp.questions)) ? exp.questions : []);

    var myQuiz = [], fbIn = [];
    for (k = 0; k < quizAll.length; k++)  if (String(quizAll[k].group_id) === gid) myQuiz.push(quizAll[k]);
    for (k = 0; k < feedback.length; k++) if (String(feedback[k].to_group) === gid) fbIn.push(feedback[k]);
    //  간편 모드에서 작업 파일로 이어받은 별점도 같은 자리에 놓습니다
    if (!fbIn.length && Array.isArray(ctx.feedbackIn)) fbIn = ctx.feedbackIn;

    //  자료가 있는 모둠들 (반 전체 블록이 씁니다)
    var withRows = [];
    for (k = 0; k < groups.length; k++) {
      var d  = pick(dataAll, 'group_id', groups[k].id);
      var rr = toRows(d && d.rows, series.length);
      if (!rr.length) continue;
      withRows.push({
        id: String(groups[k].id),
        no: Number(groups[k].group_no) || (k + 1),
        name: groups[k].group_name || ((Number(groups[k].group_no) || (k + 1)) + '모둠'),
        rows: rr, note: (d && d.note) || '',
        mine: String(groups[k].id) === gid,
        color: GROUP_HEX[k % GROUP_HEX.length]
      });
    }

    var C = {
      board: b, lesson: lesson, exp: exp, spec: spec, series: series,
      xLabel: (spec.x && spec.x.label) || '회차',
      xUnit : (spec.x && spec.x.unit)  || '',
      groups: groups, dataAll: dataAll, reports: reports, feedback: feedback, quizAll: quizAll,
      role: role, mode: mode,
      group: g, gid: gid,
      groupName: g ? (g.group_name || ((g.group_no || '') + '모둠')) : '',
      groupNo: g ? (g.group_no || '') : '',
      members: (g && Array.isArray(g.members))
                 ? g.members.map(function (x) { return String(x == null ? '' : x).trim(); })
                            .filter(function (x) { return !!x; })
                 : [],
      rows: rows, predict: pre, note: (myD && myD.note) || '',
      report: myR, answers: ans, questions: questions,
      ai: Array.isArray(ans.__ai) ? ans.__ai : [],
      evalObj: (ans.__eval && typeof ans.__eval === 'object' && !Array.isArray(ans.__eval)) ? ans.__eval : null,
      analysis: (ans.__analysis && typeof ans.__analysis === 'object') ? ans.__analysis : null,
      lab: ctx.lab || ((ans.__dash && ans.__dash.lab) || null),   // 데이터 실험실 설정
      myQuiz: myQuiz, fbIn: fbIn, withRows: withRows,
      vendor: ctx.vendor || lesson.vendor || 'ez',
      title: lesson.exp_title || (exp && exp.title) || lesson.title || '실험 대시보드',
      classLabel: lesson.class_label || '',
      teacher: lesson.teacher_name || '',
      school: ctx.school || schoolOf()
    };
    //  보고서에 실제로 쓴 답이 하나라도 있는가
    C.answered = 0;
    var vals = alignAnswers(ans, questions, {});
    for (k = 0; k < vals.length; k++) {
      if (vals[k] !== undefined && vals[k] !== null && String(vals[k]).trim() !== '') C.answered++;
    }
    C.alignedAnswers = vals;
    C.hasDiagram = !!figSVG('D', exp && FIG_DIAGRAM[exp.id]);
    C.hasExGraph = !!figSVG('G', exp && FIG_GRAPH[exp.id]);
    try { ctx.__dk = C; } catch (e) {}
    return C;
  }

  // ─────────────────────────────────────────────────────────────────
  //  4. 그래프 — index.html 의 chartSVG 가 있으면 그것을, 없으면 여기 폴백을
  //     (두 길의 결과가 같도록 눈금 4칸 · 색 순서 · 점선 예상 · 범례 규칙을 맞췄습니다)
  // ─────────────────────────────────────────────────────────────────
  function chart(sp, rows, opt) {
    opt = opt || {};
    var w = W();
    if (w && typeof w.chartSVG === 'function') {
      try {
        var out = w.chartSVG(sp, rows, opt);
        if (out) return out;
      } catch (e) { /* 폴백으로 내려갑니다 */ }
    }
    return chartFallback(sp, rows, opt);
  }

  function chartFallback(sp, rows, opt) {
    opt = opt || {};
    var Wd = opt.w || 560, Hg = opt.h || 300;
    var P = { l: 52, r: 16, t: 18, b: 44 };
    var series = (sp && sp.series) || [];
    var kind   = (sp && sp.chart) || 'line';
    var xLab   = (sp && sp.x && sp.x.label) || 'x';
    var xUnit  = (sp && sp.x && sp.x.unit) || '';

    var pts = [];
    (rows || []).forEach(function (r) {
      var x  = cellAt(r, 0);
      var ys = series.map(function (_, i) { var v = cellAt(r, i + 1); return isFinite(v) ? v : null; });
      if (ys.every(function (v) { return v === null; })) return;
      pts.push({ x: isFinite(x) ? x : null, raw: Array.isArray(r) ? r[0] : x, ys: ys });
    });
    var preP = [];
    if (Array.isArray(opt.predict)) {
      opt.predict.forEach(function (r) {
        var x  = cellAt(r, 0);
        var ys = series.map(function (_, i) { var v = cellAt(r, i + 1); return isFinite(v) ? v : null; });
        if (ys.every(function (v) { return v === null; })) return;
        preP.push({ x: isFinite(x) ? x : null, ys: ys });
      });
    }
    if (!pts.length && !preP.length) return '<div class="dk-empty">아직 자료가 없습니다.</div>';

    var numericX = pts.length > 0 && pts.every(function (p) { return p.x !== null; }) && kind !== 'bar';
    var xs = numericX ? pts.map(function (p) { return p.x; }) : pts.map(function (_, i) { return i; });
    if (numericX) preP.forEach(function (p) { if (p.x !== null) xs.push(p.x); });
    if (!xs.length) preP.forEach(function (_, i) { xs.push(i); });

    var allY = [];
    pts.forEach(function (p) { p.ys.forEach(function (v) { if (v !== null) allY.push(v); }); });
    preP.forEach(function (p) { p.ys.forEach(function (v) { if (v !== null) allY.push(v); }); });
    var y0 = Math.min.apply(null, allY), y1 = Math.max.apply(null, allY);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    var pad = (y1 - y0) * 0.12; y0 -= pad; y1 += pad;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x0 === x1) { x0 -= 0.5; x1 += 0.5; }
    var px = function (v) { return P.l + (v - x0) / (x1 - x0) * (Wd - P.l - P.r); };
    var py = function (v) { return Hg - P.b - (v - y0) / (y1 - y0) * (Hg - P.t - P.b); };

    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hg + '" width="100%" role="img" aria-label="' +
            esc(xLab) + ' 그래프" style="min-width:280px">';
    var i;
    for (i = 0; i <= 4; i++) {
      var vy = y0 + (y1 - y0) * i / 4, gy = py(vy);
      s += '<line x1="' + P.l + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r) + '" y2="' + gy.toFixed(1) +
           '" stroke="var(--line)" stroke-width="1"/>';
      s += '<text x="' + (P.l - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--muted)">' +
           esc(vy.toFixed(Math.abs(y1 - y0) < 5 ? 1 : 0)) + '</text>';
    }
    s += '<line x1="' + P.l + '" y1="' + (Hg - P.b) + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) +
         '" stroke="var(--line-2)" stroke-width="1.5"/>';
    pts.forEach(function (p, k) {
      var X  = px(numericX ? p.x : k);
      var lb = (p.raw === '' || p.raw === undefined || p.raw === null) ? (k + 1) : p.raw;
      if (pts.length <= 12 || k % Math.ceil(pts.length / 10) === 0) {
        s += '<text x="' + X.toFixed(1) + '" y="' + (Hg - P.b + 17) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' +
             esc(lb) + '</text>';
      }
    });
    if (!pts.length) {                                    // 값은 아직 없고 예상만 그려 둔 때
      for (i = 0; i <= 4; i++) {
        var vx0 = x0 + (x1 - x0) * i / 4;
        s += '<text x="' + px(vx0).toFixed(1) + '" y="' + (Hg - P.b + 17) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' +
             esc(fmtNum(vx0)) + '</text>';
      }
    }
    s += '<text x="' + (Wd - P.r) + '" y="' + (Hg - 8) + '" text-anchor="end" font-size="11.5" fill="var(--muted)">' +
         esc(xLab + (xUnit ? ' (' + xUnit + ')' : '')) + '</text>';

    function preX(p, k) {
      if (numericX && p.x !== null) return px(p.x);
      var span = Math.max(pts.length, preP.length) - 1;
      return px(preP.length > 1 ? (k * span / (preP.length - 1)) : 0);
    }
    if (preP.length) {                                     // 예상 — 점선으로 뒤에 깔립니다
      series.forEach(function (se, si) {
        var col = SERIES_HEX[si % SERIES_HEX.length], d = '', pen = false;
        preP.forEach(function (p, k) {
          if (p.ys[si] === null) { pen = false; return; }
          d += (pen ? 'L' : 'M') + preX(p, k).toFixed(1) + ' ' + py(p.ys[si]).toFixed(1) + ' ';
          pen = true;
        });
        if (d) {
          s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" opacity=".62" ' +
               'stroke-dasharray="8 6" stroke-linejoin="round" stroke-linecap="round"/>';
        }
      });
    }
    series.forEach(function (se, si) {                     // 계열
      var col  = SERIES_HEX[si % SERIES_HEX.length];
      var list = pts.map(function (p, k) {
        return { X: px(numericX ? p.x : k), Y: p.ys[si] === null ? null : py(p.ys[si]) };
      });
      if (kind === 'bar') {
        var bw = Math.max(4, (Wd - P.l - P.r) / Math.max(pts.length, 1) / (series.length + 1));
        list.forEach(function (pt) {
          if (pt.Y === null) return;
          var bx = pt.X - (series.length * bw) / 2 + si * bw;
          s += '<rect x="' + bx.toFixed(1) + '" y="' + pt.Y.toFixed(1) + '" width="' + bw.toFixed(1) +
               '" height="' + Math.max(0, (Hg - P.b - pt.Y)).toFixed(1) + '" fill="' + col + '" opacity=".85" rx="2"/>';
        });
      } else {
        if (kind !== 'scatter') {
          var d = '', pen = false;
          list.forEach(function (pt) {
            if (pt.Y === null) { pen = false; return; }
            d += (pen ? 'L' : 'M') + pt.X.toFixed(1) + ' ' + pt.Y.toFixed(1) + ' ';
            pen = true;
          });
          if (d) {
            s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.4" ' +
                 'stroke-linejoin="round" stroke-linecap="round"/>';
          }
        }
        list.forEach(function (pt) {
          if (pt.Y === null) return;
          s += '<circle cx="' + pt.X.toFixed(1) + '" cy="' + pt.Y.toFixed(1) + '" r="3.4" fill="' + col + '"/>';
        });
      }
    });

    //  예상과 가장 많이 달랐던 지점 — 세로 점선으로 이어 표시합니다.
    if (preP.length && pts.length && numericX) {
      var best = null;
      series.forEach(function (se, si) {
        var g = predictGap(rows, opt.predict, si);
        if (!g || g.maxDiff === null || !isFinite(g.maxDiff)) return;
        if (!best || g.maxDiff > best.maxDiff) best = g;
      });
      if (best && isFinite(best.atX)) {
        var GX = px(best.atX), Ya = py(best.actual), Yp = py(best.predicted);
        s += '<line x1="' + GX.toFixed(1) + '" y1="' + Math.min(Ya, Yp).toFixed(1) + '" x2="' + GX.toFixed(1) +
             '" y2="' + Math.max(Ya, Yp).toFixed(1) + '" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="3 3"/>';
        s += '<circle cx="' + GX.toFixed(1) + '" cy="' + Yp.toFixed(1) + '" r="5" fill="none" stroke="var(--ink)" stroke-width="1.8"/>';
        s += '<circle cx="' + GX.toFixed(1) + '" cy="' + Ya.toFixed(1) + '" r="5" fill="var(--ink)"/>';
        s += '<text x="' + Math.min(Wd - P.r, GX + 8).toFixed(1) + '" y="' + (Math.min(Ya, Yp) - 7).toFixed(1) +
             '" text-anchor="' + (GX > Wd * 0.7 ? 'end' : 'start') +
             '" font-size="11.5" font-weight="700" fill="var(--ink)">가장 큰 차이 ' + esc(fmtNum(best.maxDiff)) + '</text>';
      }
    }
    s += '</svg>';

    var lg = '<div class="dk-lg">';
    series.forEach(function (se, si) {
      lg += '<span><i style="background:' + SERIES_HEX[si % SERIES_HEX.length] + '"></i>' +
            esc(se.label || ('계열' + (si + 1))) + (se.unit ? ' (' + esc(se.unit) + ')' : '') + '</span>';
    });
    if (preP.length) {
      lg += '<span><i style="width:1.4em;height:0;border-top:2.4px dashed var(--muted);border-radius:0"></i>점선 = 우리가 그린 예상</span>';
    }
    return s + lg + '</div>';
  }

  //  여러 묶음을 한 그림에 — 모둠 겹친 그래프 · 변환 그래프가 씁니다.
  //  sets: [{label, color, pts:[[x,y]…], fit, line, thick, faint}]
  function multiChart(sets, opt) {
    opt = opt || {};
    var Wd = opt.w || 660, Hg = opt.h || 330, P = { l: 58, r: 16, t: 16, b: 50 };
    var xs = [], ys = [];
    (sets || []).forEach(function (S) { (S.pts || []).forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    if (!xs.length) return '<div class="dk-empty">그릴 점이 없습니다.</div>';
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x0 === x1) { x0 -= 0.5; x1 += 0.5; }
    if (y0 === y1) { y0 -= 1;   y1 += 1;   }
    var padX = (x1 - x0) * 0.06, padY = (y1 - y0) * 0.10;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    var px = function (v) { return P.l + (v - x0) / (x1 - x0) * (Wd - P.l - P.r); };
    var py = function (v) { return Hg - P.b - (v - y0) / (y1 - y0) * (Hg - P.t - P.b); };
    var fx = function (v) { return fmtNum(v, Math.abs(x1 - x0) < 5 ? 2 : 0); };
    var fy = function (v) { return fmtNum(v, Math.abs(y1 - y0) < 5 ? 2 : 0); };

    function seg(fit) {                    // 추세선을 그림 안쪽으로만 자릅니다
      if (!fit || fit.slope === null || !isFinite(fit.slope)) return null;
      var a = fit.slope, b = fit.intercept, xa = x0, xb = x1;
      if (Math.abs(a) > 1e-12) {
        var c0 = (y0 - b) / a, c1 = (y1 - b) / a;
        xa = Math.max(xa, Math.min(c0, c1));
        xb = Math.min(xb, Math.max(c0, c1));
      }
      if (!(xb > xa)) return null;
      return [px(xa), py(a * xa + b), px(xb), py(a * xb + b)];
    }

    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hg + '" width="100%" role="img" aria-label="' +
            esc((opt.xLabel || 'x') + ' 대 ' + (opt.yLabel || 'y') + ' 그래프') + '" style="min-width:280px">';
    var i;
    for (i = 0; i <= 4; i++) {
      var vy = y0 + (y1 - y0) * i / 4, gy = py(vy);
      s += '<line x1="' + P.l + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line)"/>';
      s += '<text x="' + (P.l - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--muted)">' +
           esc(fy(vy)) + '</text>';
    }
    for (i = 0; i <= 4; i++) {
      var vx = x0 + (x1 - x0) * i / 4;
      s += '<text x="' + px(vx).toFixed(1) + '" y="' + (Hg - P.b + 16) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' +
           esc(fx(vx)) + '</text>';
    }
    s += '<line x1="' + P.l + '" y1="' + (Hg - P.b) + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) +
         '" stroke="var(--line-2)" stroke-width="1.5"/>';
    s += '<text x="' + ((P.l + Wd - P.r) / 2) + '" y="' + (Hg - 8) + '" text-anchor="middle" font-size="11.5" fill="var(--muted)">' +
         esc((opt.xLabel || '') + (opt.xUnit ? ' (' + opt.xUnit + ')' : '')) + '</text>';
    s += '<text transform="translate(14,' + ((P.t + Hg - P.b) / 2) + ') rotate(-90)" text-anchor="middle" font-size="11.5" fill="var(--muted)">' +
         esc((opt.yLabel || '') + (opt.yUnit ? ' (' + opt.yUnit + ')' : '')) + '</text>';

    (sets || []).forEach(function (S) {          // 선 (이어 그리기를 원한 묶음만)
      if (!S.line || (S.pts || []).length < 2) return;
      var d = '', pen = false;
      S.pts.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (p) {
        d += (pen ? 'L' : 'M') + px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1) + ' ';
        pen = true;
      });
      s += '<path d="' + d + '" fill="none" stroke="' + S.color + '" stroke-width="' + (S.thick ? 3 : 2.2) +
           '" opacity="' + (S.faint ? '.45' : '.9') + '" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    (sets || []).forEach(function (S) {          // 점
      (S.pts || []).forEach(function (p) {
        s += '<circle cx="' + px(p[0]).toFixed(1) + '" cy="' + py(p[1]).toFixed(1) + '" r="' + (S.thick ? 4.4 : 3.1) +
             '" fill="' + S.color + '" opacity="' + (S.faint ? '.45' : '.9') + '"' +
             (S.thick ? ' stroke="var(--ink)" stroke-width="1.2"' : '') + '/>';
      });
    });
    (sets || []).forEach(function (S) {          // 묶음별 추세선
      if (!S.fit) return;
      var g = seg(S.fit);
      if (!g) return;
      s += '<line x1="' + g[0].toFixed(1) + '" y1="' + g[1].toFixed(1) + '" x2="' + g[2].toFixed(1) + '" y2="' + g[3].toFixed(1) +
           '" stroke="' + S.color + '" stroke-width="' + (S.thick ? 2.6 : 1.6) + '" opacity="' + (S.thick ? '.9' : '.55') + '"/>';
    });
    if (opt.allFit) {                            // 반 전체 추세선 — 굵게
      var ga = seg(opt.allFit);
      if (ga) {
        s += '<line x1="' + ga[0].toFixed(1) + '" y1="' + ga[1].toFixed(1) + '" x2="' + ga[2].toFixed(1) +
             '" y2="' + ga[3].toFixed(1) + '" stroke="var(--ink)" stroke-width="3.4" opacity=".75" stroke-linecap="round"/>';
      }
    }
    s += '</svg>';

    var lg = '<div class="dk-lg">';
    (sets || []).forEach(function (S) {
      lg += '<span><i style="background:' + S.color + '"></i>' + esc(S.label) + (S.thick ? ' (우리 모둠)' : '') + '</span>';
    });
    if (opt.allFit) lg += '<span><i style="width:1.3em;height:0;border-top:3px solid var(--ink);border-radius:0"></i>반 전체 추세선</span>';
    return s + lg + '</div>';
  }

  // ─────────────────────────────────────────────────────────────────
  //  5. 블록 정의
  //     need 에 적은 자료가 없으면 팔레트에서 흐리게 두고 까닭을 보여 줍니다(숨기지 않습니다).
  //     need 토큰: data · predict · report · quiz · eval · ai · feedback · board · exp · figD · figG
  // ─────────────────────────────────────────────────────────────────
  var BLOCKS = [
    // ── 측정
    { key: 'value',   name: '값 카드',      group: '측정', need: ['data'], w: 12, desc: '계열마다 마지막 값을 큰 숫자와 단위로 보여 줍니다.' },
    { key: 'table',   name: '데이터 표',    group: '측정', need: ['data'], w: 6,  desc: '적어 둔 측정값을 그대로 표로 보여 줍니다.' },
    { key: 'line',    name: '선그래프',     group: '측정', need: ['data'], w: 12, desc: '가로축을 따라 계열을 선으로 잇습니다.' },
    { key: 'scatter', name: '산점도',       group: '측정', need: ['data'], w: 6,  desc: '점만 찍어 흩어진 모양을 봅니다.' },
    { key: 'bar',     name: '막대그래프',   group: '측정', need: ['data'], w: 6,  desc: '회차마다 크기를 나란히 견줍니다.' },
    { key: 'stats',   name: '통계 카드',    group: '측정', need: ['data'], w: 6,  desc: '처음·마지막·평균·최소·최대를 한눈에.' },
    { key: 'fit',     name: '기울기와 R²',  group: '측정', need: ['data'], w: 6,  desc: '최소제곱 직선의 기울기(단위까지)와 R².' },
    { key: 'predict', name: '예상 vs 실제', group: '측정', need: ['data', 'predict'], w: 12, desc: '우리가 그린 예상을 점선으로 겹치고 가장 크게 달랐던 곳을 짚습니다.' },
    { key: 'tf',      name: '변환 그래프',  group: '측정', need: ['data'], w: 12, desc: '데이터 실험실에서 고른 축·변환 그대로 다시 그립니다.' },

    // ── 반 전체
    { key: 'classLines', name: '모둠 겹친 그래프',   group: '반 전체', need: ['data', 'board'], w: 12, desc: '모둠마다 색을 달리해 한 그림에 겹쳐 그립니다.' },
    { key: 'rank',       name: '모둠별 기울기 순위', group: '반 전체', need: ['data', 'board'], w: 6,  desc: '기울기가 큰 모둠부터 줄 세웁니다.' },
    { key: 'mypos',      name: '우리 모둠 위치',     group: '반 전체', need: ['data', 'board'], w: 6,  desc: '반 전체 가운데 우리 모둠이 어디쯤인지.' },
    { key: 'progress',   name: '모둠 진행 현황',     group: '반 전체', need: ['board'], w: 12, role: 'teacher', desc: '모둠별 측정·보고서·개념확인 진행 상태 타일.' },

    // ── 콘텐츠
    { key: 'overview', name: '실험 개요',       group: '콘텐츠', need: ['exp'], w: 6,  desc: '제목·성취기준 원문·소요 시간·센서.' },
    { key: 'prepare',  name: '준비물',          group: '콘텐츠', need: ['exp'], w: 6,  desc: '이 실험에 필요한 준비물 목록.' },
    { key: 'steps',    name: '절차 카드',       group: '콘텐츠', need: ['exp'], w: 12, desc: '업체별 절차를 번호가 붙은 카드로.' },
    { key: 'diagram',  name: '연결 다이어그램', group: '콘텐츠', need: ['exp', 'figD'], w: 6, desc: '센서를 어디에 어떻게 다는지 그림으로.' },
    { key: 'exgraph',  name: '결과 그래프 예시', group: '콘텐츠', need: ['exp', 'figG'], w: 6, desc: '이런 모양이 나오면 잘 된 것입니다.' },
    { key: 'report',   name: '보고서 문답',     group: '콘텐츠', need: ['report'], w: 12, desc: '문항과 우리가 쓴 답을 나란히.' },
    { key: 'quiz',     name: '개념 확인 결과',  group: '콘텐츠', need: ['quiz'], w: 6,  desc: '우리 모둠이 받은 점수와 맞고 틀림.' },
    { key: 'quizdist', name: '문항별 정답률',   group: '콘텐츠', need: ['quiz', 'board'], w: 6, role: 'teacher', desc: '어느 문항에서 반 전체가 걸렸는지.' },
    { key: 'eval',     name: '선생님 평가',     group: '콘텐츠', need: ['eval'], w: 6,  desc: '루브릭 항목별 점수와 선생님이 쓴 문장.' },
    { key: 'ai',       name: 'AI 협업 기록',    group: '콘텐츠', need: ['ai'], w: 12, desc: 'AI 에게 무엇을 물었고 무엇을 우리 데이터로 검증했는지.' },
    { key: 'stars',    name: '별점과 칭찬',     group: '콘텐츠', need: ['feedback'], w: 6, desc: '다른 모둠에게 받은 별점 평균과 칭찬 글.' },

    // ── 꾸밈
    { key: 'bigtitle', name: '큰 제목', group: '꾸밈', need: [], w: 12, desc: '전자칠판에 띄울 큰 글씨 제목.' },
    { key: 'memo',     name: '메모 글', group: '꾸밈', need: [], w: 6,  desc: '설명이나 알림을 적어 둡니다.' },
    { key: 'divider',  name: '구분선',  group: '꾸밈', need: [], w: 12, desc: '영역을 나누는 가로선.' }
  ];
  var BMAP = {};
  BLOCKS.forEach(function (b) { BMAP[b.key] = b; });
  var GROUPS = ['측정', '반 전체', '콘텐츠', '꾸밈'];

  // ─────────────────────────────────────────────────────────────────
  //  6. 쓸 수 있는가 — 없으면 "무엇이 있으면 되는지" 를 한 줄로
  //     → { ok:Boolean, why:String }  (why 는 팔레트에 그대로 보여 줍니다)
  // ─────────────────────────────────────────────────────────────────
  function canUse(key, ctx) {
    var B = BMAP[key];
    if (!B) return { ok: false, why: '모르는 블록입니다.' };
    var C = prep(ctx);

    if (B.role && B.role !== C.role) {
      return { ok: false, why: (B.role === 'teacher')
        ? '선생님 화면에서만 쓸 수 있는 블록입니다.'
        : '학생 화면에서만 쓸 수 있는 블록입니다.' };
    }
    for (var i = 0; i < B.need.length; i++) {
      var n = B.need[i], why = null;
      if (n === 'data'     && !C.rows.length)    why = '측정값을 한 줄이라도 적으면 바로 쓸 수 있습니다.';
      if (n === 'predict'  && !C.predict.length) why = '측정하기 전에 예상 그래프를 그려 두면 쓸 수 있습니다.';
      if (n === 'board') {
        if (C.mode === 'simple') {
          why = '간편 모드에서는 이 기기에 우리 모둠 자료만 있어 반 전체를 그릴 수 없습니다. 참여코드로 들어오면 됩니다.';
        } else if (C.withRows.length < 2) {
          why = '자료를 올린 모둠이 2모둠 이상이 되면 그려집니다. 지금은 ' + C.withRows.length + '모둠입니다.';
        }
      }
      if (n === 'exp'      && !C.exp)         why = '실험 도감에서 실험을 고르면 쓸 수 있습니다.';
      if (n === 'figD'     && !C.hasDiagram)  why = '이 실험에는 연결 그림이 준비되어 있지 않습니다.';
      if (n === 'figG'     && !C.hasExGraph)  why = '이 실험에는 결과 그래프 예시가 준비되어 있지 않습니다.';
      if (n === 'report'   && !C.answered)    why = '보고서 문항에 한 개라도 답하면 나타납니다.';
      if (n === 'quiz'     && !C.myQuiz.length && !(C.role === 'teacher' && C.quizAll.length)) {
        why = '개념 확인을 풀면 결과가 쌓입니다.';
      }
      if (n === 'eval'     && !C.evalObj)     why = '선생님이 루브릭으로 평가하면 나타납니다.';
      if (n === 'ai'       && !C.ai.length)   why = 'AI 와 협업한 탐구를 한 번이라도 기록하면 나타납니다.';
      if (n === 'feedback' && !C.fbIn.length) why = '다른 모둠에게 별점·칭찬을 받으면 나타납니다.';
      if (why) return { ok: false, why: why };
    }
    return { ok: true, why: '' };
  }

  // ─────────────────────────────────────────────────────────────────
  //  7. 블록 그리기
  // ─────────────────────────────────────────────────────────────────
  function empty(msg) { return '<div class="dk-empty">' + esc(msg || '아직 자료가 없습니다.') + '</div>'; }
  function seriesLabel(C, i) { return (C.series[i] || {}).label || ('계열 ' + (i + 1)); }
  function seriesUnit(C, i)  { return (C.series[i] || {}).unit || ''; }

  //  선·산점도·막대 — 같은 자리를 씁니다
  function chartBody(C, kind, cfg) {
    if (!C.rows.length) return empty('측정값을 적으면 그래프가 바로 그려집니다.');
    var sp  = { x: C.spec.x, series: C.series, chart: kind };
    var opt = { w: 620, h: 320 };
    if (cfg && cfg.withPredict && C.predict.length) opt.predict = C.predict;
    return '<div class="dk-chart">' + chart(sp, C.rows, opt) + '</div>';
  }

  //  블록 몸통 (테두리·제목은 renderBlock 이 붙입니다)
  var BODY = {

    value: function (C) {
      if (!C.rows.length) return empty('측정값을 적으면 여기에 큰 숫자로 나타납니다.');
      var h = '<div class="dk-vals">';
      C.series.forEach(function (s, i) {
        var st = stats(C.rows, i);
        h += '<div class="dk-v"><b>' + esc(seriesLabel(C, i)) + '</b>' +
             '<em style="color:' + SERIES_HEX[i % SERIES_HEX.length] + '">' + esc(st.last === null ? '—' : sciNum(st.last)) + '</em>' +
             '<span>' + esc(seriesUnit(C, i)) + '</span></div>';
      });
      h += '</div><p class="dk-sub">마지막으로 적은 값입니다 · 모두 ' + C.rows.length + '줄</p>';
      return h;
    },

    table: function (C) {
      if (!C.rows.length) return empty('적어 둔 측정값이 없습니다.');
      var h = '<div class="dk-tw"><table class="dk-t"><thead><tr><th>#</th><th>' +
              esc(C.xLabel) + (C.xUnit ? ' (' + esc(C.xUnit) + ')' : '') + '</th>';
      C.series.forEach(function (s, i) {
        h += '<th>' + esc(seriesLabel(C, i)) + (seriesUnit(C, i) ? ' (' + esc(seriesUnit(C, i)) + ')' : '') + '</th>';
      });
      h += '</tr></thead><tbody>';
      C.rows.forEach(function (r, k) {
        h += '<tr><td>' + (k + 1) + '</td>';
        for (var i = 0; i <= C.series.length; i++) {
          var v = r[i];
          h += '<td>' + esc(v === null || v === undefined ? '' : fmtNum(v)) + '</td>';
        }
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      if (C.note) h += '<p class="dk-sub">실험 조건 메모: ' + esc(C.note) + '</p>';
      return h;
    },

    line:    function (C, cfg) { return chartBody(C, 'line', cfg); },
    scatter: function (C, cfg) { return chartBody(C, 'scatter', cfg); },
    bar:     function (C, cfg) { return chartBody(C, 'bar', cfg); },

    stats: function (C) {
      if (!C.rows.length) return empty('측정값이 있어야 셀 수 있습니다.');
      var h = '<div class="dk-tw"><table class="dk-t"><thead><tr><th>계열</th><th>개수</th><th>처음</th><th>마지막</th>' +
              '<th>변화</th><th>평균</th><th>최소</th><th>최대</th></tr></thead><tbody>';
      C.series.forEach(function (s, i) {
        var st = stats(C.rows, i), u = seriesUnit(C, i);
        h += '<tr><td class="dk-l"><b style="color:' + SERIES_HEX[i % SERIES_HEX.length] + '">' +
             esc(seriesLabel(C, i)) + '</b>' + (u ? ' <span style="opacity:.7">(' + esc(u) + ')</span>' : '') + '</td>' +
             '<td>' + st.n + '</td><td>' + esc(sciNum(st.first)) + '</td><td>' + esc(sciNum(st.last)) + '</td>' +
             '<td>' + esc(st.delta === null ? '—' : (st.delta > 0 ? '+' : '') + sciNum(st.delta)) + '</td>' +
             '<td>' + esc(sciNum(st.mean)) + '</td><td>' + esc(sciNum(st.min)) + '</td><td>' + esc(sciNum(st.max)) + '</td></tr>';
      });
      return h + '</tbody></table></div>';
    },

    fit: function (C) {
      if (!C.rows.length) return empty('측정값이 두 줄 이상이면 기울기를 낼 수 있습니다.');
      var any = false, h = '<div class="dk-vals">';
      C.series.forEach(function (s, i) {
        var st = stats(C.rows, i);
        if (st.slope === null) return;
        any = true;
        h += '<div class="dk-v"><b>' + esc(seriesLabel(C, i)) + ' 기울기</b>' +
             '<em style="color:' + SERIES_HEX[i % SERIES_HEX.length] + '">' + esc(sciNum(st.slope)) + '</em>' +
             '<span>' + esc(slopeUnit(seriesUnit(C, i), C.xUnit)) + '</span>' +
             '<div style="font-size:.75em;margin-top:.3em;opacity:.85">R² = ' + esc(fmtR2(st.r2)) + ' · 점 ' + st.n + '개</div></div>';
      });
      h += '</div>';
      if (!any) return empty('기울기를 내려면 값이 두 줄 이상이고 가로축 값이 서로 달라야 합니다.');
      h += '<p class="dk-sub">기울기는 "가로축이 1 늘 때 세로축이 얼마나 변하는가" 입니다. ' +
           'R² 이 1 에 가까울수록 점들이 직선에 잘 놓여 있습니다.</p>';
      return h;
    },

    predict: function (C, cfg) {
      if (!C.predict.length) return empty('측정하기 전에 예상 그래프를 그려 두면 여기에서 견줄 수 있습니다.');
      var sp = { x: C.spec.x, series: C.series, chart: (cfg && cfg.kind) || C.spec.chart || 'line' };
      var h = '<div class="dk-chart">' + chart(sp, C.rows, { predict: C.predict, w: 620, h: 320 }) + '</div>';
      if (C.rows.length) {
        h += '<div class="dk-tw" style="margin-top:.5em"><table class="dk-t"><thead><tr><th>계열</th>' +
             '<th>가장 큰 차이</th><th>그때 가로축</th><th>예상</th><th>실제</th><th>평균 차이</th></tr></thead><tbody>';
        C.series.forEach(function (s, i) {
          var g = predictGap(C.rows, C.predict, i);
          h += '<tr><td class="dk-l"><b style="color:' + SERIES_HEX[i % SERIES_HEX.length] + '">' + esc(seriesLabel(C, i)) + '</b></td>' +
               '<td><b>' + esc(sciNum(g.maxDiff)) + '</b></td><td>' + esc(sciNum(g.atX)) + '</td>' +
               '<td>' + esc(sciNum(g.predicted)) + '</td><td>' + esc(sciNum(g.actual)) + '</td>' +
               '<td>' + esc(sciNum(g.meanDiff)) + '</td></tr>';
        });
        h += '</tbody></table></div><p class="dk-sub">점선이 예상, 실선이 실제입니다. 가장 크게 어긋난 자리를 왜 그랬는지 설명해 보세요.</p>';
      }
      return h;
    },

    tf: function (C, cfg) {
      if (!C.rows.length) return empty('측정값이 있어야 축을 바꿔 볼 수 있습니다.');
      var L = (cfg && (cfg.xk || cfg.ys || cfg.yk)) ? cfg : (C.lab || {});
      var xk = L.xk || 'x', xt = TF[L.xt] ? L.xt : 'none';
      var yt = TF[L.yt] ? L.yt : 'none';
      var yks = (Array.isArray(L.ys) && L.ys.length) ? L.ys
              : (L.yk ? [L.yk] : C.series.map(function (_, i) { return 's' + i; }));
      var derived = Array.isArray(L.derived) ? L.derived : [];

      var cols = colList(C, derived);
      var xc = colOf(cols, xk) || cols[0];
      var sets = [], notes = [];
      yks.forEach(function (yk, n) {
        var yc = colOf(cols, yk);
        if (!yc) return;
        var P = tfPoints(C.rows, derived, xc.k, xt, yk, yt);
        if (!P.pts.length) { notes.push(colName(yc) + ' 은 변환한 뒤 남는 점이 없습니다.'); return; }
        var list = P.pts.map(function (p) { return [p.x, p.y]; });
        sets.push({
          label: TF[yt].lab(colName(yc)), color: SERIES_HEX[n % SERIES_HEX.length],
          pts: list, fit: (L.trend === false) ? null : stats(list, 0),
          line: (L.kind === 'line'), thick: false
        });
        if (P.skipped) notes.push(colName(yc) + ' 에서 ' + P.skipped + '개 점을 건너뛰었습니다.');
      });
      if (!sets.length) return empty('고른 축과 변환으로는 그릴 점이 없습니다. 데이터 실험실에서 축을 바꿔 보세요.');

      var xLab = TF[xt].lab(colName(xc)), xUnit = TF[xt].unit(xc.unit || '');
      var yc0 = colOf(cols, yks[0]) || { label: '', unit: '' };
      var yLab = TF[yt].lab(colName(yc0)), yUnit = TF[yt].unit(yc0.unit || '');
      var h = '<div class="dk-chart">' +
              multiChart(sets, { xLabel: xLab, xUnit: xUnit, yLabel: yLab, yUnit: yUnit, w: 660, h: 330 }) + '</div>';
      h += '<div class="dk-tw" style="margin-top:.5em"><table class="dk-t"><thead><tr><th>세로축</th><th>점</th><th>기울기</th><th>R²</th></tr></thead><tbody>';
      sets.forEach(function (S) {
        h += '<tr><td class="dk-l"><b style="color:' + S.color + '">' + esc(S.label) + '</b></td><td>' + S.pts.length + '</td>' +
             '<td>' + esc(S.fit ? sciNum(S.fit.slope) : '—') + ' ' + esc(slopeUnit(yUnit, xUnit)) + '</td>' +
             '<td>' + esc(S.fit ? fmtR2(S.fit.r2) : '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<p class="dk-sub">가로축 <b>' + esc(xLab) + '</b> (' + esc(TF[xt].name) + ') · 세로축 변환 <b>' + esc(TF[yt].name) + '</b>' +
           (notes.length ? ' · ' + esc(notes.join(' ')) : '') + '</p>';
      return h;
    },

    classLines: function (C, cfg) {
      if (!C.withRows.length) return empty('아직 자료를 올린 모둠이 없습니다.');
      var si = Math.max(0, Math.min(C.series.length - 1, Number((cfg && cfg.si) || 0)));
      var sets = [], allPts = [];
      C.withRows.forEach(function (G) {
        var pts = [];
        G.rows.forEach(function (r, k) {
          var y = r[si + 1];
          if (y === null || y === undefined || !isFinite(y)) return;
          var x = (r[0] === null || !isFinite(r[0])) ? k : r[0];
          pts.push([x, y]);
        });
        if (!pts.length) return;
        allPts = allPts.concat(pts);
        //  산점 실험(scatter)은 점을 선으로 이으면 오해를 줍니다 — cfg.line: false 로 끕니다.
        sets.push({ label: G.name, color: G.color, pts: pts, line: !(cfg && cfg.line === false), thick: G.mine, fit: null });
      });
      if (!sets.length) return empty('이 계열에는 아직 값이 없습니다.');
      var allFit = stats(allPts, 0);
      var h = '<div class="dk-chart">' + multiChart(sets, {
        xLabel: C.xLabel, xUnit: C.xUnit, yLabel: seriesLabel(C, si), yUnit: seriesUnit(C, si),
        allFit: (allFit.slope === null ? null : allFit), w: 680, h: 340
      }) + '</div>';
      h += '<p class="dk-sub">모둠 ' + sets.length + '곳을 겹쳐 그렸습니다 · 계열 = ' + esc(seriesLabel(C, si)) +
           '. 모양이 다른 모둠이 있다면 무엇이 달랐는지 물어보세요.</p>';
      return h;
    },

    rank: function (C, cfg) {
      if (!C.withRows.length) return empty('아직 자료를 올린 모둠이 없습니다.');
      var si = Math.max(0, Math.min(C.series.length - 1, Number((cfg && cfg.si) || 0)));
      var list = [];
      C.withRows.forEach(function (G) {
        var st = stats(G.rows, si);
        if (st.slope === null) return;
        list.push({ name: G.name, mine: G.mine, color: G.color, slope: st.slope, r2: st.r2, n: st.n });
      });
      if (!list.length) return empty('기울기를 낼 수 있는 모둠이 아직 없습니다(값 두 줄 이상 · 가로축이 서로 달라야 합니다).');
      list.sort(function (a, b) { return b.slope - a.slope; });
      var mx = Math.max.apply(null, list.map(function (x) { return Math.abs(x.slope); })) || 1;
      var u = slopeUnit(seriesUnit(C, si), C.xUnit);
      var h = '<div class="dk-bars">';
      list.forEach(function (x, i) {
        h += '<div class="dk-bar' + (x.mine ? ' dk-me' : '') + '">' +
             '<div class="dk-nm">' + (i + 1) + '위 ' + esc(x.name) + '</div>' +
             '<div class="dk-tr"><i style="width:' + (Math.abs(x.slope) / mx * 100).toFixed(1) + '%;background:' + x.color + '"></i></div>' +
             '<div class="dk-sc">' + esc(sciNum(x.slope)) + ' ' + esc(u) + ' · R²' + esc(fmtR2(x.r2)) + '</div></div>';
      });
      h += '</div><p class="dk-sub">계열 = ' + esc(seriesLabel(C, si)) + ' 의 최소제곱 기울기 순입니다. ' +
           '막대 길이는 기울기의 크기(부호는 숫자로 보세요).</p>';
      return h;
    },

    mypos: function (C, cfg) {
      if (!C.gid) return empty('우리 모둠을 고르면 위치를 보여 줍니다.');
      var si = Math.max(0, Math.min(C.series.length - 1, Number((cfg && cfg.si) || 0)));
      var vals = [], mine = null;
      C.withRows.forEach(function (G) {
        var st = stats(G.rows, si);
        if (st.slope === null) return;
        vals.push(st.slope);
        if (G.mine) mine = st.slope;
      });
      if (!vals.length) return empty('반 전체 기울기를 아직 낼 수 없습니다.');
      if (mine === null) return empty('우리 모둠의 기울기를 아직 낼 수 없습니다. 값을 두 줄 이상 적어 보세요.');
      var sorted = vals.slice().sort(function (a, b) { return b - a; });
      var rank = sorted.indexOf(mine) + 1;
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var pos = (hi === lo) ? 50 : ((mine - lo) / (hi - lo) * 100);
      var u = slopeUnit(seriesUnit(C, si), C.xUnit);
      var h = '<div class="dk-vals">' +
        '<div class="dk-v"><b>우리 모둠 기울기</b><em style="color:' + ACC.mintD + '">' + esc(sciNum(mine)) + '</em><span>' + esc(u) + '</span></div>' +
        '<div class="dk-v"><b>반 전체 순위</b><em>' + rank + '</em><span>/ ' + vals.length + '모둠</span></div>' +
        '<div class="dk-v"><b>반 평균과 차이</b><em>' + esc((mine - mean > 0 ? '+' : '') + sciNum(mine - mean)) + '</em><span>' + esc(u) + '</span></div></div>';
      h += '<div style="margin-top:.7em;position:relative;height:1.5em">' +
           '<div style="position:absolute;left:0;right:0;top:.6em;height:.4em;border-radius:999px;' +
           'background:linear-gradient(90deg,' + ACC.sky + ',' + ACC.mint + ',' + ACC.sun + ')"></div>' +
           '<div style="position:absolute;left:' + pos.toFixed(1) + '%;top:0;transform:translateX(-50%);' +
           'width:1.1em;height:1.1em;border-radius:50%;background:' + ACC.mintD + ';border:.18em solid #fff;' +
           'box-shadow:0 2px 6px rgba(0,0,0,.25)"></div></div>' +
           '<p class="dk-sub">왼쪽 끝 ' + esc(sciNum(lo)) + ' · 오른쪽 끝 ' + esc(sciNum(hi)) +
           ' (계열 = ' + esc(seriesLabel(C, si)) + ')</p>';
      return h;
    },

    progress: function (C) {
      if (!C.groups.length) return empty('아직 참여한 모둠이 없습니다.');
      var h = '<div class="dk-tiles">';
      C.groups.forEach(function (g, k) {
        var d = pick(C.dataAll, 'group_id', g.id);
        var r = pick(C.reports, 'group_id', g.id);
        var rows = toRows(d && d.rows, C.series.length);
        var qn = 0, fbn = 0, i;
        for (i = 0; i < C.quizAll.length; i++)  if (String(C.quizAll[i].group_id) === String(g.id)) qn++;
        for (i = 0; i < C.feedback.length; i++) if (String(C.feedback[i].to_group) === String(g.id)) fbn++;
        var st = (r && r.status) || '';
        var done = (st === 'done' || st === 'submitted');
        h += '<div class="dk-tile" style="border-left:.28em solid ' + GROUP_HEX[k % GROUP_HEX.length] + '">' +
             '<b>' + esc(g.group_name || ((g.group_no || (k + 1)) + '모둠')) + '</b>' +
             '<div>측정 ' + rows.length + '줄 · 예상 ' + ((d && Array.isArray(d.predict)) ? d.predict.length : 0) + '점</div>' +
             '<div class="dk-dots">' +
               '<u class="' + (rows.length ? 'on' : '') + '">측정</u>' +
               '<u class="' + (done ? 'on' : '') + '">' + esc(done ? '제출' : (st ? '작성 중' : '아직')) + '</u>' +
               '<u class="' + (qn ? 'on' : '') + '">개념 ' + qn + '</u>' +
               '<u class="' + (fbn ? 'on' : '') + '">별점 ' + fbn + '</u>' +
             '</div></div>';
      });
      h += '</div><p class="dk-sub">초록 칸이 끝난 것입니다. 모둠 ' + C.groups.length + '곳 가운데 ' +
           C.withRows.length + '곳이 측정값을 올렸습니다.</p>';
      return h;
    },

    overview: function (C) {
      var e = C.exp;
      if (!e) return empty('실험 도감에서 실험을 고르면 개요가 나타납니다.');
      var L = LABDB();
      var h = '<p style="font-size:1.15em;font-weight:800;margin:0 0 .3em">' + esc(e.title || '') + '</p>';
      var tags = [];
      if (e.grade) tags.push('중' + e.grade);
      if (e.unit) tags.push(e.unit);
      if (e.minutes) tags.push(e.minutes + '분');
      if (e.level) tags.push('난이도 ' + e.level);
      (e.sensors || []).forEach(function (s) {
        var nm = '';
        try { nm = (L && L.sensorName) ? L.sensorName(s.key) : (s.key || ''); } catch (err) { nm = s.key || ''; }
        tags.push((s.label || nm) + (s.n > 1 ? ' ×' + s.n : ''));
      });
      if (tags.length) {
        h += '<div class="dk-tags">';
        tags.forEach(function (t) { h += '<span class="dk-tag">' + esc(t) + '</span>'; });
        h += '</div>';
      }
      if (e.why) h += '<p class="dk-sub" style="margin-top:.5em">' + esc(e.why) + '</p>';
      var stds = Array.isArray(e.std) ? e.std : [];
      if (stds.length) {
        h += '<div style="margin-top:.6em">';
        stds.forEach(function (code) {
          var t = '';
          try { t = (L && L.stdText) ? (L.stdText(code) || '') : ''; } catch (err) { t = ''; }
          h += '<div class="dk-q"><b>' + esc(code) + '</b><div class="dk-a">' +
               esc(t || '(성취기준 원문을 찾지 못했습니다)') + '</div></div>';
        });
        h += '</div>';
      }
      return h;
    },

    prepare: function (C) {
      var e = C.exp;
      if (!e) return empty('실험을 고르면 준비물이 나타납니다.');
      var L = LABDB(), list = [];
      try { list = (L && L.prepFor) ? (L.prepFor(e, C.vendor) || []) : (e.prep || []); } catch (err) { list = e.prep || []; }
      if (!list.length) return empty('이 실험에는 적어 둔 준비물이 없습니다.');
      var h = '<ul class="dk-ul">';
      list.forEach(function (x) { h += '<li>' + esc(x) + '</li>'; });
      return h + '</ul>';
    },

    steps: function (C) {
      var e = C.exp;
      if (!e) return empty('실험을 고르면 절차가 나타납니다.');
      var L = LABDB(), list = [];
      try { list = (L && L.stepsFor) ? (L.stepsFor(e, C.vendor) || []) : (e.steps || []); } catch (err) { list = e.steps || []; }
      if (!list.length) return empty('이 실험에는 적어 둔 절차가 없습니다.');
      var h = '<div class="dk-steps">';
      list.forEach(function (x, i) { h += '<div class="dk-step"><i>' + (i + 1) + '</i><div>' + esc(x) + '</div></div>'; });
      return h + '</div>';
    },

    diagram: function (C) {
      var svg = figSVG('D', C.exp && FIG_DIAGRAM[C.exp.id]);
      if (!svg) return empty('이 실험에는 연결 그림이 준비되어 있지 않습니다.');
      return '<div class="dk-fig">' + svg + '</div><p class="dk-sub">센서를 어디에 어떻게 다는지 그림과 맞춰 보세요.</p>';
    },

    exgraph: function (C) {
      var k = C.exp && FIG_GRAPH[C.exp.id];
      var svg = figSVG('G', k);
      if (!svg) return empty('이 실험에는 결과 그래프 예시가 준비되어 있지 않습니다.');
      return '<div class="dk-fig">' + svg + '</div><p class="dk-sub">' +
             esc(GRAPH_CAP[k] || '이런 모양이 나오면 잘 된 것입니다.') + '</p>';
    },

    report: function (C) {
      if (!C.questions.length) return empty('보고서 문항이 아직 없습니다.');
      var h = '';
      C.questions.forEach(function (q, i) {
        var v = C.alignedAnswers[i];
        var txt = (v === undefined || v === null) ? '' : String(v);
        h += '<div class="dk-q"><b>' + (i + 1) + '. ' + esc(q.q || q.text || '') + '</b>' +
             '<div class="dk-a' + (txt.trim() ? '' : ' dk-no') + '">' +
             esc(txt.trim() ? txt : '(아직 쓰지 않았습니다)') + '</div></div>';
      });
      var st = (C.report && C.report.status) || '';
      h += '<p class="dk-sub">상태: ' + esc((st === 'done' || st === 'submitted') ? '제출함' : (st ? '작성 중' : '아직 저장 전')) +
           ' · 답한 문항 ' + C.answered + ' / ' + C.questions.length + '</p>';
      return h;
    },

    quiz: function (C) {
      var rowsQ = C.myQuiz.length ? C.myQuiz : ((C.role === 'teacher') ? C.quizAll : []);
      if (!rowsQ.length) return empty('개념 확인을 풀면 결과가 나타납니다.');
      var quizDef = Array.isArray(C.lesson.quiz) ? C.lesson.quiz : [];
      var h = '<div class="dk-bars">';
      rowsQ.forEach(function (r) {
        var sc = Number(r.score), mx = Number(r.max_score);
        var pct = (isFinite(sc) && isFinite(mx) && mx > 0) ? (sc / mx * 100) : 0;
        h += '<div class="dk-bar"><div class="dk-nm">' +
             esc((r.student_no ? r.student_no + '번 ' : '') + (r.student_name || '이름 없음')) + '</div>' +
             '<div class="dk-tr"><i style="width:' + pct.toFixed(1) + '%;background:' + (pct >= 60 ? ACC.ok : ACC.warn) + '"></i></div>' +
             '<div class="dk-sc">' + esc(isFinite(sc) ? sc : '—') + ' / ' + esc(isFinite(mx) ? mx : '—') + '</div></div>';
      });
      h += '</div>';
      //  정답이 실려 있을 때만(선생님 보드) 문항별 O/X 를 붙입니다
      if (quizDef.length && rowsQ.length === 1 && rowsQ[0].answers) {
        var g = gradeQuiz(quizDef, rowsQ[0].answers);
        if (g.results.length) {
          h += '<div class="dk-tw" style="margin-top:.5em"><table class="dk-t"><thead><tr><th>#</th><th>문항</th>' +
               '<th>낸 답</th><th>정답</th><th></th></tr></thead><tbody>';
          g.results.forEach(function (x) {
            h += '<tr><td>' + x.no + '</td><td class="dk-l">' + esc(x.q) + '</td>' +
                 '<td>' + esc(x.your === null ? '—' : x.your) + '</td>' +
                 '<td>' + esc(x.answer === null ? '—' : x.answer) + '</td>' +
                 '<td class="' + (x.correct ? 'dk-o' : (x.scored ? 'dk-x' : '')) + '">' +
                 (x.scored ? (x.correct ? 'O' : 'X') : '—') + '</td></tr>';
          });
          h += '</tbody></table></div>';
        }
      }
      return h;
    },

    quizdist: function (C) {
      var quizDef = Array.isArray(C.lesson.quiz) ? C.lesson.quiz : [];
      if (!quizDef.length) return empty('개념 확인 문항이 아직 없습니다.');
      if (!C.quizAll.length) return empty('아직 아무도 개념 확인을 풀지 않았습니다.');
      var tally = [];
      C.quizAll.forEach(function (r) {
        if (!r.answers) return;
        var g = gradeQuiz(quizDef, r.answers);
        g.results.forEach(function (x, i) {
          if (!tally[i]) tally[i] = { no: x.no, q: x.q, ok: 0, n: 0 };
          if (!x.scored) return;
          tally[i].n++;
          if (x.correct) tally[i].ok++;
        });
      });
      var any = tally.some(function (t) { return t && t.n; });
      if (!any) return empty('정답이 실려 있어야 정답률을 낼 수 있습니다(선생님 화면에서만 보입니다).');
      var h = '<div class="dk-bars">';
      tally.forEach(function (t) {
        if (!t) return;
        var pct = t.n ? (t.ok / t.n * 100) : 0;
        h += '<div class="dk-bar"><div class="dk-nm" title="' + esc(t.q) + '">' + t.no + '. ' +
             esc(String(t.q).slice(0, 14)) + '</div>' +
             '<div class="dk-tr"><i style="width:' + pct.toFixed(1) + '%;background:' +
             (pct >= 70 ? ACC.ok : (pct >= 40 ? ACC.warn : ACC.bad)) + '"></i></div>' +
             '<div class="dk-sc">' + pct.toFixed(0) + '% (' + t.ok + '/' + t.n + ')</div></div>';
      });
      h += '</div><p class="dk-sub">낮은 문항이 다음 시간에 다시 짚을 곳입니다. 응시 ' + C.quizAll.length + '건.</p>';
      return h;
    },

    eval: function (C) {
      var e = C.evalObj;
      if (!e) return empty('선생님이 루브릭으로 평가하면 나타납니다.');
      var rub = Array.isArray(e.rubric) ? e.rubric : [];
      var sc  = Array.isArray(e.scores) ? e.scores : [];
      var h = '';
      if (rub.length) {
        h += '<div class="dk-bars">';
        rub.forEach(function (it, i) {
          var item = (it && typeof it === 'object') ? it : { name: it };
          var mx = Number(item.max), v = Number(sc[i]);
          var pct = (isFinite(mx) && mx > 0 && isFinite(v)) ? (v / mx * 100) : 0;
          h += '<div class="dk-bar"><div class="dk-nm">' + esc(item.name || '항목') + '</div>' +
               '<div class="dk-tr"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
               '<div class="dk-sc">' + esc(isFinite(v) ? v : '—') + ' / ' + esc(isFinite(mx) ? mx : '—') + '</div></div>';
        });
        h += '</div>';
      }
      if (e.total !== null && e.total !== undefined && isFinite(Number(e.total))) {
        h += '<p style="margin-top:.6em;font-weight:800">합계 ' + esc(fmtNum(e.total)) +
             (isFinite(Number(e.max)) ? ' / ' + esc(fmtNum(e.max)) : '') + '</p>';
      }
      if (e.feedback) h += '<div class="dk-note" style="margin-top:.5em">' + esc(e.feedback) + '</div>';
      if (e.by || e.at) h += '<p class="dk-sub">' + esc([e.by, e.at].filter(Boolean).join(' · ')) + '</p>';
      return h || empty('평가 내용이 비어 있습니다.');
    },

    ai: function (C) {
      if (!C.ai.length) return empty('AI 와 협업한 탐구를 기록하면 나타납니다.');
      var h = '';
      C.ai.forEach(function (a, i) {
        h += '<div class="dk-q"><b>' + (i + 1) + '. ' + esc(a.phaseName || a.phase || 'AI 협업') + '</b>';
        if (a.myView)  h += '<div class="dk-a">내 생각 · ' + esc(a.myView) + '</div>';
        if (a.prompt)  h += '<div class="dk-a" style="opacity:.85">AI 에게 부탁한 말 · ' + esc(a.prompt) + (a.edited ? ' (내가 고쳐 씀)' : '') + '</div>';
        if (a.claim)   h += '<div class="dk-a">AI 의 주장 · ' + esc(a.claim) + '</div>';
        if (a.verdict) h += '<div class="dk-a">우리 데이터로 검증 · ' + esc(a.verdict) + (a.why ? ' — ' + esc(a.why) : '') + '</div>';
        h += '</div>';
      });
      h += '<p class="dk-sub">AI 말을 그대로 옮기지 않고 우리 데이터로 확인한 것이 이 기록의 알맹이입니다.</p>';
      return h;
    },

    stars: function (C) {
      if (!C.fbIn.length) return empty('다른 모둠에게 별점·칭찬을 받으면 나타납니다.');
      var sum = 0, cmts = [];
      C.fbIn.forEach(function (f) {
        sum += Number(f.stars) || 0;
        if (f.comment) cmts.push(String(f.comment));
      });
      var avg = sum / C.fbIn.length;
      var full = Math.round(avg), starTxt = '';
      for (var i = 0; i < 5; i++) starTxt += (i < full) ? '★' : '☆';
      var h = '<div class="dk-vals"><div class="dk-v"><b>받은 별점 평균</b>' +
              '<em style="color:' + ACC.sun + '">' + esc(avg.toFixed(1)) + '</em><span>/ 5</span>' +
              '<div class="dk-star" style="font-size:1.2em;margin-top:.2em">' + starTxt + '</div></div>' +
              '<div class="dk-v"><b>받은 개수</b><em>' + C.fbIn.length + '</em><span>건</span></div></div>';
      if (cmts.length) {
        h += '<div style="margin-top:.6em">';
        cmts.forEach(function (c) { h += '<div class="dk-note" style="margin:.35em 0">' + esc(c) + '</div>'; });
        h += '</div>';
      }
      return h;
    },

    bigtitle: function (C, cfg) {
      return '<div class="dk-title">' + esc((cfg && cfg.text) || C.title || '실험 대시보드') + '</div>';
    },
    memo: function (C, cfg) {
      var t = (cfg && cfg.text) || '';
      if (!t) return empty('메모 글을 적어 보세요.');
      return '<div class="dk-note">' + esc(t) + '</div>';
    },
    divider: function () { return '<hr class="dk-hr" />'; }
  };

  // ── 변환 그래프용 열·점 (데이터 실험실의 labCols·rawVal·labPoints 와 같은 규칙) ──
  function colList(C, derived) {
    var out = [{ k: 'x', label: C.xLabel, unit: C.xUnit }];
    C.series.forEach(function (s, i) { out.push({ k: 's' + i, label: seriesLabel(C, i), unit: seriesUnit(C, i) }); });
    (derived || []).forEach(function (d) { out.push({ k: d.id, label: d.name, unit: d.unit || '', made: true }); });
    return out;
  }
  function colOf(cols, k) {
    for (var i = 0; i < cols.length; i++) if (cols[i].k === k) return cols[i];
    return null;
  }
  function colName(c) { return (c && c.label) || ''; }
  function rawVal(row, k, derived) {
    if (!k) return NaN;
    if (k === 'x') return cellAt(row, 0);
    if (k.charAt(0) === 's') return cellAt(row, Number(k.slice(1)) + 1);
    var d = null;
    for (var i = 0; i < (derived || []).length; i++) if (derived[i].id === k) d = derived[i];
    if (!d) return NaN;
    var a = rawVal(row, d.a, derived), b = rawVal(row, d.b, derived);
    if (!isFinite(a) || !isFinite(b)) return NaN;
    if (d.op === '×') return a * b;
    if (d.op === '÷') return (b === 0) ? NaN : (a / b);     // 0 으로 나누는 칸은 건너뜁니다
    if (d.op === '+') return a + b;
    return a - b;
  }
  function colMin(rows, k, derived) {
    var m = null;
    (rows || []).forEach(function (r) {
      var v = rawVal(r, k, derived);
      if (isFinite(v) && (m === null || v < m)) m = v;
    });
    return (m === null) ? 0 : m;
  }
  function tfPoints(rows, derived, xk, xt, yk, yt) {
    var tx = TF[xt] || TF.none, ty = TF[yt] || TF.none;
    var mx = tx.needMin ? colMin(rows, xk, derived) : 0;
    var my = ty.needMin ? colMin(rows, yk, derived) : 0;
    var out = { pts: [], skipped: 0, missing: 0 };
    (rows || []).forEach(function (r) {
      var a = rawVal(r, xk, derived), b = rawVal(r, yk, derived);
      if (!isFinite(a) || !isFinite(b)) { out.missing++; return; }   // 빈 칸 — 원래 없는 값입니다
      if (!tx.ok(a) || !ty.ok(b)) { out.skipped++; return; }
      var X = tx.f(a, mx), Y = ty.f(b, my);
      if (!isFinite(X) || !isFinite(Y)) { out.skipped++; return; }
      out.pts.push({ x: X, y: Y });
    });
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  8. renderBlock · render · standalone
  // ─────────────────────────────────────────────────────────────────
  var WIDTHS = [{ w: 4, name: '1칸' }, { w: 6, name: '2칸' }, { w: 12, name: '전체' }];
  function normW(w) {
    w = Number(w);
    return (w === 4 || w === 6 || w === 12) ? w : 12;
  }

  function renderBlock(key, ctx, opt) {
    opt = opt || {};
    var B = BMAP[key];
    var w = normW(opt.w || (B && B.w) || 12);
    var cfg = opt.cfg || {};
    var body, name;

    if (!B) {
      body = empty('모르는 블록입니다: ' + key);
      name = '?';
    } else {
      var C = prep(ctx);
      var can = canUse(key, ctx);
      try {
        body = can.ok ? BODY[key](C, cfg) : empty(can.why);
      } catch (e) {
        //  자료가 부실해도 깨지지 않게 — 빈 자리 대신 까닭을 그립니다.
        body = empty('이 블록을 그리다 막혔습니다. 자료를 확인해 주세요.');
      }
      name = (cfg.title !== undefined && cfg.title !== null && String(cfg.title).trim())
           ? String(cfg.title) : B.name;
    }
    if (opt.bare) return body;

    var plain = (key === 'bigtitle' || key === 'divider' || (key === 'memo' && cfg.noHead));
    var head = (plain || cfg.noHead) ? '' : '<h3 class="dk-h">' + esc(name) + '</h3>';
    return '<section class="dk-b' + (plain ? ' dk-plain' : '') + '" data-w="' + w + '">' + head + body + '</section>';
  }

  function emptyLayout() { return { theme: 'light', title: '', items: [] }; }

  function normLayout(layout) {
    var L = (layout && typeof layout === 'object') ? layout : {};
    var out = {
      theme: THEMES[L.theme] ? L.theme : 'light',
      title: String(L.title === null || L.title === undefined ? '' : L.title),
      subtitle: String(L.subtitle === null || L.subtitle === undefined ? '' : L.subtitle),
      items: []
    };
    (Array.isArray(L.items) ? L.items : []).forEach(function (it) {
      if (!it) return;
      var key = (typeof it === 'string') ? it : it.key;
      if (!BMAP[key]) return;
      out.items.push({
        key: key,
        w: normW(it.w || BMAP[key].w),
        cfg: (it.cfg && typeof it.cfg === 'object') ? it.cfg : {}
      });
    });
    return out;
  }

  //  머리말 — 만든 시각 · 학교 · 반 · 모둠 · 실험명
  function headerHTML(C, L, when) {
    var bits = [];
    if (C.school) bits.push(esc(C.school));
    if (C.classLabel) bits.push(esc(C.classLabel));
    if (C.groupName) bits.push(esc(C.groupName));
    if (C.members.length) bits.push(esc(C.members.join(' · ')));
    if (C.teacher) bits.push(esc(C.teacher) + ' 선생님');
    var line2 = [];
    if (C.exp && C.exp.id) line2.push('실험 ' + esc(C.exp.id));
    line2.push('만든 때 ' + esc(stamp(when)));
    if (C.rows.length) line2.push('측정 ' + C.rows.length + '줄');
    return '<header class="dk-head"><h1>' + esc(L.title || C.title || '실험 대시보드') + '</h1>' +
           '<div class="dk-meta">' + (bits.length ? bits.join(' · ') + '<br />' : '') + line2.join(' · ') +
           (L.subtitle ? '<br />' + esc(L.subtitle) : '') + '</div></header>';
  }

  //  대시보드 전체 → HTML 문자열 (앱 안에서도, 내보낸 파일에서도 같은 것을 씁니다)
  function render(layout, ctx, opt) {
    opt = opt || {};
    var L = normLayout(layout);
    var C = prep(ctx);
    var T = theme(L.theme);
    var when = opt.when || new Date();
    var inner = '';
    if (opt.head !== false) inner += headerHTML(C, L, when);
    if (!L.items.length) {
      inner += '<div class="dk-empty">아직 고른 블록이 없습니다. 위에서 <b>짜임</b>을 고르거나 <b>블록 추가</b>를 눌러 보세요.</div>';
    } else {
      inner += '<div class="dk-grid">';
      L.items.forEach(function (it) { inner += renderBlock(it.key, ctx, { w: it.w, cfg: it.cfg }); });
      inner += '</div>';
    }
    if (opt.foot !== false) {
      inner += '<div class="dk-foot">MBL 센서 수업허브 · 이 대시보드는 우리 반이 실제로 모은 자료로 만들었습니다.<br />' +
               '© 2026 조승재(과학이조선생)' + (C.school ? ' · ' + esc(C.school) : '') + '</div>';
    }
    return '<div class="dk-root dk-t-' + esc(T.key) + '" style="' + themeVars(T) + '">' + inner + '</div>';
  }

  //  혼자 열리는 HTML 파일 전문 — 외부 자원 0 · 실행 스크립트 0 · 인쇄하면 PDF
  function standalone(layout, ctx, opt) {
    opt = opt || {};
    var L = normLayout(layout);
    var C = prep(ctx);
    var when = opt.when || new Date();
    var title = (L.title || C.title || '실험 대시보드') +
                (C.groupName ? ' · ' + C.groupName : '') +
                (C.classLabel ? ' (' + C.classLabel + ')' : '');
    //  ★ 심는 부분 — 나중에 다시 불러 고칠 수 있게 합니다(작업 파일과 같은 방식).
    var seed = {
      kind: 'mbl-dashboard', v: 1, at: when.toISOString(), layout: L,
      lesson: { title: C.title, classLabel: C.classLabel, expId: (C.exp && C.exp.id) || '',
                group: C.groupName, school: C.school }
    };
    var json = JSON.stringify(seed).replace(/<\//g, '<\\/');
    return '<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8" />\n' +
           '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
           '<title>' + esc(title) + '</title>\n' +
           '<style>\n' +
           'html,body{margin:0;padding:0;background:' + theme(L.theme).bg + '}\n' +
           'body{padding:14px 10px}\n.dk-wrap{max-width:1120px;margin:0 auto}\n' +
           '@media print{body{padding:0;background:#fff}}\n' +
           css(L.theme) + '\n</style>\n</head>\n<body>\n' +
           '<div class="dk-wrap">' + render(L, ctx, { when: when }) + '</div>\n' +
           '<script type="application/json" id="mbl-dash">' + json + '<\/script>\n' +
           '</body>\n</html>\n';
  }

  //  내보낸 파일에서 설정 다시 읽기 (HTML 을 통째로 파싱하지 않고 심어 둔 글만 뽑습니다)
  function readLayout(text) {
    var m = String(text || '').match(/<script[^>]*id=["']mbl-dash["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try {
      var o = JSON.parse(m[1].replace(/<\\\//g, '</'));
      return (o && o.layout) ? normLayout(o.layout) : null;
    } catch (e) { return null; }
  }

  //  파일 이름은 시스템이 짓습니다 — 대시보드_2학년3반_3모둠_물과식용유의비열비교_20260823.html
  function fileName(ctx, layout) {
    var C = prep(ctx);
    var clean = function (s) {
      return String(s === null || s === undefined ? '' : s).replace(/[\\/:*?"<>|.\s]+/g, '').slice(0, 26);
    };
    var cls = clean(C.classLabel) || '반없음';
    var grp = clean(C.groupName) || (C.groupNo ? (C.groupNo + '모둠') : '우리모둠');
    var exp = clean((layout && layout.title) || C.title) || '실험';
    return '대시보드_' + cls + '_' + grp + '_' + exp + '_' + today8() + '.html';
  }

  // ─────────────────────────────────────────────────────────────────
  //  9. 짜임 고르기(preset) — 백지에서 시작하지 않게
  // ─────────────────────────────────────────────────────────────────
  var PRESETS = [
    { key: 'monitor',  name: '측정 현황판', theme: 'light',
      desc: '지금 값이 어떤지 한 화면에서 봅니다.',
      want: [['value', 12], ['line', 12], ['stats', 6], ['table', 6], ['fit', 6], ['predict', 12]] },
    { key: 'report',   name: '우리 모둠 보고서', theme: 'light',
      desc: '개요 · 그래프 · 문답 · 평가를 한 장에.',
      want: [['overview', 6], ['diagram', 6], ['line', 12], ['stats', 6], ['fit', 6],
             ['predict', 12], ['report', 12], ['ai', 12], ['eval', 6], ['stars', 6]] },
    { key: 'classcmp', name: '반 전체 비교', theme: 'light',
      desc: '모둠을 겹쳐 그리고 순위와 우리 위치를 봅니다.',
      want: [['classLines', 12], ['rank', 6], ['mypos', 6], ['progress', 12], ['quizdist', 6]] },
    { key: 'board',    name: '전자칠판용(큰 글씨)', theme: 'big',
      desc: '멀리서도 보이게 큰 글씨로.',
      want: [['bigtitle', 12], ['value', 12], ['line', 12], ['classLines', 12], ['rank', 6], ['mypos', 6]] }
  ];

  function presets(ctx) {
    var out = [];
    PRESETS.forEach(function (P) {
      var items = [];
      P.want.forEach(function (pair) {
        if (canUse(pair[0], ctx).ok) items.push({ key: pair[0], w: pair[1], cfg: {} });
      });
      out.push({
        key: P.key, name: P.name, desc: P.desc, ready: items.length,
        layout: { theme: P.theme, title: '', items: items }
      });
    });
    //  하나도 못 채우는 상황이면 — 측정 전에도 쓸 수 있는 것부터 시작할 수 있게 합니다
    var anyReady = out.some(function (p) { return p.ready > 0; });
    if (!anyReady) {
      var fall = [];
      ['overview', 'prepare', 'steps', 'diagram', 'exgraph'].forEach(function (k) {
        if (canUse(k, ctx).ok) fall.push({ key: k, w: BMAP[k].w, cfg: {} });
      });
      if (!fall.length) fall.push({ key: 'bigtitle', w: 12, cfg: {} });
      out.unshift({ key: 'start', name: '실험 안내로 시작', ready: fall.length,
                    desc: '측정값이 아직 없어도 쓸 수 있는 것부터.',
                    layout: { theme: 'light', title: '', items: fall } });
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  10. 빌더 UI — mount
  //    드래그를 쓰지 않습니다. 이 앱은 전자칠판·터치에서 쓰이고,
  //    질문·절차 편집기가 이미 ▲▼ 방식이라 같은 방식으로 통일합니다.
  // ─────────────────────────────────────────────────────────────────
  var UI_CSS_ID = 'dk-ui-css';
  function uiCSS() {
    return [
      '.dkui{color:var(--ink,#254753)}',
      '.dkui .dkui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}',
      '.dkui .dkui-lab{font-size:13px;font-weight:800;color:var(--muted,#6E8A96);margin-right:2px}',
      '.dkui button{font:inherit;cursor:pointer;border-radius:10px;border:1.5px solid var(--line-2,#D3E6EA);' +
        'background:var(--paper,#fff);color:var(--ink,#254753);padding:7px 12px;font-size:13.5px;font-weight:700}',
      '.dkui button:hover{border-color:var(--mint,#20B2A6)}',
      '.dkui button.on{background:var(--mint,#20B2A6);border-color:var(--mint,#20B2A6);color:#fff}',
      '.dkui button.dkui-go{background:var(--mint,#20B2A6);border-color:var(--mint,#20B2A6);color:#fff}',
      '.dkui button[disabled]{opacity:.45;cursor:not-allowed}',
      '.dkui .dkui-cols{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:14px;align-items:start}',
      '@media (max-width:900px){.dkui .dkui-cols{grid-template-columns:1fr}}',
      '.dkui .dkui-panel{background:var(--paper,#fff);border:1.5px solid var(--line,#E4EFF1);border-radius:16px;padding:12px}',
      '.dkui .dkui-item{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1.5px solid var(--line,#E4EFF1);' +
        'border-radius:12px;padding:8px 10px;margin:6px 0;background:var(--cream,#FFFDF6)}',
      '.dkui .dkui-item .dkui-nm{flex:1 1 8em;font-size:13.5px;font-weight:800;min-width:6em}',
      '.dkui .dkui-item .dkui-warn{flex:1 1 100%;font-size:12px;color:var(--warn,#E8873C);font-weight:700}',
      '.dkui .dkui-item button{padding:4px 9px;font-size:12.5px;border-radius:8px}',
      '.dkui .dkui-pal{margin-top:8px;border-top:1.5px dashed var(--line-2,#D3E6EA);padding-top:8px}',
      '.dkui .dkui-gname{font-size:12.5px;font-weight:800;color:var(--mint-d,#14867C);margin:8px 0 4px}',
      '.dkui .dkui-p{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;border-radius:10px;' +
        'border:1.5px solid var(--line,#E4EFF1);background:var(--paper,#fff)}',
      '.dkui .dkui-p b{display:block;font-size:13.5px}',
      '.dkui .dkui-p small{display:block;font-size:11.5px;color:var(--muted,#6E8A96);font-weight:600;line-height:1.5;margin-top:2px}',
      '.dkui .dkui-p.off{opacity:.55}',
      '.dkui .dkui-p.off small{color:var(--warn,#E8873C)}',
      '.dkui .dkui-prev{background:var(--paper,#fff);border:1.5px solid var(--line,#E4EFF1);border-radius:16px;' +
        'padding:8px;overflow:auto;max-height:74vh}',
      '.dkui .dkui-prev.dkui-full{position:fixed;inset:0;z-index:9999;max-height:none;border-radius:0;padding:12px}',
      '.dkui .dkui-msg{font-size:12.5px;color:var(--muted,#6E8A96);margin:6px 0 0;min-height:1.2em}',
      '.dkui textarea.dkui-tx{width:100%;font:inherit;font-size:13px;border:1.5px solid var(--line-2,#D3E6EA);' +
        'border-radius:8px;padding:6px 8px;resize:vertical;min-height:3.2em;background:var(--paper,#fff);color:inherit}'
    ].join('\n');
  }

  function ensureStyle(doc, id, text) {
    if (!doc) return null;
    var st = doc.getElementById(id);
    if (!st) {
      st = doc.createElement('style');
      st.id = id;
      (doc.head || doc.documentElement).appendChild(st);
    }
    if (text !== null && text !== undefined) st.textContent = text;
    return st;
  }

  function mount(el, ctx, opt) {
    opt = opt || {};
    var w = W();
    if (!el || !w || !w.document) return null;
    var doc = el.ownerDocument || w.document;
    var THEME_CSS_ID = 'dk-theme-css';

    ensureStyle(doc, UI_CSS_ID, uiCSS());

    var L = normLayout(opt.layout || (ctx && ctx.layout) || emptyLayout());

    el.classList.add('dkui');
    el.innerHTML =
      '<div class="dkui-row" data-dk="presets"></div>' +
      '<div class="dkui-cols">' +
        '<div class="dkui-panel">' +
          '<div class="dkui-row" data-dk="themes"></div>' +
          '<div data-dk="items"></div>' +
          '<div class="dkui-row" style="margin-top:8px">' +
            '<button type="button" data-dk="addToggle">+ 블록 추가</button>' +
            '<button type="button" data-dk="clear">모두 지우기</button>' +
          '</div>' +
          '<div class="dkui-pal" data-dk="palette" hidden></div>' +
        '</div>' +
        '<div>' +
          '<div class="dkui-row">' +
            '<button type="button" class="dkui-go" data-dk="save">HTML 파일로 저장</button>' +
            '<button type="button" data-dk="keep">이 구성 저장</button>' +
            '<button type="button" data-dk="full">전체 화면</button>' +
            '<button type="button" data-dk="print">인쇄 · PDF</button>' +
            '<button type="button" data-dk="ai">이 대시보드를 AI 와 함께 해석하기</button>' +
          '</div>' +
          '<div class="dkui-prev" data-dk="prev"></div>' +
          '<p class="dkui-msg" data-dk="msg"></p>' +
        '</div>' +
      '</div>';

    var $ = function (k) { return el.querySelector('[data-dk="' + k + '"]'); };
    function note(t) { $('msg').textContent = t || ''; }

    function paintThemes() {
      var h = '<span class="dkui-lab">테마</span>';
      ['light', 'dark', 'big'].forEach(function (k) {
        h += '<button type="button" data-dk="theme" data-k="' + k + '"' + (L.theme === k ? ' class="on"' : '') + '>' +
             esc(THEMES[k].name) + '</button>';
      });
      $('themes').innerHTML = h;
    }

    var psCache = [];
    function paintPresets() {
      psCache = presets(ctx);
      var h = '<span class="dkui-lab">짜임 고르기</span>';
      psCache.forEach(function (p) {
        h += '<button type="button" data-dk="preset" data-k="' + esc(p.key) + '" title="' + esc(p.desc) + '">' +
             esc(p.name) + ' <span style="opacity:.65;font-weight:600">(' + p.ready + ')</span></button>';
      });
      $('presets').innerHTML = h;
    }

    function paintItems() {
      var h = '';
      if (!L.items.length) {
        h = '<p class="dkui-msg">아직 블록이 없습니다. 위에서 짜임을 고르거나 아래 <b>+ 블록 추가</b>를 눌러 보세요.</p>';
      }
      L.items.forEach(function (it, i) {
        var B = BMAP[it.key], can = canUse(it.key, ctx);
        h += '<div class="dkui-item">' +
             '<span class="dkui-nm">' + esc(B.name) + '</span>' +
             '<button type="button" data-dk="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
             '<button type="button" data-dk="down" data-i="' + i + '"' + (i === L.items.length - 1 ? ' disabled' : '') + '>▼</button>';
        WIDTHS.forEach(function (x) {
          h += '<button type="button" data-dk="w" data-i="' + i + '" data-w="' + x.w + '"' +
               (it.w === x.w ? ' class="on"' : '') + '>' + x.name + '</button>';
        });
        h += '<button type="button" data-dk="del" data-i="' + i + '">삭제</button>';
        if (it.key === 'bigtitle' || it.key === 'memo') {
          h += '<textarea class="dkui-tx" data-dk="text" data-i="' + i + '" placeholder="' +
               (it.key === 'bigtitle' ? '큰 제목에 쓸 글' : '메모로 적을 글') + '">' + esc(it.cfg.text || '') + '</textarea>';
        }
        if (!can.ok) h += '<span class="dkui-warn">' + esc(can.why) + '</span>';
        h += '</div>';
      });
      $('items').innerHTML = h;
    }

    function paintPalette() {
      var h = '';
      GROUPS.forEach(function (g) {
        var shown = '';
        BLOCKS.forEach(function (b) {
          if (b.group !== g) return;
          var can = canUse(b.key, ctx);
          shown += '<button type="button" class="dkui-p' + (can.ok ? '' : ' off') + '" data-dk="add" data-k="' + esc(b.key) + '"' +
                   (can.ok ? '' : ' disabled') + '><b>' + esc(b.name) + '</b><small>' +
                   esc(can.ok ? b.desc : can.why) + '</small></button>';
        });
        if (shown) h += '<div class="dkui-gname">' + esc(g) + '</div>' + shown;
      });
      $('palette').innerHTML = h;
    }

    function paintPrev() {
      //  미리보기는 진짜 데이터로 그립니다 — 데모 데이터는 쓰지 않습니다.
      ensureStyle(doc, THEME_CSS_ID, css(L.theme));
      $('prev').innerHTML = render(L, ctx);
    }

    function repaint() {
      try { delete ctx.__dk; } catch (e) { ctx.__dk = null; }   // 새로 세도록 캐시를 비웁니다
      paintThemes(); paintPresets(); paintItems(); paintPalette(); paintPrev();
    }

    function fire(name) {
      if (typeof opt[name] !== 'function') return;
      try { opt[name](JSON.parse(JSON.stringify(L)), ctx); } catch (e) {}
    }

    function doSave() {
      var html = standalone(L, ctx);
      var name = fileName(ctx, L);
      try {
        var blob = new w.Blob([html], { type: 'text/html;charset=utf-8' });
        var url = w.URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url; a.download = name;
        doc.body.appendChild(a); a.click(); a.remove();
        w.setTimeout(function () { w.URL.revokeObjectURL(url); }, 4000);
        note('내려받았습니다 — ' + name + ' (' + Math.round(blob.size / 1024) + 'KB). ' +
             '파일 하나만 열면 그대로 보이고, 인쇄하면 PDF 가 됩니다.');
      } catch (e) {
        note('파일을 만들지 못했습니다. 브라우저가 내려받기를 막고 있지 않은지 확인해 주세요.');
      }
      fire('onExport');
    }

    el.addEventListener('click', function (ev) {
      var btn = ev.target;
      while (btn && btn !== el && !(btn.getAttribute && btn.getAttribute('data-dk'))) btn = btn.parentNode;
      if (!btn || btn === el || !btn.getAttribute) return;
      var k = btn.getAttribute('data-dk');
      var i = Number(btn.getAttribute('data-i'));

      if (k === 'theme') { L.theme = btn.getAttribute('data-k'); repaint(); return; }
      if (k === 'preset') {
        for (var n = 0; n < psCache.length; n++) {
          if (psCache[n].key !== btn.getAttribute('data-k')) continue;
          L = normLayout(psCache[n].layout);
          repaint();
          note(psCache[n].name + ' 짜임을 불러왔습니다 · 블록 ' + L.items.length + '개');
          return;
        }
        return;
      }
      if (k === 'addToggle') { $('palette').hidden = !$('palette').hidden; return; }
      if (k === 'add') {
        var key = btn.getAttribute('data-k');
        if (!BMAP[key]) return;
        L.items.push({ key: key, w: BMAP[key].w, cfg: {} });
        repaint();
        note(BMAP[key].name + ' 을(를) 더했습니다.');
        return;
      }
      if (k === 'up' && i > 0) {
        var a = L.items[i - 1]; L.items[i - 1] = L.items[i]; L.items[i] = a; repaint(); return;
      }
      if (k === 'down' && i < L.items.length - 1) {
        var b = L.items[i + 1]; L.items[i + 1] = L.items[i]; L.items[i] = b; repaint(); return;
      }
      if (k === 'w')     { if (L.items[i]) { L.items[i].w = normW(btn.getAttribute('data-w')); repaint(); } return; }
      if (k === 'del')   { L.items.splice(i, 1); repaint(); return; }
      if (k === 'clear') { L.items = []; repaint(); note('블록을 모두 지웠습니다.'); return; }
      if (k === 'full') {
        var box = $('prev');
        if (box.requestFullscreen) {
          try { box.requestFullscreen().catch(function () { box.classList.toggle('dkui-full'); }); }
          catch (e) { box.classList.toggle('dkui-full'); }
        } else { box.classList.toggle('dkui-full'); }
        return;
      }
      if (k === 'print') { w.print(); return; }
      if (k === 'keep')  { fire('onSave'); note('이 구성을 저장했습니다.'); return; }
      if (k === 'ai')    { fire('onAI'); return; }
      if (k === 'save')  { doSave(); return; }
    });

    el.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute || t.getAttribute('data-dk') !== 'text') return;
      var i = Number(t.getAttribute('data-i'));
      if (!L.items[i]) return;
      L.items[i].cfg.text = t.value;
      paintPrev();
    });

    repaint();

    return {
      get: function () { return JSON.parse(JSON.stringify(L)); },
      set: function (layout) { L = normLayout(layout); repaint(); },
      refresh: function (newCtx) { if (newCtx) ctx = newCtx; repaint(); },
      html: function () { return render(L, ctx); },
      file: function () { return { name: fileName(ctx, L), html: standalone(L, ctx) }; },
      describe: function () { return describe(L, ctx); },
      note: note,
      destroy: function () { el.innerHTML = ''; el.classList.remove('dkui'); }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  11. AI 협업으로 넘길 때 붙일 요약 — 지금 보고 있는 구성이 담깁니다
  // ─────────────────────────────────────────────────────────────────
  function describe(layout, ctx) {
    var L = normLayout(layout), C = prep(ctx);
    var lines = [];
    lines.push('[대시보드 구성] ' + (L.title || C.title));
    if (C.classLabel || C.groupName) lines.push('- ' + [C.classLabel, C.groupName].filter(Boolean).join(' · '));
    lines.push('- 블록: ' + (L.items.length ? L.items.map(function (it) { return BMAP[it.key].name; }).join(', ') : '없음'));
    if (C.rows.length) {
      lines.push('- 측정 ' + C.rows.length + '줄 · 가로축 ' + C.xLabel + (C.xUnit ? '(' + C.xUnit + ')' : ''));
      C.series.forEach(function (s, i) {
        var st = stats(C.rows, i);
        lines.push('  · ' + seriesLabel(C, i) + (seriesUnit(C, i) ? '(' + seriesUnit(C, i) + ')' : '') +
                   ': 처음 ' + sciNum(st.first) + ' → 마지막 ' + sciNum(st.last) +
                   (st.slope === null ? ''
                     : (' · 기울기 ' + sciNum(st.slope) + ' ' + slopeUnit(seriesUnit(C, i), C.xUnit) +
                        ' · R² ' + fmtR2(st.r2))));
      });
    }
    if (C.withRows.length > 1) lines.push('- 반 전체: 자료를 올린 모둠 ' + C.withRows.length + '곳');
    if (C.predict.length) lines.push('- 예상 그래프를 ' + C.predict.length + '점 그려 두었습니다.');
    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────
  return {
    VERSION: '1.0',
    BLOCKS: BLOCKS,
    GROUPS: GROUPS,
    WIDTHS: WIDTHS,
    THEMES: THEMES,
    TF: TF,
    canUse: canUse,
    presets: presets,
    renderBlock: renderBlock,
    render: render,
    standalone: standalone,
    mount: mount,
    css: css,
    fileName: fileName,
    readLayout: readLayout,
    emptyLayout: emptyLayout,
    normLayout: normLayout,
    describe: describe,
    //  검증·재사용을 위해 열어 두는 순수 함수들
    _prep: prep, _chart: chart, _esc: esc
  };
});
