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
             bg: '#F4FBF6', paper: '#FFFFFF', cream: '#FFFDF6', ink: '#254753', muted: '#56707C',
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
      R + ' .dk-step i{flex:0 0 1.5em;height:1.5em;border-radius:50%;background:' + ACC.mintD + ';color:#fff;' +
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
      //  가로축 이름(자리·조건 따위)을 함께 들고 갑니다 — 이름 가로축 그래프가 씁니다.
      var raw = Array.isArray(r) ? r[0] : ((r && typeof r === 'object') ? r.x : '');
      a.lab = (raw === null || raw === undefined) ? '' : String(raw).trim();
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

    //  모둠마다 다른 조건을 맡긴 수업이면(form.assign 이 가로축 값이 아니면) 모둠 이름 옆에 그 조건을 붙입니다.
    var asg = (lesson.form && lesson.form.assign && typeof lesson.form.assign === 'object') ? lesson.form.assign : null;
    var asgCond = !!(asg && Array.isArray(asg.groups) && asg.groups.length && !asg.x);
    function condOf(no) {
      if (!asgCond || !(no >= 1)) return '';
      return String(asg.groups[(no - 1) % asg.groups.length] == null ? '' : asg.groups[(no - 1) % asg.groups.length]).trim();
    }
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
        //  모둠이 맡은 조건 — 합친 작업 파일이 들고 온 것(assigned)이 먼저, 없으면 수업의 assign(조건일 때만)
        cond: (groups[k].assigned ? String(groups[k].assigned) : '') || condOf(Number(groups[k].group_no) || (k + 1)),
        rows: rr, note: (d && d.note) || '',
        //  ctx.noMine — 교사 대시보드처럼 「우리 모둠」이 없는 화면에서는 어느 모둠도 굵게 하지 않습니다.
        mine: !ctx.noMine && String(groups[k].id) === gid,
        color: GROUP_HEX[k % GROUP_HEX.length]
      });
    }

    //  가로축이 이름인가(자리·조건) — 막대그래프인데 가로축 단위가 없거나, 숫자로 못 읽는 가로축 값이 있으면
    var catX = (spec.chart === 'bar' && !(spec.x && spec.x.unit));
    if (!catX) {
      withRows.concat([{ rows: rows }]).forEach(function (G) {
        G.rows.forEach(function (r) { if (r[0] === null && r.lab) catX = true; });
      });
    }
    var C = {
      board: b, lesson: lesson, exp: exp, spec: spec, series: series, catX: catX, assign: asg, assignCond: asgCond,
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
      labs: (Array.isArray(ctx.labs) && ctx.labs.length) ? ctx.labs : null,   // 실험실 그래프 여러 장(있으면 tf 블록이 전부 그립니다)
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
  //  4. 그래프 — index.html 의 chartSVG 가 있으면 그것을, 없으면 여기 것을
  //     교사 화면·발표 화면도 여기 것(DashKit.chartSVG · DashKit.multiChart)을 그대로 씁니다.
  //   그래프 약속 (학생 화면과 같습니다)
  //    · 단위가 다른 계열은 오른쪽 둘째 축에 그립니다(축은 둘까지). 축 제목에는 단위를 붙입니다.
  //    · 계산 열(이름에 × · ÷ 가 있거나 calc:true)은 기본으로 그리지 않습니다(opt.showCalc 로 켭니다).
  //    · 눈금은 1·2·5 간격으로 끊고, 값이 모두 0 이상이면 음수 눈금을 만들지 않습니다.
  //    · 분석 레시피가 곡선 관계(1/x · √x · x² · log)를 기대하는 실험은 직선 추세선 대신
  //      바꾼 축에서 맞춘 곡선을 그립니다(예: 보일 법칙 sm-05 — 압력과 1/부피가 비례).
  // ─────────────────────────────────────────────────────────────────
  function chart(sp, rows, opt) {
    opt = opt || {};
    var w = W();
    if (w && typeof w.chartSVG === 'function') {
      try {
        var out = w.chartSVG(sp, rows, opt);
        if (out) return out;
      } catch (e) { /* 아래 것으로 내려갑니다 */ }
    }
    return chartSVG(sp, rows, opt);
  }

  //  계산 열인가 — 표에서 곱하거나 나눠 만든 열(압력 × 부피 따위)
  function isCalc(s) { return !!(s && (s.calc === true || /[×÷]/.test(String(s.label || '')))); }
  //  1 · 2 · 5 × 10ⁿ 가운데 r 보다 크거나 같은 가장 작은 값
  function niceNum(r) {
    if (!(r > 0) || !isFinite(r)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(r) / Math.LN10)), m = r / p;
    return (m <= 1.0000001 ? 1 : m <= 2.0000001 ? 2 : m <= 5.0000001 ? 5 : 10) * p;
  }
  function dpOf(step) {
    var dp = 0;
    while (dp < 8 && Math.abs(Math.round(step * Math.pow(10, dp)) - step * Math.pow(10, dp)) > 1e-6) dp++;
    return dp;
  }
  //  niceScale(lo, hi, {n, zero}) → {lo, hi, step, ticks, dp}
  //   값이 모두 0 이상이면 아래 끝이 0 밑으로 내려가지 않습니다. zero 면 0 을 꼭 넣습니다(막대그래프).
  function niceScale(lo, hi, o) {
    o = o || {};
    var n = o.n || 5;
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    var nonNeg = lo >= 0;
    if (o.zero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
    if (hi === lo) { var d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    var step = niceNum((hi - lo) / n);
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    if (b - a < step) b = a + step;
    if (nonNeg && a < 0) a = 0;
    var ticks = [];
    for (var v = a, k = 0; v <= b + step * 1e-6 && k < 40; v += step, k++) ticks.push(Number(v.toPrecision(12)));
    return { lo: a, hi: b, step: step, ticks: ticks, dp: dpOf(step) };
  }
  function tickTxt(v, sc) {
    if (Math.abs(v) < sc.step * 1e-9) v = 0;
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return sciNum(v);
    return String(Number(v.toFixed(sc.dp)));
  }
  function rawX(r) {
    if (Array.isArray(r)) return r[0];
    if (r && typeof r === 'object') return r.x;
    return '';
  }
  //  어느 계열을 어느 축에 — 계산 열은 빼고, 단위가 다르면 오른쪽 축(둘째)으로, 셋째 단위부터는 뺍니다.
  function axisPlan(series, opt) {
    opt = opt || {};
    var vis = [], hidden = [], dropped = [], units = [];
    var anyPlain = (series || []).some(function (s) { return !isCalc(s); });
    (series || []).forEach(function (s, i) {
      if (!opt.showCalc && anyPlain && isCalc(s)) { hidden.push(s); return; }
      var u = String((s && s.unit) || '').trim();
      var k = units.indexOf(u);
      if (k < 0) {
        if (units.length >= 2) { dropped.push(s); return; }
        units.push(u); k = units.length - 1;
      }
      vis.push({ i: i, s: s, ax: k });
    });
    return { vis: vis, hidden: hidden, dropped: dropped, units: units };
  }
  function axisTitle(list, unit) {
    var names = list.map(function (v) { return v.s.label || ('계열 ' + (v.i + 1)); });
    var t = names.length > 2 ? (names[0] + ' 등') : names.join(' · ');
    if (t.length > 26) t = t.slice(0, 25) + '…';
    return t + (unit ? ' (' + unit + ')' : '');
  }
  function lgItem(color, text, shape, F) {
    var sz = Math.round(F * 0.85);
    var mark = shape === 'dash'  ? 'width:' + (sz * 2) + 'px;height:0;border-top:' + Math.max(2, F / 5) + 'px dashed ' + color + ';border-radius:0'
             : shape === 'solid' ? 'width:' + (sz * 2) + 'px;height:0;border-top:' + Math.max(2, F / 4) + 'px solid ' + color + ';border-radius:0'
             : 'width:' + sz + 'px;height:' + sz + 'px;background:' + color + ';border-radius:' + (shape === 'sq' ? '2px' : '50%');
    return '<span style="display:inline-flex;align-items:center;gap:.35em"><i style="display:inline-block;' + mark + '"></i>' + text + '</span>';
  }
  function lgBox(F, inner) {
    return '<div class="dk-lg" style="display:flex;flex-wrap:wrap;gap:.4em 1em;margin-top:.35em;font-size:' + Math.min(F + 1, 24) +
           'px;line-height:1.45;color:var(--ink)">' + inner + '</div>';
  }
  function svgOpen(Wd, Hg, label, F) {
    return '<svg viewBox="0 0 ' + Wd + ' ' + Hg + '" width="100%" role="img" aria-label="' + esc(label) +
           '" style="min-width:280px;font-family:inherit">';
  }
  function svgT(x, y, s, F, o) {        // 글자 하나
    o = o || {};
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + (o.a || 'middle') + '" font-size="' + (o.size || F) +
           '" fill="' + (o.fill || 'var(--muted)') + '"' + (o.w ? ' font-weight="' + o.w + '"' : '') +
           (o.tf ? ' transform="' + o.tf + '"' : '') + '>' + esc(s) + '</text>';
  }

  //  chartSVG(sp, rows, opt) — 모둠 하나의 그래프
  //   opt: w · h · font(글자 크기, 전자칠판은 크게) · predict([{x,s0…}] 예상 · 점선) · asPredict(rows 가 곧 예상)
  //        mark({x, predicted, actual, text, si}) · gap(false 면 가장 큰 차이 표시를 끕니다) · showCalc · colors
  function chartSVG(sp, rows, opt) {
    opt = opt || {};
    var F = Number(opt.font) || 11, k = F / 11;
    var Wd = opt.w || 560, Hg = opt.h || 300;
    var series = (sp && Array.isArray(sp.series) && sp.series.length) ? sp.series : DEF_SPEC.series;
    var kind = (sp && sp.chart) || 'line';
    var xLab = (sp && sp.x && sp.x.label) || '';
    var xUnit = (sp && sp.x && sp.x.unit) || '';
    var cols = opt.colors || SERIES_HEX;
    var plan = axisPlan(series, opt);
    var two = plan.units.length > 1;

    function ptsOf(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (r) {
        var x = cellAt(r, 0);
        var ys = series.map(function (_, i) { var v = cellAt(r, i + 1); return isFinite(v) ? v : null; });
        if (plan.vis.every(function (v) { return ys[v.i] === null; })) return;
        out.push({ x: isFinite(x) ? x : null, raw: rawX(r), ys: ys });
      });
      return out;
    }
    var pts = ptsOf(rows), preP = opt.asPredict ? [] : ptsOf(opt.predict);
    if (!pts.length && !preP.length) return '<div class="dk-empty empty">아직 자료가 없습니다.</div>';

    var base = pts.length ? pts : preP;
    var numericX = kind !== 'bar' && base.every(function (p) { return p.x !== null; });
    var P = { l: Math.round(62 * k), r: Math.round((two ? 62 : 18) * k), t: Math.round(14 * k), b: Math.round(50 * k) };

    //  가로축
    var xs, x0, x1, xsc = null;
    if (numericX) {
      xs = [];
      pts.concat(preP).forEach(function (p) { if (p.x !== null) xs.push(p.x); });
      xsc = niceScale(Math.min.apply(null, xs), Math.max.apply(null, xs), { n: 6 });
      x0 = xsc.lo; x1 = xsc.hi;
    } else {
      x0 = -0.5; x1 = Math.max(base.length, 1) - 0.5;
    }
    //  세로축 — 축마다 따로
    var ysc = plan.units.map(function (_, ax) {
      var vals = [];
      pts.concat(preP).forEach(function (p) {
        plan.vis.forEach(function (v) { if (v.ax === ax && p.ys[v.i] !== null) vals.push(p.ys[v.i]); });
      });
      if (!vals.length) vals = [0, 1];
      return niceScale(Math.min.apply(null, vals), Math.max.apply(null, vals), { zero: kind === 'bar' });
    });
    var px = function (v) { return P.l + (v - x0) / (x1 - x0) * (Wd - P.l - P.r); };
    var pyA = function (ax, v) { var s = ysc[ax] || ysc[0]; return Hg - P.b - (v - s.lo) / (s.hi - s.lo) * (Hg - P.t - P.b); };

    var s = svgOpen(Wd, Hg, (xLab || '측정') + ' 그래프', F);
    //  눈금 · 격자 (왼쪽 축 눈금에 격자를 맞춥니다)
    ysc[0].ticks.forEach(function (v) {
      var gy = pyA(0, v);
      s += '<line x1="' + P.l + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>';
      s += svgT(P.l - 6 * k, gy + F * 0.35, tickTxt(v, ysc[0]), F, { a: 'end' });
    });
    if (two) {
      s += '<line x1="' + (Wd - P.r) + '" y1="' + P.t + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.2"/>';
      ysc[1].ticks.forEach(function (v) {
        var gy = pyA(1, v);
        s += '<line x1="' + (Wd - P.r) + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r + 4 * k) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line-2)"/>';
        s += svgT(Wd - P.r + 7 * k, gy + F * 0.35, tickTxt(v, ysc[1]), F, { a: 'start' });
      });
    }
    s += '<line x1="' + P.l + '" y1="' + (Hg - P.b) + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.5"/>';
    s += '<line x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.2"/>';
    var xty = Hg - P.b + F + 5 * k;
    if (numericX) {
      xsc.ticks.forEach(function (v) { s += svgT(px(v), xty, tickTxt(v, xsc), F); });
    } else {
      var every = Math.max(1, Math.ceil(base.length / Math.max(4, Math.floor((Wd - P.l - P.r) / (F * 5)))));
      base.forEach(function (p, i) {
        if (i % every) return;
        var lb = (p.raw === '' || p.raw === undefined || p.raw === null) ? (i + 1) : String(p.raw);
        if (String(lb).length > 10) lb = String(lb).slice(0, 9) + '…';
        s += svgT(px(i), xty, lb, F);
      });
    }
    //  축 제목 — 단위를 붙입니다
    s += svgT((P.l + Wd - P.r) / 2, Hg - 6 * k, xLab + (xUnit ? ' (' + xUnit + ')' : ''), F + 0.5, { fill: 'var(--ink)', w: 700 });
    var midY = (P.t + Hg - P.b) / 2;
    var leftList = plan.vis.filter(function (v) { return v.ax === 0; });
    s += svgT(F * 1.05, midY, axisTitle(leftList, plan.units[0]), F + 0.5, { fill: 'var(--ink)', w: 700, tf: 'rotate(-90 ' + (F * 1.05).toFixed(1) + ' ' + midY.toFixed(1) + ')' });
    if (two) {
      var rx = Wd - F * 0.75;
      s += svgT(rx, midY, axisTitle(plan.vis.filter(function (v) { return v.ax === 1; }), plan.units[1]) + ' · 오른쪽 축', F + 0.5,
             { fill: 'var(--ink)', w: 700, tf: 'rotate(90 ' + rx.toFixed(1) + ' ' + midY.toFixed(1) + ')' });
    }

    function xAt(p, i, list) {
      if (numericX && p.x !== null) return px(p.x);
      if (list === preP && pts.length && preP.length > 1) return px(i * (pts.length - 1) / (preP.length - 1));
      return px(i);
    }
    //  예상 — 점선으로 뒤에 깔립니다
    if (preP.length) {
      plan.vis.forEach(function (v) {
        var col = cols[v.i % cols.length], d = '', pen = false;
        preP.forEach(function (p, i) {
          if (p.ys[v.i] === null) { pen = false; return; }
          d += (pen ? 'L' : 'M') + xAt(p, i, preP).toFixed(1) + ' ' + pyA(v.ax, p.ys[v.i]).toFixed(1) + ' ';
          pen = true;
        });
        if (d) s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (2.2 * k).toFixed(1) + '" opacity=".62" ' +
                    'stroke-dasharray="' + (8 * k).toFixed(0) + ' ' + (6 * k).toFixed(0) + '" stroke-linejoin="round" stroke-linecap="round"/>';
      });
    }
    //  계열
    var nv = plan.vis.length;
    plan.vis.forEach(function (v, vi) {
      var col = cols[v.i % cols.length];
      var list = pts.map(function (p, i) { return { X: xAt(p, i, pts), Y: p.ys[v.i] === null ? null : pyA(v.ax, p.ys[v.i]) }; });
      if (kind === 'bar') {
        var bw = Math.max(3, (Wd - P.l - P.r) / Math.max(pts.length, 1) / (nv + 1));
        var y0p = pyA(v.ax, Math.max(ysc[v.ax].lo, Math.min(0, ysc[v.ax].hi)));
        list.forEach(function (pt) {
          if (pt.Y === null) return;
          var bx = pt.X - (nv * bw) / 2 + vi * bw;
          s += '<rect x="' + bx.toFixed(1) + '" y="' + Math.min(pt.Y, y0p).toFixed(1) + '" width="' + bw.toFixed(1) +
               '" height="' + Math.abs(y0p - pt.Y).toFixed(1) + '" fill="' + col + '" opacity=".88" rx="2"/>';
        });
        return;
      }
      if (kind !== 'scatter') {
        var d = '', pen = false;
        list.forEach(function (pt) {
          if (pt.Y === null) { pen = false; return; }
          d += (pen ? 'L' : 'M') + pt.X.toFixed(1) + ' ' + pt.Y.toFixed(1) + ' ';
          pen = true;
        });
        if (d) s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (2.4 * k).toFixed(1) + '"' +
                    (opt.asPredict ? ' stroke-dasharray="' + (8 * k).toFixed(0) + ' ' + (6 * k).toFixed(0) + '"' : '') +
                    ' stroke-linejoin="round" stroke-linecap="round"/>';
      }
      list.forEach(function (pt) {
        if (pt.Y === null) return;
        if (v.ax === 1) {                    // 오른쪽 축 계열은 네모 점으로 — 색만으로 가리지 않게
          var r2 = 3.6 * k;
          s += '<rect x="' + (pt.X - r2).toFixed(1) + '" y="' + (pt.Y - r2).toFixed(1) + '" width="' + (2 * r2).toFixed(1) +
               '" height="' + (2 * r2).toFixed(1) + '" fill="' + col + '"/>';
        } else {
          s += '<circle cx="' + pt.X.toFixed(1) + '" cy="' + pt.Y.toFixed(1) + '" r="' + (3.4 * k).toFixed(1) + '" fill="' + col + '"/>';
        }
      });
    });

    //  예상과 가장 많이 달랐던 곳 — 세로 점선으로 잇습니다
    var mk = opt.mark || null;
    if (!mk && opt.gap !== false && preP.length && pts.length && numericX) {
      var best = null;
      plan.vis.forEach(function (v) {
        var g = predictGap(rows, opt.predict, v.i);
        if (!g || g.maxDiff === null || !isFinite(g.maxDiff)) return;
        if (!best || g.maxDiff > best.maxDiff) best = { maxDiff: g.maxDiff, x: g.atX, actual: g.actual, predicted: g.predicted, si: v.i };
      });
      if (best && isFinite(best.x)) mk = { x: best.x, actual: best.actual, predicted: best.predicted, si: best.si, text: '가장 큰 차이 ' + fmtNum(best.maxDiff) };
    }
    if (mk && isFinite(Number(mk.predicted)) && isFinite(Number(mk.actual))) {
      var mv = null;
      plan.vis.forEach(function (v) { if (v.i === (Number(mk.si) || 0)) mv = v; });
      var ax = mv ? mv.ax : 0;
      var GX;
      if (numericX && isFinite(Number(mk.x))) GX = px(Number(mk.x));
      else GX = px(Math.max(0, Math.min(base.length - 1, Math.round(Number(mk.x) || 0))));
      var Ya = pyA(ax, Number(mk.actual)), Yp = pyA(ax, Number(mk.predicted));
      var mc = opt.markColor || 'var(--ink)';
      s += '<line x1="' + GX.toFixed(1) + '" y1="' + Math.min(Ya, Yp).toFixed(1) + '" x2="' + GX.toFixed(1) + '" y2="' + Math.max(Ya, Yp).toFixed(1) +
           '" stroke="' + mc + '" stroke-width="' + (1.8 * k).toFixed(1) + '" stroke-dasharray="' + (3 * k).toFixed(0) + ' ' + (3 * k).toFixed(0) + '"/>';
      s += '<circle cx="' + GX.toFixed(1) + '" cy="' + Yp.toFixed(1) + '" r="' + (5 * k).toFixed(1) + '" fill="#fff" stroke="' + mc + '" stroke-width="' + (1.8 * k).toFixed(1) + '"/>';
      s += '<circle cx="' + GX.toFixed(1) + '" cy="' + Ya.toFixed(1) + '" r="' + (5 * k).toFixed(1) + '" fill="' + mc + '"/>';
      if (mk.text) {
        var right = GX > Wd * 0.62;
        s += '<text x="' + (right ? GX - 9 * k : GX + 9 * k).toFixed(1) + '" y="' + ((Ya + Yp) / 2 + F * 0.35).toFixed(1) +
             '" text-anchor="' + (right ? 'end' : 'start') + '" font-size="' + (F + 1) + '" font-weight="800" fill="' + mc +
             '" stroke="#fff" stroke-width="' + (4 * k).toFixed(1) + '" paint-order="stroke">' + esc(mk.text) + '</text>';
      }
    }
    s += '</svg>';

    var lg = '';
    plan.vis.forEach(function (v) {
      lg += lgItem(cols[v.i % cols.length], esc(v.s.label || ('계열 ' + (v.i + 1))) + (v.s.unit ? ' (' + esc(v.s.unit) + ')' : '') +
                   (two && v.ax === 1 ? ' · 오른쪽 축' : ''), v.ax === 1 ? 'sq' : 'dot', F);
    });
    if (preP.length || opt.asPredict) lg += lgItem('var(--muted)', '점선 = 예상', 'dash', F);
    if (preP.length && pts.length) lg += kind === 'line' ? lgItem('var(--muted)', '실선 = 실제 측정', 'solid', F)
                                                         : lgItem('var(--muted)', (kind === 'bar' ? '막대' : '점') + ' = 실제 측정', kind === 'bar' ? 'sq' : 'dot', F);
    if (plan.hidden.length) {
      lg += '<span style="color:var(--muted)">계산 열(' + esc(plan.hidden.map(function (x) { return x.label; }).join(' · ')) + ')은 그래프에서 뺐습니다</span>';
    }
    if (plan.dropped.length) {
      lg += '<span style="color:var(--muted)">단위가 다른 ' + esc(plan.dropped.map(function (x) { return x.label; }).join(' · ')) + '은(는) 축이 모자라 뺐습니다</span>';
    }
    return s + lgBox(F, lg);
  }

  // ── 곡선 관계 — 분석 레시피의 fit(xt·yt) 을 그대로 씁니다 ──────────
  var TF_INV = {
    none: function (v) { return v; },
    inv : function (v) { return v !== 0 ? 1 / v : NaN; },
    sq  : function (v) { return v >= 0 ? Math.sqrt(v) : NaN; },
    sqrt: function (v) { return v >= 0 ? v * v : NaN; },
    log : function (v) { return Math.pow(10, v); },
    inv2: function (v) { return v > 0 ? 1 / Math.sqrt(v) : NaN; }
  };
  //  relOf(exp, si) → {xt, yt} | null — 이 실험이 가로축 x 와 계열 si 사이에 곡선 관계를 기대하면
  function relOf(exp, si) {
    if (!exp) return null;
    var L = LABDB(), A = null;
    try { A = (L && typeof L.analysisOf === 'function') ? L.analysisOf(exp) : exp.analysis; } catch (e) { A = exp.analysis; }
    var steps = (A && Array.isArray(A.steps)) ? A.steps : [];
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      if (!st || st.kind !== 'fit' || String(st.x) !== 'x' || String(st.y) !== 's' + (Number(si) || 0)) continue;
      var xt = TF_INV[st.xt] ? st.xt : 'none', yt = TF_INV[st.yt] ? st.yt : 'none';
      if (xt === 'none' && yt === 'none') return null;
      return { xt: xt, yt: yt };
    }
    return null;
  }
  //  바꾼 축에서 맞춘 직선 → {xt, yt, slope, intercept, r2, n}
  function curveFit(pts, rel) {
    if (!rel) return null;
    var tx = TF[rel.xt] || TF.none, ty = TF[rel.yt] || TF.none, list = [];
    (pts || []).forEach(function (p) {
      if (!isFinite(p[0]) || !isFinite(p[1]) || !tx.ok(p[0]) || !ty.ok(p[1])) return;
      var X = tx.f(p[0]), Y = ty.f(p[1]);
      if (isFinite(X) && isFinite(Y)) list.push([X, Y]);
    });
    var st = stats(list, 0);
    if (st.slope === null || !isFinite(st.slope)) return null;
    return { xt: rel.xt, yt: rel.yt, slope: st.slope, intercept: st.intercept, r2: st.r2, n: st.n };
  }
  function curveAt(c, x) {
    var tx = TF[c.xt] || TF.none;
    if (!tx.ok(x)) return NaN;
    return (TF_INV[c.yt] || TF_INV.none)(c.slope * tx.f(x) + c.intercept);
  }
  //  기울기 한 벌 — 곡선 관계면 바꾼 축에서, 아니면 그대로. {slope, r2, n, xLab, yLab, unit, rel}
  function slopeOf(rows, si, rel, xl, xu, yl, yu) {
    var o = { slope: null, r2: null, n: 0, rel: rel || null,
              xLab: xl, yLab: yl, unit: slopeUnit(yu, xu) };
    if (rel) {
      var pts = [];
      (rows || []).forEach(function (r) { var x = cellAt(r, 0), y = cellAt(r, si + 1); if (isFinite(x) && isFinite(y)) pts.push([x, y]); });
      var c = curveFit(pts, rel);
      o.xLab = TF[rel.xt].lab(xl); o.yLab = TF[rel.yt].lab(yl);
      o.unit = slopeUnit(TF[rel.yt].unit(yu || ''), TF[rel.xt].unit(xu || ''));
      if (c) { o.slope = c.slope; o.r2 = c.r2; o.n = c.n; }
      return o;
    }
    var st = stats(rows, si);
    o.slope = st.slope; o.r2 = st.r2; o.n = st.n;
    return o;
  }

  //  multiChart(sets, opt) — 여러 묶음을 한 그림에 (모둠 겹친 그래프 · 변환 그래프 · 여러 반 묶어보기)
  //   sets: [{label, color, pts:[[x,y]…], fit, curve, line, thick, faint, right, big}]
  //   opt : w · h · font · xLabel · xUnit · yLabel · yUnit · y2Label · y2Unit
  //         cats([이름…] 이면 가로축이 이름 — 선으로 잇지 않고 자리별 평균을 굵은 가로 막대로)
  //         allFit(직선) · allCurve(곡선) · allLabel · mineWord
  function multiChart(sets, opt) {
    opt = opt || {};
    sets = sets || [];
    var F = Number(opt.font) || 11, k = F / 11;
    var Wd = opt.w || 660, Hg = opt.h || 330;
    var cats = Array.isArray(opt.cats) && opt.cats.length ? opt.cats : null;
    var two = sets.some(function (S) { return S.right && (S.pts || []).length; });
    var P = { l: Math.round(64 * k), r: Math.round((two ? 64 : 18) * k), t: Math.round(14 * k), b: Math.round(52 * k) };
    var xs = [], yL = [], yR = [];
    sets.forEach(function (S) {
      (S.pts || []).forEach(function (p) { xs.push(p[0]); (S.right ? yR : yL).push(p[1]); });
    });
    if (!xs.length) return '<div class="dk-empty empty">그릴 점이 없습니다.</div>';
    if (!yL.length) yL = yR.slice();
    var x0, x1, xsc = null;
    if (cats) { x0 = -0.5; x1 = cats.length - 0.5; }
    else {
      xsc = niceScale(Math.min.apply(null, xs), Math.max.apply(null, xs), { n: 6 });
      x0 = xsc.lo; x1 = xsc.hi;
    }
    var sL = niceScale(Math.min.apply(null, yL), Math.max.apply(null, yL), { n: 5 });
    var sR = yR.length ? niceScale(Math.min.apply(null, yR), Math.max.apply(null, yR), { n: 5 }) : null;
    var px = function (v) { return P.l + (v - x0) / (x1 - x0) * (Wd - P.l - P.r); };
    var py = function (v, right) { var s = (right && sR) ? sR : sL; return Hg - P.b - (v - s.lo) / (s.hi - s.lo) * (Hg - P.t - P.b); };

    function seg(fit, right) {                    // 직선 추세선을 그림 안쪽으로만 자릅니다
      if (!fit || fit.slope === null || !isFinite(fit.slope)) return null;
      var sc = (right && sR) ? sR : sL;
      var a = fit.slope, b = fit.intercept, xa = x0, xb = x1;
      if (Math.abs(a) > 1e-12) {
        var c0 = (sc.lo - b) / a, c1 = (sc.hi - b) / a;
        xa = Math.max(xa, Math.min(c0, c1));
        xb = Math.min(xb, Math.max(c0, c1));
      } else if (b < sc.lo || b > sc.hi) return null;
      if (!(xb > xa)) return null;
      return 'M' + px(xa).toFixed(1) + ' ' + py(a * xa + b, right).toFixed(1) + ' L' + px(xb).toFixed(1) + ' ' + py(a * xb + b, right).toFixed(1);
    }
    function curvePath(c, right, lo, hi) {         // 곡선 — 잘게 나눠 잇고, 그림 밖은 끊습니다
      if (!c) return '';
      var sc = (right && sR) ? sR : sL, d = '', pen = false;
      var a = (lo === undefined) ? x0 : lo, b = (hi === undefined) ? x1 : hi;
      for (var i = 0; i <= 80; i++) {
        var x = a + (b - a) * i / 80, y = curveAt(c, x);
        if (!isFinite(y) || y < sc.lo || y > sc.hi) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + px(x).toFixed(1) + ' ' + py(y, right).toFixed(1) + ' ';
        pen = true;
      }
      return d;
    }
    function trend(S) { return S.curve ? curvePath(S.curve, S.right) : (S.fit ? seg(S.fit, S.right) : null); }

    var s = svgOpen(Wd, Hg, (opt.xLabel || 'x') + ' 대 ' + (opt.yLabel || 'y') + ' 그래프', F);
    sL.ticks.forEach(function (v) {
      var gy = py(v);
      s += '<line x1="' + P.l + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line)"/>';
      s += svgT(P.l - 6 * k, gy + F * 0.35, tickTxt(v, sL), F, { a: 'end' });
    });
    if (sR) {
      s += '<line x1="' + (Wd - P.r) + '" y1="' + P.t + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.2"/>';
      sR.ticks.forEach(function (v) {
        var gy = py(v, true);
        s += '<line x1="' + (Wd - P.r) + '" y1="' + gy.toFixed(1) + '" x2="' + (Wd - P.r + 4 * k) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line-2)"/>';
        s += svgT(Wd - P.r + 7 * k, gy + F * 0.35, tickTxt(v, sR), F, { a: 'start' });
      });
    }
    var xty = Hg - P.b + F + 5 * k;
    if (cats) {
      var every = Math.max(1, Math.ceil(cats.length / Math.max(3, Math.floor((Wd - P.l - P.r) / (F * 6)))));
      cats.forEach(function (c, i) {
        if (i % every) return;
        var lb = String(c); if (lb.length > 9) lb = lb.slice(0, 8) + '…';
        s += svgT(px(i), xty, lb, F);
      });
    } else {
      xsc.ticks.forEach(function (v) { s += svgT(px(v), xty, tickTxt(v, xsc), F); });
    }
    s += '<line x1="' + P.l + '" y1="' + (Hg - P.b) + '" x2="' + (Wd - P.r) + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.5"/>';
    s += '<line x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (Hg - P.b) + '" stroke="var(--line-2)" stroke-width="1.2"/>';
    s += svgT((P.l + Wd - P.r) / 2, Hg - 6 * k, (opt.xLabel || '') + (opt.xUnit ? ' (' + opt.xUnit + ')' : ''), F + 0.5, { fill: 'var(--ink)', w: 700 });
    var midY = (P.t + Hg - P.b) / 2;
    s += svgT(F * 1.05, midY, (opt.yLabel || '') + (opt.yUnit ? ' (' + opt.yUnit + ')' : ''), F + 0.5,
           { fill: 'var(--ink)', w: 700, tf: 'rotate(-90 ' + (F * 1.05).toFixed(1) + ' ' + midY.toFixed(1) + ')' });
    if (sR) {
      var rx = Wd - F * 0.75;
      s += svgT(rx, midY, (opt.y2Label || '') + (opt.y2Unit ? ' (' + opt.y2Unit + ')' : '') + ' · 오른쪽 축', F + 0.5,
             { fill: 'var(--ink)', w: 700, tf: 'rotate(90 ' + rx.toFixed(1) + ' ' + midY.toFixed(1) + ')' });
    }

    if (!cats) sets.forEach(function (S) {          // 선 (이어 그리기를 원한 묶음만 · 이름 가로축은 잇지 않습니다)
      if (!S.line || (S.pts || []).length < 2) return;
      var d = '', pen = false;
      S.pts.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (p) {
        d += (pen ? 'L' : 'M') + px(p[0]).toFixed(1) + ' ' + py(p[1], S.right).toFixed(1) + ' ';
        pen = true;
      });
      s += '<path d="' + d + '" fill="none" stroke="' + S.color + '" stroke-width="' + ((S.thick ? 3 : 2.2) * k).toFixed(1) +
           '" opacity="' + (S.faint ? '.45' : '.9') + '" stroke-linejoin="round" stroke-linecap="round"' +
           (S.right ? ' stroke-dasharray="' + (6 * k).toFixed(0) + ' ' + (4 * k).toFixed(0) + '"' : '') + '/>';
    });
    //  이름 가로축 — 한 자리에 여러 모둠 점이 겹치지 않게 조금씩 비켜 찍습니다
    var nSet = sets.length;
    sets.forEach(function (S, si) {               // 점
      var off = cats ? ((si - (nSet - 1) / 2) * Math.min(0.5 / Math.max(nSet, 1), 0.09)) : 0;
      (S.pts || []).forEach(function (p) {
        var X = px(p[0] + off), Y = py(p[1], S.right), r = (S.big ? 6.5 : (S.thick ? 4.4 : 3.2)) * k;
        if (S.right) {
          s += '<rect x="' + (X - r).toFixed(1) + '" y="' + (Y - r).toFixed(1) + '" width="' + (2 * r).toFixed(1) + '" height="' + (2 * r).toFixed(1) +
               '" fill="' + S.color + '" opacity="' + (S.faint ? '.5' : '.92') + '"/>';
        } else {
          s += '<circle cx="' + X.toFixed(1) + '" cy="' + Y.toFixed(1) + '" r="' + r.toFixed(1) +
               '" fill="' + S.color + '" opacity="' + (S.faint ? '.5' : '.92') + '"' +
               ((S.thick || S.big) ? ' stroke="#fff" stroke-width="' + (1.4 * k).toFixed(1) + '"' : '') + '/>';
        }
      });
    });
    if (!cats) sets.forEach(function (S) {        // 묶음별 추세선 · 곡선
      var d = trend(S);
      if (!d) return;
      s += '<path d="' + d + '" fill="none" stroke="' + S.color + '" stroke-width="' + ((S.thick ? 2.6 : 1.6) * k).toFixed(1) +
           '" opacity="' + (S.thick ? '.9' : '.55') + '"' + (S.thick ? '' : ' stroke-dasharray="' + (7 * k).toFixed(0) + ' ' + (5 * k).toFixed(0) + '"') + '/>';
    });
    var allD = '';
    if (!cats && opt.allCurve) allD = curvePath(opt.allCurve, false);
    else if (!cats && opt.allFit) allD = seg(opt.allFit, false) || '';
    if (allD) {
      s += '<path d="' + allD + '" fill="none" stroke="var(--ink)" stroke-width="' + (3.4 * k).toFixed(1) + '" opacity=".75" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    var means = [];
    if (cats) {                                   // 자리(조건)별 평균 — 굵은 가로 막대
      cats.forEach(function (c, i) {
        var sum = 0, n = 0;
        sets.forEach(function (S) { (S.pts || []).forEach(function (p) { if (p[0] === i && !S.right) { sum += p[1]; n++; } }); });
        if (!n) return;
        var m = sum / n, X = px(i), Y = py(m), hw = Math.min(24 * k, (px(1) - px(0)) * 0.36);
        means.push(m);
        s += '<line x1="' + (X - hw).toFixed(1) + '" y1="' + Y.toFixed(1) + '" x2="' + (X + hw).toFixed(1) + '" y2="' + Y.toFixed(1) +
             '" stroke="var(--ink)" stroke-width="' + (3.2 * k).toFixed(1) + '" stroke-linecap="round" opacity=".8"/>';
      });
    }
    s += '</svg>';

    var lg = '';
    sets.forEach(function (S) {
      if (!S.label) return;
      lg += lgItem(S.color, esc(S.label) + (S.thick && opt.mineWord !== '' ? ' (' + esc(opt.mineWord || '우리 모둠') + ')' : '') +
                   (S.right && sR ? ' · 오른쪽 축' : ''), S.right ? 'sq' : 'dot', F);
    });
    if (allD) lg += lgItem('var(--ink)', esc(opt.allLabel || (opt.allCurve ? '반 전체 추세 곡선' : '반 전체 추세선')), 'solid', F);
    if (means.length) lg += lgItem('var(--ink)', esc(opt.meanLabel || '굵은 가로 막대 = 자리마다 평균'), 'solid', F);
    return s + lgBox(F, lg);
  }

  // ─────────────────────────────────────────────────────────────────
  //  5. 블록 정의
  //     need 에 적은 자료가 없으면 팔레트에서 흐리게 두고 까닭을 보여 줍니다(숨기지 않습니다).
  //     need 토큰: data · predict · report · quiz · eval · ai · feedback · board · exp · figD · figG
  // ─────────────────────────────────────────────────────────────────
  var BLOCKS = [
    // ── 측정
    { key: 'value',   icon: '🔢', name: '지금 값',         group: '측정', need: ['data'], w: 12, desc: '계열마다 마지막 값을 큰 숫자와 단위로 보여 줍니다.' },
    { key: 'table',   icon: '📋', name: '데이터 표',       group: '측정', need: ['data'], w: 6,  desc: '적어 둔 측정값을 그대로 표로 보여 줍니다.' },
    { key: 'line',    icon: '📈', name: '선그래프',        group: '측정', need: ['data'], w: 12, desc: '가로축을 따라 계열을 선으로 잇습니다.' },
    { key: 'scatter', icon: '⚬',  name: '점그래프',        group: '측정', need: ['data'], w: 6,  desc: '점만 찍어 흩어진 모양을 봅니다(산점도).' },
    { key: 'bar',     icon: '📊', name: '막대그래프',      group: '측정', need: ['data'], w: 6,  desc: '회차마다 크기를 나란히 견줍니다.' },
    { key: 'stats',   icon: '🧮', name: '평균·최대·최소',  group: '측정', need: ['data'], w: 6,  desc: '처음·마지막·평균·최소·최대를 한눈에.' },
    { key: 'fit',     icon: '📐', name: '기울기와 R²',     group: '측정', need: ['data'], w: 6,  desc: '가장 잘 맞는 직선의 기울기(단위까지)와 R².' },
    { key: 'predict', icon: '🔮', name: '예상 vs 실제',    group: '측정', need: ['data', 'predict'], w: 12, desc: '우리가 그린 예상을 점선으로 겹치고 가장 크게 달랐던 곳을 짚습니다.' },
    { key: 'tf',      icon: '🔁', name: '실험실 그래프',    group: '측정', need: ['data'], w: 12, desc: '데이터 실험실에서 고른 축·변환 그대로 다시 그립니다.' },

    // ── 반 전체
    { key: 'classLines', icon: '👥', name: '모둠 그래프 겹쳐 보기', group: '반 전체', need: ['data', 'board'], w: 12, desc: '모둠마다 색을 달리해 한 그림에 겹쳐 그립니다.' },
    { key: 'rank',       icon: '🏅', name: '모둠별 기울기 순위',   group: '반 전체', need: ['data', 'board'], w: 6,  desc: '기울기가 큰 모둠부터 줄 세웁니다.' },
    { key: 'mypos',      icon: '📍', name: '우리 모둠 위치',       group: '반 전체', need: ['data', 'board'], w: 6,  desc: '반 전체 가운데 우리 모둠이 어디쯤인지.' },
    { key: 'progress',   icon: '⏱',  name: '모둠 진행 현황',       group: '반 전체', need: ['board'], w: 12, role: 'teacher', desc: '모둠별 측정·보고서·개념확인 진행 상태 타일.' },

    // ── 콘텐츠
    { key: 'overview', icon: '🧪', name: '실험 개요',        group: '콘텐츠', need: ['exp'], w: 6,  desc: '제목·성취기준 원문·소요 시간·센서.' },
    { key: 'prepare',  icon: '🧰', name: '준비물',           group: '콘텐츠', need: ['exp'], w: 6,  desc: '이 실험에 필요한 준비물 목록.' },
    { key: 'steps',    icon: '🪜', name: '절차 카드',        group: '콘텐츠', need: ['exp'], w: 12, desc: '업체별 절차를 번호가 붙은 카드로.' },
    { key: 'diagram',  icon: '🔌', name: '연결 그림',        group: '콘텐츠', need: ['exp', 'figD'], w: 6, desc: '센서를 어디에 어떻게 다는지 그림으로.' },
    { key: 'exgraph',  icon: '🖼',  name: '결과 그래프 예시', group: '콘텐츠', need: ['exp', 'figG'], w: 6, desc: '이런 모양이 나오면 잘 된 것입니다.' },
    { key: 'report',   icon: '📝', name: '보고서 문답',      group: '콘텐츠', need: ['report'], w: 12, desc: '문항과 우리가 쓴 답을 나란히.' },
    { key: 'quiz',     icon: '✅', name: '개념 확인 결과',   group: '콘텐츠', need: ['quiz'], w: 6,  desc: '우리 모둠이 받은 점수와 맞고 틀림.' },
    { key: 'quizdist', icon: '📊', name: '문항별 정답률',    group: '콘텐츠', need: ['quiz', 'board'], w: 6, role: 'teacher', desc: '어느 문항에서 반 전체가 걸렸는지.' },
    { key: 'eval',     icon: '🌟', name: '선생님 평가',      group: '콘텐츠', need: ['eval'], w: 6,  desc: '루브릭 항목별 점수와 선생님이 쓴 문장.' },
    { key: 'ai',       icon: '🤖', name: 'AI 협업 기록',     group: '콘텐츠', need: ['ai'], w: 12, desc: 'AI 에게 무엇을 물었고 무엇을 우리 데이터로 검증했는지.' },
    { key: 'stars',    icon: '⭐', name: '별점과 칭찬',      group: '콘텐츠', need: ['feedback'], w: 6, desc: '다른 모둠에게 받은 별점 평균과 칭찬 글.' },

    // ── 꾸밈
    { key: 'bigtitle', icon: '🔠', name: '큰 제목', group: '꾸밈', need: [], w: 12, desc: '전자칠판에 띄울 큰 글씨 제목.' },
    { key: 'memo',     icon: '🗒',  name: '글 상자', group: '꾸밈', need: [], w: 6,  desc: '결론·설명·알림을 적어 둡니다.' },
    { key: 'divider',  icon: '➖', name: '구분선',  group: '꾸밈', need: [], w: 12, desc: '영역을 나누는 가로선.' }
  ];
  var BMAP = {};
  BLOCKS.forEach(function (b) { BMAP[b.key] = b; });
  var GROUPS = ['측정', '반 전체', '콘텐츠', '꾸밈'];
  var GLABEL = { '측정': '📏 측정', '반 전체': '👥 반 전체', '콘텐츠': '📄 글·자료', '꾸밈': '✏️ 꾸미기' };

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
  //  블록이 볼 계열 — 따로 고르지 않았으면 계산 열이 아닌 첫 계열
  function defaultSi(C, cfg) {
    if (cfg && cfg.si !== undefined && cfg.si !== null && cfg.si !== '') return Math.max(0, Math.min(C.series.length - 1, Number(cfg.si) || 0));
    for (var i = 0; i < C.series.length; i++) if (!isCalc(C.series[i])) return i;
    return 0;
  }
  //  이름 가로축의 칸 — 적힌 이름(없으면 줄 번호)
  function catKey(r, k) { return (r.lab !== undefined && r.lab !== '') ? r.lab : String(k + 1); }
  function catList(C) {
    var out = [];
    C.withRows.forEach(function (G) { G.rows.forEach(function (r, k) { var c = catKey(r, k); if (out.indexOf(c) < 0) out.push(c); }); });
    if (out.every(function (c) { return isFinite(Number(c)); })) out.sort(function (a, b) { return Number(a) - Number(b); });
    return out;
  }

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
      if (C.catX) return empty('가로축이 이름(자리·조건)이라 기울기를 내지 않습니다. 막대그래프로 견주어 보세요.');
      var any = false, curved = false, h = '<div class="dk-vals">';
      C.series.forEach(function (s, i) {
        if (isCalc(s) && C.series.some(function (x) { return !isCalc(x); })) return;   // 계산 열은 기울기를 내지 않습니다
        var o = slopeOf(C.rows, i, relOf(C.exp, i), C.xLabel, C.xUnit, seriesLabel(C, i), seriesUnit(C, i));
        if (o.slope === null) return;
        any = true; if (o.rel) curved = true;
        h += '<div class="dk-v"><b>' + esc(o.rel ? (o.yLab + ' ↔ ' + o.xLab + ' 기울기') : (seriesLabel(C, i) + ' 기울기')) + '</b>' +
             '<em style="color:' + SERIES_HEX[i % SERIES_HEX.length] + '">' + esc(sciNum(o.slope)) + '</em>' +
             '<span>' + esc(o.unit) + '</span>' +
             '<div style="font-size:.75em;margin-top:.3em;opacity:.85">R² = ' + esc(fmtR2(o.r2)) + ' · 점 ' + o.n + '개</div></div>';
      });
      h += '</div>';
      if (!any) return empty('기울기를 내려면 값이 두 줄 이상이고 가로축 값이 서로 달라야 합니다.');
      h += '<p class="dk-sub">기울기는 "가로축이 1 늘 때 세로축이 얼마나 변하는가" 입니다. ' +
           'R² 이 1 에 가까울수록 점들이 직선에 잘 놓여 있습니다.' +
           (curved ? ' 이 실험은 곡선 관계라 바꾼 축(예: 1/부피)에서 기울기를 냈습니다.' : '') + '</p>';
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
      //  블록에 직접 정한 축이 없으면 데이터 실험실의 그래프를 전부 — 한 장이면 한 장, 여러 장이면 차례로 — 그립니다.
      var panes = (cfg && (cfg.xk || cfg.ys || cfg.yk)) ? [cfg] : (C.labs || [C.lab || {}]);
      return panes.map(function (L, i) {
        return (panes.length > 1 ? '<p class="dk-sub" style="margin:.2em 0 .3em"><b>그래프 ' + (i + 1) + '</b></p>' : '') + BODY.tfOne(C, L);
      }).join('');
    },
    tfOne: function (C, L) {
      var xk = L.xk || 'x', xt = TF[L.xt] ? L.xt : 'none';
      var yt = TF[L.yt] ? L.yt : 'none';
      //  고른 세로축이 없으면 측정 계열을 모두 — 계산 열(× · ÷)은 기본으로 뺍니다.
      var plainS = [];
      C.series.forEach(function (s, i) { if (!isCalc(s)) plainS.push('s' + i); });
      var yks = (Array.isArray(L.ys) && L.ys.length) ? L.ys
              : (L.yk ? [L.yk] : (plainS.length ? plainS : C.series.map(function (_, i) { return 's' + i; })));
      var derived = Array.isArray(L.derived) ? L.derived : [];

      var cols = colList(C, derived);
      var xc = colOf(cols, xk) || cols[0];
      var sets = [], notes = [], units = [];
      yks.forEach(function (yk, n) {
        var yc = colOf(cols, yk);
        if (!yc) return;
        //  단위가 다르면 오른쪽 축으로 — 축은 둘까지입니다.
        var yu = TF[yt].unit(yc.unit || '');
        var ax = units.indexOf(yu);
        if (ax < 0) {
          if (units.length >= 2) { notes.push(colName(yc) + ' 은(는) 단위가 달라 축이 모자라 뺐습니다.'); return; }
          units.push(yu); ax = units.length - 1;
        }
        var P = tfPoints(C.rows, derived, xc.k, xt, yk, yt);
        if (!P.pts.length) { notes.push(colName(yc) + ' 은 변환한 뒤 남는 점이 없습니다.'); return; }
        var list = P.pts.map(function (p) { return [p.x, p.y]; });
        sets.push({
          label: TF[yt].lab(colName(yc)), color: SERIES_HEX[n % SERIES_HEX.length],
          pts: list, fit: (L.trend === false) ? null : stats(list, 0),
          line: (L.kind === 'line'), thick: false, right: ax === 1, unit: yu
        });
        if (P.skipped) notes.push(colName(yc) + ' 에서 ' + P.skipped + '개 점을 건너뛰었습니다.');
      });
      if (!sets.length) return empty('고른 축과 변환으로는 그릴 점이 없습니다. 데이터 실험실에서 축을 바꿔 보세요.');

      var xLab = TF[xt].lab(colName(xc)), xUnit = TF[xt].unit(xc.unit || '');
      var leftS = sets.filter(function (S) { return !S.right; }), rightS = sets.filter(function (S) { return S.right; });
      var nmOf = function (list) { return list.length > 2 ? (list[0].label + ' 등') : list.map(function (S) { return S.label; }).join(' · '); };
      var yLab = nmOf(leftS), yUnit = units[0] || '';
      var h = '<div class="dk-chart">' +
              multiChart(sets, { xLabel: xLab, xUnit: xUnit, yLabel: yLab, yUnit: yUnit,
                                 y2Label: nmOf(rightS), y2Unit: units[1] || '', w: 660, h: 330 }) + '</div>';
      h += '<div class="dk-tw" style="margin-top:.5em"><table class="dk-t"><thead><tr><th>세로축</th><th>점</th><th>기울기</th><th>R²</th></tr></thead><tbody>';
      sets.forEach(function (S) {
        h += '<tr><td class="dk-l"><b style="color:' + S.color + '">' + esc(S.label) + '</b></td><td>' + S.pts.length + '</td>' +
             '<td>' + esc(S.fit ? sciNum(S.fit.slope) : '—') + ' ' + esc(slopeUnit(S.unit, xUnit)) + '</td>' +
             '<td>' + esc(S.fit ? fmtR2(S.fit.r2) : '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<p class="dk-sub">가로축 <b>' + esc(xLab) + '</b> (' + esc(TF[xt].name) + ') · 세로축 변환 <b>' + esc(TF[yt].name) + '</b>' +
           (notes.length ? ' · ' + esc(notes.join(' ')) : '') + '</p>';
      return h;
    },

    classLines: function (C, cfg) {
      if (!C.withRows.length) return empty('아직 자료를 올린 모둠이 없습니다.');
      var si = defaultSi(C, cfg);
      var sets = [], allPts = [];
      var nm = function (G) { return G.name + (G.cond ? ' · ' + G.cond : ''); };
      if (C.catX) {
        //  가로축이 이름(자리·조건)이면 선으로 잇지 않습니다 — 이름 사이의 기울기는 뜻이 없습니다.
        var cats = catList(C);
        C.withRows.forEach(function (G) {
          var pts = [];
          G.rows.forEach(function (r, k) {
            var y = r[si + 1];
            if (y === null || y === undefined || !isFinite(y)) return;
            pts.push([cats.indexOf(catKey(r, k)), y]);
          });
          if (pts.length) sets.push({ label: nm(G), color: G.color, pts: pts, line: false, thick: G.mine });
        });
        if (!sets.length) return empty('이 계열에는 아직 값이 없습니다.');
        return '<div class="dk-chart">' + multiChart(sets, {
          xLabel: C.xLabel, xUnit: C.xUnit, yLabel: seriesLabel(C, si), yUnit: seriesUnit(C, si),
          cats: cats, meanLabel: '굵은 가로 막대 = ' + (C.xLabel || '자리') + '마다 반 평균', w: 680, h: 340
        }) + '</div><p class="dk-sub">모둠 ' + sets.length + '곳의 값을 ' + esc(C.xLabel || '가로축') +
          '마다 모았습니다. 가로축이 이름이라 점을 선으로 잇지 않았습니다. 같은 자리인데 값이 크게 다르면 그때 무엇이 달랐는지 물어보세요.</p>';
      }
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
        sets.push({ label: nm(G), color: G.color, pts: pts, line: !(cfg && cfg.line === false), thick: G.mine, fit: null });
      });
      if (!sets.length) return empty('이 계열에는 아직 값이 없습니다.');
      //  곡선 관계를 기대하는 실험(보일 법칙 따위)은 직선 대신 바꾼 축에서 맞춘 곡선을 그립니다.
      var rel = relOf(C.exp, si);
      var curve = rel ? curveFit(allPts, rel) : null;
      var allFit = rel ? null : stats(allPts, 0);
      var h = '<div class="dk-chart">' + multiChart(sets, {
        xLabel: C.xLabel, xUnit: C.xUnit, yLabel: seriesLabel(C, si), yUnit: seriesUnit(C, si),
        allFit: (allFit && allFit.slope !== null) ? allFit : null, allCurve: curve,
        allLabel: curve ? ('반 전체 추세 곡선 (' + TF[rel.yt].lab(seriesLabel(C, si)) + ' ∝ ' + TF[rel.xt].lab(C.xLabel) + ')') : '',
        w: 680, h: 340
      }) + '</div>';
      h += '<p class="dk-sub">모둠 ' + sets.length + '곳을 겹쳐 그렸습니다 · 세로축 = ' + esc(seriesLabel(C, si)) + '. ' +
           (curve ? '이 실험은 곡선 관계라 직선 추세선 대신 ' + esc(TF[rel.xt].lab(C.xLabel)) + ' 로 바꿔 맞춘 곡선을 그렸습니다. ' : '') +
           '모양이 다른 모둠이 있다면 무엇이 달랐는지 물어보세요.</p>';
      return h;
    },

    rank: function (C, cfg) {
      if (!C.withRows.length) return empty('아직 자료를 올린 모둠이 없습니다.');
      if (C.catX) return empty('가로축이 이름(자리·조건)이라 기울기를 견주지 않습니다. 「모둠 그래프 겹쳐 보기」로 자리마다 값을 견주어 보세요.');
      var si = defaultSi(C, cfg), rel = relOf(C.exp, si), o0 = null;
      var list = [];
      C.withRows.forEach(function (G) {
        var o = slopeOf(G.rows, si, rel, C.xLabel, C.xUnit, seriesLabel(C, si), seriesUnit(C, si));
        o0 = o;
        if (o.slope === null) return;
        list.push({ name: G.name + (G.cond ? ' · ' + G.cond : ''), mine: G.mine, color: G.color, slope: o.slope, r2: o.r2, n: o.n });
      });
      if (!list.length) return empty('기울기를 낼 수 있는 모둠이 아직 없습니다(값 두 줄 이상 · 가로축이 서로 달라야 합니다).');
      list.sort(function (a, b) { return b.slope - a.slope; });
      var mx = Math.max.apply(null, list.map(function (x) { return Math.abs(x.slope); })) || 1;
      var u = o0.unit;
      var h = '<div class="dk-bars">';
      list.forEach(function (x, i) {
        h += '<div class="dk-bar' + (x.mine ? ' dk-me' : '') + '">' +
             '<div class="dk-nm">' + (i + 1) + '위 ' + esc(x.name) + '</div>' +
             '<div class="dk-tr"><i style="width:' + (Math.abs(x.slope) / mx * 100).toFixed(1) + '%;background:' + x.color + '"></i></div>' +
             '<div class="dk-sc">' + esc(sciNum(x.slope)) + ' ' + esc(u) + ' · R²' + esc(fmtR2(x.r2)) + '</div></div>';
      });
      h += '</div><p class="dk-sub">' + (rel ? '곡선 관계라 ' + esc(o0.yLab) + ' ↔ ' + esc(o0.xLab) + ' 로 바꿔 낸 기울기 순입니다. '
                                             : '세로축 = ' + esc(seriesLabel(C, si)) + ' 의 기울기 순입니다. ') +
           '막대 길이는 기울기의 크기(부호는 숫자로 보세요).</p>';
      return h;
    },

    mypos: function (C, cfg) {
      if (!C.gid) return empty('우리 모둠을 고르면 위치를 보여 줍니다.');
      if (C.catX) return empty('가로축이 이름(자리·조건)이라 기울기로 줄 세우지 않습니다.');
      var si = defaultSi(C, cfg), rel = relOf(C.exp, si), u = '';
      var vals = [], mine = null;
      C.withRows.forEach(function (G) {
        var o = slopeOf(G.rows, si, rel, C.xLabel, C.xUnit, seriesLabel(C, si), seriesUnit(C, si));
        u = o.unit;
        if (o.slope === null) return;
        vals.push(o.slope);
        if (G.mine) mine = o.slope;
      });
      if (!vals.length) return empty('반 전체 기울기를 아직 낼 수 없습니다.');
      if (mine === null) return empty('우리 모둠의 기울기를 아직 낼 수 없습니다. 값을 두 줄 이상 적어 보세요.');
      var sorted = vals.slice().sort(function (a, b) { return b - a; });
      var rank = sorted.indexOf(mine) + 1;
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var pos = (hi === lo) ? 50 : ((mine - lo) / (hi - lo) * 100);
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
           ' (세로축 = ' + esc(seriesLabel(C, si)) + (rel ? ' · 곡선 관계라 바꾼 축에서 낸 기울기' : '') + ')</p>';
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
  var WIDTHS = [{ w: 4, name: '1칸', short: '1/3' }, { w: 6, name: '2칸', short: '1/2' }, { w: 12, name: '전체', short: '전체' }];
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
    //  실험 번호(sm-05 따위)는 안쪽 이름이라 보여 주지 않습니다 — 제목이 따로 다르면 실험 이름을 적습니다.
    if (C.exp && C.exp.title && C.exp.title !== (L.title || C.title)) line2.push('실험 ' + esc(C.exp.title));
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
      inner += '<div class="dk-empty">아직 고른 칸이 없습니다. 위에서 <b>틀</b>을 고르거나 <b>＋ 칸 더하기</b>를 눌러 보세요.</div>';
    } else {
      inner += '<div class="dk-grid">';
      L.items.forEach(function (it) { inner += renderBlock(it.key, ctx, { w: it.w, cfg: it.cfg }); });
      inner += '</div>';
    }
    if (opt.foot !== false) {
      inner += '<div class="dk-foot">MBL 수업허브 · 이 대시보드는 우리 반이 실제로 모은 자료로 만들었습니다.' +
               (C.school ? ' · ' + esc(C.school) : '') + '</div>';
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
    { key: 'pitch',    name: '발표 한 장', theme: 'light', tag: '추천',
      desc: '핵심 그래프 · 지금 값 · 기울기 · 우리의 결론을 한 장에 담습니다. 제목은 맨 위를 눌러 바꿉니다.',
      want: [['tf', 12], ['value', 6], ['fit', 6], ['memo', 12, { title: '우리의 결론' }]] },
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
        if (canUse(pair[0], ctx).ok) items.push({ key: pair[0], w: pair[1], cfg: pair[2] ? JSON.parse(JSON.stringify(pair[2])) : {} });
      });
      out.push({
        key: P.key, name: P.name, desc: P.desc, tag: P.tag || '', ready: items.length,
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
      out.unshift({ key: 'start', name: '실험 안내로 시작', ready: fall.length, tag: '',
                    desc: '측정값이 아직 없어도 쓸 수 있는 것부터.',
                    layout: { theme: 'light', title: '', items: fall } });
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  10. 빌더 UI — mount
  //    학생이 쓰기 쉽게, 흔히 쓰는 도구(Canva·구글 슬라이드·패들렛·노션)의 방식을 따릅니다.
  //    ① 틀(그림 미리보기) 고르기 ② 미리보기의 칸을 눌러 그 자리에서 고치기(순서·크기·빼기)
  //    ③ ＋ 칸 더하기는 아이콘 카드 창 ④ ↶ 되돌리기 ⑤ 주 단추는 ▶ 발표하기 하나, 나머지는 「저장·인쇄」 안에.
  //    opt.autosave 면 고칠 때마다 저절로 onSave 를 부릅니다(학생 화면). 끌어 옮기기는 쓰지 않습니다(전자칠판·터치).
  // ─────────────────────────────────────────────────────────────────
  var UI_CSS_ID = 'dk-ui-css';
  function uiCSS() {
    return [
      '.dkui{color:var(--ink,#254753);position:relative}',
      '.dkui button{font:inherit;cursor:pointer;border-radius:10px;border:1.5px solid var(--line-2,#D3E6EA);' +
        'background:var(--paper,#fff);color:var(--ink,#254753);padding:8px 12px;font-size:14px;font-weight:700;min-height:40px}',
      '.dkui button:hover{border-color:var(--mint,#20B2A6)}',
      '.dkui button.on{background:var(--mint-d,#14867C);border-color:var(--mint-d,#14867C);color:#fff}',
      '.dkui button[disabled]{opacity:.45;cursor:not-allowed}',
      //  흰 글자가 읽히게 진한 산호색(4.5:1 이상)을 씁니다.
      '.dkui .dkui-go{background:#B8441F;border-color:#B8441F;color:#fff;font-size:15px;padding:8px 18px}',
      '.dkui .dkui-go:hover{border-color:#9C3816;background:#9C3816}',
      '.dkui .dkui-tools{position:sticky;top:var(--dk-sticky,0px);z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;' +
        'background:var(--paper,#fff);border:1.5px solid var(--line,#E4EFF1);border-radius:14px;padding:8px 10px;box-shadow:0 6px 16px rgba(37,71,83,.06)}',
      '.dkui .dkui-grow{flex:1 1 auto}',
      '.dkui .dkui-lab{font-size:12.5px;font-weight:800;color:var(--muted,#56707C)}',
      '.dkui .dkui-seg{display:inline-flex;border:1.5px solid var(--line-2,#D3E6EA);border-radius:10px;overflow:hidden}',
      '.dkui .dkui-seg button{border:0;border-radius:0;min-height:36px;padding:6px 10px;font-size:13px}',
      '.dkui .dkui-status{font-size:12.5px;color:var(--mint-d,#14867C);font-weight:700}',
      '.dkui .dkui-hint{font-size:13px;color:var(--muted,#56707C);margin:8px 2px}',
      '.dkui .dkui-hint b{color:var(--ink,#254753)}',
      '.dkui details.dkui-more{position:relative}',
      '.dkui details.dkui-more>summary{list-style:none;cursor:pointer;border:1.5px solid var(--line-2,#D3E6EA);border-radius:10px;' +
        'padding:8px 12px;font-weight:700;font-size:14px;min-height:40px;display:flex;align-items:center;background:var(--paper,#fff)}',
      '.dkui details.dkui-more>summary::-webkit-details-marker{display:none}',
      '.dkui details.dkui-more>div{position:absolute;right:0;top:calc(100% + 6px);z-index:20;background:var(--paper,#fff);' +
        'border:1.5px solid var(--line,#E4EFF1);border-radius:12px;padding:6px;box-shadow:0 12px 28px rgba(0,0,0,.14);display:grid;gap:4px;min-width:230px}',
      '.dkui details.dkui-more>div button{text-align:left;border-color:transparent}',
      // 틀 고르기
      '.dkui .dkui-gallery{margin:10px 0;padding:12px;border:1.5px solid var(--line,#E4EFF1);border-radius:16px;background:var(--cream,#FFFDF6)}',
      '.dkui .dkui-gallery h3{margin:0 0 2px;font-size:16px}',
      '.dkui .dkui-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:10px}',
      '.dkui .dkui-tpl{display:flex;flex-direction:column;align-items:stretch;gap:6px;text-align:left;padding:10px;border-radius:14px}',
      '.dkui .dkui-tpl:hover{box-shadow:0 8px 20px rgba(32,178,166,.18)}',
      '.dkui .dkui-tpl b{font-size:15px}',
      '.dkui .dkui-tpl small{font-size:12px;color:var(--muted,#56707C);font-weight:600;line-height:1.5}',
      '.dkui .dkui-tag{align-self:flex-start;font-size:11px;font-weight:800;color:#fff;background:var(--coral,#FF8C6B);border-radius:999px;padding:2px 8px}',
      '.dkui .dkui-ready{font-size:11.5px;color:var(--mint-d,#14867C);font-weight:800}',
      '.dkui .dkui-thumb{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;padding:6px;background:#EEF7F6;border-radius:10px;' +
        'height:104px;align-content:start;overflow:hidden}',
      '.dkui .dkui-thumb i{font-style:normal;background:#fff;border:1px solid #D3E6EA;border-radius:5px;height:28px;' +
        'display:flex;align-items:center;justify-content:center;font-size:13px}',
      // 미리보기에서 바로 고치기
      '.dkui .dkui-canvas{margin-top:10px}',
      '.dkui .dkui-canvas .dk-b{position:relative;cursor:pointer;outline:2px solid transparent;outline-offset:2px;transition:outline-color .15s}',
      '.dkui .dkui-canvas .dk-b:hover{outline-color:#9ADCD5}',
      '.dkui .dkui-canvas .dk-b.dkui-on{outline:3px solid var(--mint,#20B2A6)}',
      '.dkui .dkui-canvas .dk-head{cursor:pointer;border-radius:12px;outline:2px solid transparent;outline-offset:4px;transition:outline-color .15s}',
      '.dkui .dkui-canvas .dk-head:hover{outline-color:#9ADCD5}',
      '.dkui .dkui-canvas .dk-head.dkui-on{outline:3px solid var(--mint,#20B2A6)}',
      '.dkui input.dkui-tx{min-height:0}',
      '.dkui .dkui-float{position:absolute;top:.4em;right:.4em;z-index:3;display:flex;flex-wrap:wrap;gap:4px;align-items:center;' +
        'background:#fff;border:1.5px solid #D3E6EA;border-radius:12px;padding:4px;box-shadow:0 8px 20px rgba(0,0,0,.14);font-size:13px}',
      '.dkui .dkui-float button{min-height:34px;padding:4px 9px;font-size:13px;border-radius:8px}',
      '.dkui .dkui-float .dkui-del{color:#C2410C}',
      '.dkui .dkui-addtile{grid-column:span 12;border:2px dashed var(--line-2,#D3E6EA);background:transparent;color:var(--muted,#56707C);' +
        'font-size:15px;padding:18px;border-radius:14px}',
      '.dkui .dkui-addtile:hover{color:var(--mint-d,#14867C);border-color:var(--mint,#20B2A6)}',
      '.dkui textarea.dkui-tx{display:block;width:100%;margin-top:.6em;font:inherit;font-size:15px;border:2px solid var(--mint,#20B2A6);' +
        'border-radius:10px;padding:8px 10px;resize:vertical;min-height:3.4em;background:#fff;color:#254753}',
      '.dkui .dkui-msg{font-size:13px;color:var(--muted,#56707C);margin:8px 2px 0;min-height:1.2em}',
      // ＋ 칸 더하기 창
      '.dkui .dkui-modal{position:fixed;inset:0;z-index:60;background:rgba(20,40,48,.45);display:flex;align-items:flex-end;justify-content:center;padding:12px}',
      '.dkui .dkui-modal[hidden]{display:none}',
      '.dkui .dkui-sheet{background:#fff;width:min(920px,100%);max-height:86vh;overflow:auto;border-radius:18px;padding:14px 16px;box-shadow:0 20px 60px rgba(0,0,0,.25)}',
      '.dkui .dkui-sheethead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}',
      '.dkui .dkui-sheethead b{font-size:17px}',
      '.dkui .dkui-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
      '.dkui .dkui-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}',
      '.dkui .dkui-card{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:12px;border-radius:14px;min-height:108px}',
      '.dkui .dkui-card i{font-style:normal;font-size:26px;line-height:1}',
      '.dkui .dkui-card b{font-size:14.5px}',
      '.dkui .dkui-card small{font-size:12px;color:var(--muted,#56707C);font-weight:600;line-height:1.45}',
      '.dkui .dkui-card.off{opacity:.55}',
      '.dkui .dkui-card.off small{color:#C2410C}',
      '.dkui .dkui-offtoggle{display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;color:var(--muted,#56707C);font-weight:700}',
      // ▶ 발표하기(전체 화면) — 편집 도구가 없는 깨끗한 화면
      '.dkui-show{position:fixed;inset:0;z-index:9999;background:#F4FBF6;overflow:auto;padding:16px}',
      '.dkui-show .dkui-x{position:fixed;top:12px;right:14px;z-index:2;font:inherit;font-weight:800;border:0;border-radius:999px;' +
        'background:rgba(37,71,83,.85);color:#fff;padding:8px 14px;cursor:pointer}',
      '@media (max-width:640px){.dkui .dkui-tools{position:static}}'
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
    var auto = !!opt.autosave;            // 고칠 때마다 저절로 저장(학생 화면)
    var sel = -1;                         // 고른 칸 (-1 없음 · -2 맨 위 제목)
    var undo = [];                        // 되돌리기 — 고치기 전 구성을 쌓아 둡니다
    var saveT = null;
    var galleryOpen = !L.items.length || opt.start === 'gallery';
    var pickTab = null, showOff = false, psCache = [];

    el.classList.add('dkui');
    el.innerHTML =
      '<div class="dkui-tools">' +
        '<button type="button" data-dk="gallery">🧩 틀 고르기</button>' +
        '<button type="button" data-dk="pick">＋ 칸 더하기</button>' +
        '<button type="button" data-dk="undo" title="방금 고친 것을 되돌립니다">↶ 되돌리기</button>' +
        '<span class="dkui-lab">화면</span><span class="dkui-seg" data-dk="themes"></span>' +
        '<span class="dkui-grow"></span>' +
        '<span class="dkui-status" data-dk="status"></span>' +
        (auto ? '' : '<button type="button" data-dk="keep">💾 이 구성 저장</button>') +
        '<button type="button" class="dkui-go" data-dk="present">▶ 발표하기</button>' +
        '<details class="dkui-more"><summary>저장·인쇄 ▾</summary><div>' +
          '<button type="button" data-dk="save">📄 HTML 파일로 내려받기</button>' +
          '<button type="button" data-dk="print">🖨 인쇄 · PDF</button>' +
          '<button type="button" data-dk="ai">🤖 AI 와 함께 해석하기</button>' +
          '<button type="button" data-dk="clear">🗑 칸 모두 비우기</button>' +
        '</div></details>' +
      '</div>' +
      '<p class="dkui-hint"><b>① 틀 고르기</b> → <b>② 제목 · 칸을 눌러 고치기</b>(순서 · 크기 · 빼기) → <b>③ ▶ 발표하기</b>' +
        (auto ? ' · 고친 것은 저절로 저장됩니다.' : '') + '</p>' +
      '<div class="dkui-gallery" data-dk="galleryBox" hidden></div>' +
      '<div class="dkui-canvas" data-dk="prev"></div>' +
      '<p class="dkui-msg" data-dk="msg"></p>' +
      '<div class="dkui-modal" data-dk="pickBox" hidden></div>';

    var $ = function (k) { return el.querySelector('[data-dk="' + k + '"]'); };
    function note(t) { $('msg').textContent = t || ''; }
    function status(t) { $('status').textContent = t || ''; }

    function fire(name) {
      if (typeof opt[name] !== 'function') return;
      try { opt[name](JSON.parse(JSON.stringify(L)), ctx); } catch (e) {}
    }
    function scheduleSave() {
      if (!auto) return;
      if (saveT) w.clearTimeout(saveT);
      status('고치는 중… 곧 저장합니다');
      //  먼저 '저장했습니다' 로 적어 두고, 실패하면 부른 쪽이 status() 로 고쳐 적습니다.
      saveT = w.setTimeout(function () { saveT = null; status('저절로 저장했습니다 ✓'); fire('onSave'); }, 1200);
    }
    function snap() { undo.push(JSON.stringify(L)); if (undo.length > 30) undo.shift(); }
    function changed() { repaint(); scheduleSave(); }

    function paintThemes() {
      var h = '';
      ['light', 'dark', 'big'].forEach(function (k) {
        h += '<button type="button" data-dk="theme" data-k="' + k + '"' + (L.theme === k ? ' class="on"' : '') + '>' +
             esc(THEMES[k].name) + '</button>';
      });
      $('themes').innerHTML = h;
    }

    //  틀 고르기 — 틀마다 칸 배치를 작은 그림으로 보여 줍니다(무엇이 들어가는지 고르기 전에 보이게).
    function thumbHTML(items) {
      var h = '<div class="dkui-thumb">';
      (items || []).forEach(function (it) {
        var B = BMAP[it.key];
        h += '<i style="grid-column:span ' + normW(it.w) + '" title="' + esc(B.name) + '">' + (B.icon || '▫') + '</i>';
      });
      return h + '</div>';
    }
    function paintGallery() {
      var box = $('galleryBox');
      box.hidden = !galleryOpen;
      if (!galleryOpen) { box.innerHTML = ''; return; }
      psCache = presets(ctx);
      var h = '<h3>🧩 틀을 고르세요</h3><p class="dkui-msg" style="margin:0">고르면 바로 대시보드가 만들어집니다. ' +
              '그다음 칸을 눌러 고치면 됩니다. 마음에 안 들면 ↶ 되돌리기.</p><div class="dkui-tpls">';
      psCache.forEach(function (p) {
        h += '<button type="button" class="dkui-tpl" data-dk="preset" data-k="' + esc(p.key) + '"' + (p.ready ? '' : ' disabled') + '>' +
             (p.tag ? '<span class="dkui-tag">' + esc(p.tag) + '</span>' : '') +
             thumbHTML(p.layout.items) + '<b>' + esc(p.name) + '</b><small>' + esc(p.desc) + '</small>' +
             (p.ready ? '<span class="dkui-ready">지금 바로 채워지는 칸 ' + p.ready + '개</span>'
                      : '<small>자료가 더 모이면 쓸 수 있습니다.</small>') + '</button>';
      });
      h += '<button type="button" class="dkui-tpl" data-dk="blank"><div class="dkui-thumb"></div>' +
           '<b>빈 화면에서 시작</b><small>칸을 하나씩 직접 더합니다.</small></button>';
      box.innerHTML = h + '</div>';
    }

    //  고른 칸 위에 뜨는 작은 도구막대 — 앞으로 · 뒤로 · 크기 · 빼기
    function floatHTML(i) {
      var it = L.items[i];
      var h = '<div class="dkui-float">' +
        '<button type="button" data-dk="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="앞으로">↑</button>' +
        '<button type="button" data-dk="down" data-i="' + i + '"' + (i === L.items.length - 1 ? ' disabled' : '') + ' title="뒤로">↓</button>';
      WIDTHS.forEach(function (x) {
        h += '<button type="button" data-dk="w" data-i="' + i + '" data-w="' + x.w + '"' + (it.w === x.w ? ' class="on"' : '') +
             ' title="폭 ' + x.short + '">' + x.short + '</button>';
      });
      return h + '<button type="button" class="dkui-del" data-dk="del" data-i="' + i + '">🗑 빼기</button></div>';
    }
    function paintPrev() {
      //  미리보기는 진짜 데이터로 그립니다 — 데모 데이터는 쓰지 않습니다.
      ensureStyle(doc, THEME_CSS_ID, css(L.theme));
      var box = $('prev');
      box.innerHTML = render(L, ctx);
      Array.prototype.forEach.call(box.querySelectorAll('.dk-grid > .dk-b'), function (sec, i) {
        sec.setAttribute('data-i', String(i));
        if (i !== sel) return;
        sec.classList.add('dkui-on');
        sec.insertAdjacentHTML('afterbegin', floatHTML(i));
        var it = L.items[i];
        if (it && (it.key === 'bigtitle' || it.key === 'memo')) {
          sec.insertAdjacentHTML('beforeend', '<textarea class="dkui-tx" data-dk="text" data-i="' + i + '" placeholder="' +
            (it.key === 'bigtitle' ? '큰 제목에 쓸 글' : '여기에 글을 적으세요(예: 우리의 결론)') + '">' + esc(it.cfg.text || '') + '</textarea>');
        }
      });
      var head = box.querySelector('.dk-root > .dk-head');
      if (head && sel === -2) {
        head.classList.add('dkui-on');
        head.insertAdjacentHTML('beforeend', '<input type="text" class="dkui-tx" data-dk="title" maxlength="60" ' +
          'placeholder="대시보드 제목 (비우면 실험 이름)" value="' + esc(L.title || '') + '" />');
      }
      var tile = '<button type="button" class="dkui-addtile" data-dk="pick">＋ 칸 더하기</button>';
      var grid = box.querySelector('.dk-grid'), none = box.querySelector('.dk-root > .dk-empty');
      if (grid) grid.insertAdjacentHTML('beforeend', tile);
      else if (none) none.insertAdjacentHTML('afterend', '<div class="dk-grid">' + tile + '</div>');
    }

    //  ＋ 칸 더하기 — 묶음 탭 + 아이콘 카드. 지금 못 쓰는 칸은 접어 두고, 원하면 까닭과 함께 봅니다.
    function firstTab() {
      for (var g = 0; g < GROUPS.length; g++) {
        for (var b = 0; b < BLOCKS.length; b++) {
          if (BLOCKS[b].group === GROUPS[g] && canUse(BLOCKS[b].key, ctx).ok) return GROUPS[g];
        }
      }
      return GROUPS[0];
    }
    function paintPick() {
      var box = $('pickBox');
      if (box.hidden) return;
      if (!pickTab) pickTab = firstTab();
      var tabs = '<div class="dkui-tabs">';
      GROUPS.forEach(function (g) {
        tabs += '<button type="button" data-dk="tab" data-g="' + esc(g) + '"' + (g === pickTab ? ' class="on"' : '') + '>' +
                esc(GLABEL[g] || g) + '</button>';
      });
      tabs += '</div>';
      var cards = '', off = 0;
      BLOCKS.forEach(function (b) {
        if (b.group !== pickTab) return;
        var can = canUse(b.key, ctx);
        if (!can.ok) { off++; if (!showOff) return; }
        cards += '<button type="button" class="dkui-card' + (can.ok ? '' : ' off') + '" data-dk="add" data-k="' + esc(b.key) + '"' +
                 (can.ok ? '' : ' disabled') + '><i>' + (b.icon || '▫') + '</i><b>' + esc(b.name) + '</b><small>' +
                 esc(can.ok ? b.desc : can.why) + '</small></button>';
      });
      box.innerHTML = '<div class="dkui-sheet" role="dialog" aria-label="칸 더하기">' +
        '<div class="dkui-sheethead"><b>＋ 칸 더하기' + (sel !== -1 ? ' <span style="font-size:13px;font-weight:600;color:#56707C">· ' +
          (sel === -2 ? '제목 바로 아래에' : '고른 칸 바로 뒤에') + ' 들어갑니다</span>' : '') +
        '</b><button type="button" data-dk="pickClose">닫기</button></div>' + tabs +
        '<div class="dkui-cards">' + (cards || '<p class="dkui-msg">이 묶음에는 지금 쓸 수 있는 칸이 없습니다.</p>') + '</div>' +
        (off ? '<label class="dkui-offtoggle"><input type="checkbox" data-dk="showOff"' + (showOff ? ' checked' : '') + ' /> ' +
               '아직 못 쓰는 칸도 보기(' + off + '개 · 무엇이 있으면 되는지 알려 줍니다)</label>' : '') +
        '</div>';
    }
    function openPick() { $('pickBox').hidden = false; if (!pickTab) pickTab = firstTab(); paintPick(); }
    function closeMore() { var d = el.querySelector('details.dkui-more'); if (d) d.open = false; }

    function repaint() {
      try { delete ctx.__dk; } catch (e) { ctx.__dk = null; }   // 새로 세도록 캐시를 비웁니다
      if (sel >= L.items.length) sel = -1;
      paintThemes(); paintGallery(); paintPrev(); paintPick();
      $('undo').disabled = !undo.length;
      $('gallery').classList.toggle('on', galleryOpen);
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

    //  ▶ 발표하기 — 고치는 도구 없이 깨끗한 대시보드만 화면 가득. Esc 나 ✕ 로 닫습니다.
    function present() {
      var ov = doc.createElement('div');
      ov.className = 'dkui-show';
      ov.innerHTML = '<button type="button" class="dkui-x">✕ 닫기 (Esc)</button>' + render(L, ctx);
      doc.body.appendChild(ov);
      function close() {
        doc.removeEventListener('keydown', onKey);
        doc.removeEventListener('fullscreenchange', onFs);
        try { if (doc.fullscreenElement === ov && doc.exitFullscreen) doc.exitFullscreen(); } catch (e) {}
        if (ov.parentNode) ov.parentNode.removeChild(ov);
      }
      function onKey(e) { if (e.key === 'Escape') close(); }
      function onFs() { if (!doc.fullscreenElement) close(); }
      ov.querySelector('.dkui-x').addEventListener('click', close);
      doc.addEventListener('keydown', onKey);
      if (ov.requestFullscreen) {
        try {
          var pr = ov.requestFullscreen();
          if (pr && pr.then) pr.then(function () { doc.addEventListener('fullscreenchange', onFs); }, function () {});
        } catch (e) {}
      }
    }

    function doUndo() {
      if (!undo.length) return;
      L = normLayout(JSON.parse(undo.pop()));
      sel = -1;
      changed();
      note('되돌렸습니다.');
    }

    el.addEventListener('click', function (ev) {
      var t = ev.target;
      var more = el.querySelector('details.dkui-more');
      if (more && more.open && !more.contains(t)) more.open = false;    // 바깥을 누르면 메뉴를 닫습니다
      var btn = t;
      while (btn && btn !== el && !(btn.getAttribute && btn.getAttribute('data-dk'))) btn = btn.parentNode;
      if (!btn || btn === el || !btn.getAttribute) return;
      var k = btn.getAttribute('data-dk');
      var i = Number(btn.getAttribute('data-i'));

      //  미리보기의 칸을 누르면 그 칸이 골라집니다. 빈 곳을 누르면 고른 것을 풉니다.
      if (k === 'prev') {
        var hd = t.closest ? t.closest('.dk-head') : null;
        if (hd && btn.contains(hd)) {
          sel = (sel === -2) ? -1 : -2;
          repaint();
          var ti = $('prev').querySelector('[data-dk="title"]');
          if (ti) { try { ti.focus(); ti.select(); } catch (e) {} }
          return;
        }
        var sec = t.closest ? t.closest('.dk-b') : null;
        if (sec && btn.contains(sec)) {
          var si = Number(sec.getAttribute('data-i'));
          sel = (sel === si) ? -1 : si;
          repaint();
        } else if (sel >= 0) { sel = -1; repaint(); }
        return;
      }
      if (k === 'pickBox') { if (t === btn) btn.hidden = true; return; }   // 창 바깥(어두운 곳)을 누르면 닫습니다
      if (k === 'text' || k === 'title' || k === 'showOff' || k === 'galleryBox' || k === 'msg' || k === 'status' || k === 'themes') return;

      if (k === 'theme') { snap(); L.theme = btn.getAttribute('data-k'); changed(); return; }
      if (k === 'gallery') { galleryOpen = !galleryOpen; repaint(); return; }
      if (k === 'preset') {
        for (var n = 0; n < psCache.length; n++) {
          if (psCache[n].key !== btn.getAttribute('data-k')) continue;
          snap();
          var keepTitle = L.title;                                  // 적어 둔 제목은 틀을 바꿔도 그대로 둡니다
          L = normLayout(psCache[n].layout);
          L.title = keepTitle;
          sel = -1; galleryOpen = false;
          changed();
          note('「' + psCache[n].name + '」 틀로 만들었습니다 · 칸 ' + L.items.length + '개. 칸을 눌러 고치세요. 마음에 안 들면 ↶ 되돌리기.');
          return;
        }
        return;
      }
      if (k === 'blank') { snap(); L.items = []; sel = -1; galleryOpen = false; changed(); openPick(); return; }
      if (k === 'pick') { openPick(); return; }
      if (k === 'pickClose') { $('pickBox').hidden = true; return; }
      if (k === 'tab') { pickTab = btn.getAttribute('data-g'); paintPick(); return; }
      if (k === 'add') {
        var key = btn.getAttribute('data-k');
        if (!BMAP[key]) return;
        snap();
        var at = (sel >= 0) ? sel + 1 : (sel === -2 ? 0 : L.items.length);
        L.items.splice(at, 0, { key: key, w: BMAP[key].w, cfg: {} });
        sel = at; galleryOpen = false;
        $('pickBox').hidden = true;
        changed();
        note(BMAP[key].name + ' 칸을 더했습니다.');
        var sec2 = $('prev').querySelector('.dk-b[data-i="' + at + '"]');
        if (sec2 && sec2.scrollIntoView) { try { sec2.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
        return;
      }
      if (k === 'up' && i > 0) {
        snap(); var a = L.items[i - 1]; L.items[i - 1] = L.items[i]; L.items[i] = a; sel = i - 1; changed(); return;
      }
      if (k === 'down' && i < L.items.length - 1) {
        snap(); var b = L.items[i + 1]; L.items[i + 1] = L.items[i]; L.items[i] = b; sel = i + 1; changed(); return;
      }
      if (k === 'w') { if (L.items[i]) { snap(); L.items[i].w = normW(btn.getAttribute('data-w')); changed(); } return; }
      if (k === 'del') {
        if (!L.items[i]) return;
        snap();
        var nm = BMAP[L.items[i].key].name;
        L.items.splice(i, 1); sel = -1;
        changed();
        note(nm + ' 칸을 뺐습니다. ↶ 되돌리기로 되살릴 수 있습니다.');
        return;
      }
      if (k === 'undo') { doUndo(); return; }
      closeMore();
      if (k === 'clear') {
        snap(); L.items = []; sel = -1; galleryOpen = true; changed();
        note('칸을 모두 비웠습니다. ↶ 되돌리기로 되살릴 수 있습니다.');
        return;
      }
      if (k === 'present') { present(); return; }
      if (k === 'print')   { w.print(); return; }
      if (k === 'keep')    { fire('onSave'); return; }        // 저장 결과는 부른 쪽이 알려 줍니다
      if (k === 'ai')      { fire('onAI'); return; }
      if (k === 'save')    { doSave(); return; }
    });

    //  큰 제목 · 글 상자 — 글을 치는 동안에는 그 칸의 글만 바꿉니다(다시 그리면 글칸이 사라집니다).
    el.addEventListener('focusin', function (ev) {
      var t = ev.target, k = t && t.getAttribute && t.getAttribute('data-dk');
      if (k === 'text' || k === 'title') snap();
    });
    el.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-dk') === 'title') {
        L.title = t.value;
        var h1 = $('prev').querySelector('.dk-head h1');
        if (h1) h1.textContent = t.value || prep(ctx).title || '실험 대시보드';
        $('undo').disabled = !undo.length;
        scheduleSave();
        return;
      }
      if (!t || !t.getAttribute || t.getAttribute('data-dk') !== 'text') return;
      var it = L.items[Number(t.getAttribute('data-i'))];
      if (!it) return;
      it.cfg.text = t.value;
      var sec = t.closest ? t.closest('.dk-b') : null;
      var body = sec && sec.querySelector('.dk-title, .dk-note, .dk-empty');
      if (body) { try { body.outerHTML = BODY[it.key](prep(ctx), it.cfg); } catch (e) {} }
      $('undo').disabled = !undo.length;
      scheduleSave();
    });
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-dk') === 'showOff') { showOff = !!t.checked; paintPick(); }
    });
    //  단축키는 문서 전체에서 받습니다 — 칸 더하기 창이 닫히면 누른 단추가 사라져 초점이 편집기 밖으로 나가기 때문입니다.
    //  편집기가 화면에 보일 때만, 그리고 글을 치는 중이 아닐 때만 움직입니다.
    function onKey(ev) {
      if (!el.isConnected || !el.offsetParent || doc.querySelector('.dkui-show')) return;
      var tg = ev.target, typing = tg && (tg.tagName === 'TEXTAREA' || tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.isContentEditable);
      if (typing && !el.contains(tg)) return;                // 다른 입력 칸에서 누른 단축키는 건드리지 않습니다
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z') && !typing) {
        if (!undo.length) return;
        ev.preventDefault(); doUndo(); return;
      }
      if (ev.key === 'Escape') {
        if (!$('pickBox').hidden) { $('pickBox').hidden = true; return; }
        if (sel !== -1 && (!typing || el.contains(tg))) { sel = -1; repaint(); }
      }
    }
    doc.addEventListener('keydown', onKey);

    repaint();

    return {
      get: function () { return JSON.parse(JSON.stringify(L)); },
      set: function (layout) { L = normLayout(layout); sel = -1; undo = []; repaint(); },
      refresh: function (newCtx) {
        if (newCtx) ctx = newCtx;
        var a = doc.activeElement;
        if (a && el.contains(a) && a.getAttribute && /^(text|title)$/.test(a.getAttribute('data-dk') || '')) return;   // 글을 치는 중에는 그대로
        repaint();
      },
      html: function () { return render(L, ctx); },
      file: function () { return { name: fileName(ctx, L), html: standalone(L, ctx) }; },
      describe: function () { return describe(L, ctx); },
      note: note,
      status: status,
      //  기다리던 저장을 지금 바로 합니다(탭을 옮길 때 · 화면을 가릴 때 부릅니다).
      flush: function () {
        if (!saveT) return;
        w.clearTimeout(saveT); saveT = null;
        status('저절로 저장했습니다 ✓'); fire('onSave');
      },
      //  없앨 때는 기다리던 저장을 버립니다 — 모둠이 바뀐 뒤라면 엉뚱한 모둠에 저장될 수 있어서.
      destroy: function () {
        if (saveT) { w.clearTimeout(saveT); saveT = null; }
        doc.removeEventListener('keydown', onKey);
        el.innerHTML = ''; el.classList.remove('dkui');
      }
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
    //  그래프 — 교사 화면·발표 화면이 같은 약속(둘째 축·계산 열 빼기·1·2·5 눈금·곡선 관계)으로 그립니다.
    chartSVG: chartSVG,
    multiChart: multiChart,
    niceScale: niceScale,
    isCalc: isCalc,
    relOf: relOf,
    curveFit: curveFit,
    slopeOf: slopeOf,
    slopeUnit: slopeUnit,
    //  검증·재사용을 위해 열어 두는 순수 함수들
    _prep: prep, _chart: chart, _esc: esc
  };
});
