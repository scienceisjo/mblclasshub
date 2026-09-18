// =====================================================================
//  lab-engine.js — MBL 수업허브 "계산 엔진"  (전역 window.LabEngine)
//
//  ▣ 무엇인가
//    데이터 실험실(축 변환 · 파생열 · 최소제곱)과 붙여넣기 분석(runAnalysis)에서
//    "값을 만드는 부분"만 모아 둔 파일입니다. 원래 index.html 안에 있던 함수들을 그대로 옮겼습니다.
//    화면(DOM) · 전역 상태(LABS · AN · spec) · HTML 조립(anBlockHTML 따위)은 index.html 에 남아 있습니다.
//    학생이 손으로 표 · 변환 · 그래프를 만드는 탐구 모드(inquiry.html)가 같은 계산을 써야 해서 떼어 냈습니다 —
//    두 화면이 서로 다른 기울기 · R² 를 보여 주면 안 되기 때문입니다.
//
//  ▣ 쓰는 법
//    <script src="lab-data.js"></script>     ← LAB.analysisOf (없으면 exp.analysis 를 직접 읽습니다)
//    <script src="hub.js"></script>          ← Hub.stats · Hub.cellAt (최소제곱 · 칸 읽기는 hub.js 한 곳)
//    <script src="lab-engine.js"></script>
//
//    const rows = [[5, 1.08, 5.40], [7, 0.73, 5.11], …];        // 데이터 입력표와 같은 모양 [x, s0, s1…]
//    const res  = LabEngine.runAnalysis(LAB.byId('sm-05'), rows);
//    res.vals.slope · res.vals.r2 · res.verdict.text · res.blocks[i].fit …
//
//    node 에서도 시험할 수 있습니다.  globalThis.Hub · globalThis.LAB 을 먼저 두고
//    const E = require('./lab-engine.js');
//
//  ▣ 내보내는 것
//    LabEngine.cell(row, col)                        한 칸 읽기 (Hub.cellAt 규칙)
//    LabEngine.LAB_TF · TF_ORDER · TF_WHY            축 변환 7종 · 고르는 차례 · 건너뛴 까닭
//    LabEngine.labNum(v) · fmtR2(v) · slopeUnit(yu, xu)   숫자 · R² · 기울기 단위 표기
//    LabEngine.setDerivedSource(fn)                  ds 없이 부를 때 쓸 파생열 목록을 걸어 둡니다
//    LabEngine.derivedIn(ds, k) · rawVal(row, k, ds) · colMin(rows, k, ds)
//    LabEngine.labPoints(rows, xk, xt, yk, yt, minX, minY, ds)   변환한 (x, y) 점들
//    LabEngine.labFit(pts)                           최소제곱 (Hub.stats 로 넘김) + ok
//    LabEngine.AN_OPS                                레시피의 연산 기호 → 표시 기호
//    LabEngine.anColName(sp, ds, k) · anColUnit(sp, ds, k)   열 이름 · 단위
//    LabEngine.anStat(rows, k, ds)                   한 열의 통계 (+ range)
//    LabEngine.anFill(text, v) · anVerdict(list, v)  문장 채우기 · 판정 고르기
//    LabEngine.runAnalysis(exp, rows)                레시피(exp.analysis) 실행 → {goal, blocks, vals, mainFit, verdict …}
//    LabEngine.anAxText(name, unit, tf)              축 이름표 (변환 이름 + 단위)
//
//  ▣ 설계 원칙
//    · 계산 결과는 index.html 안에 있던 때와 한 자리도 다르지 않습니다. 옮기기만 했고 고치지 않았습니다.
//    · 최소제곱은 Hub.stats 한 곳에서만 — 여기서는 변환한 좌표를 [[x, y], …] 로 만들어 넘길 뿐입니다.
//    · Hub · LAB 은 부를 때마다 전역에서 찾습니다(실린 차례에 덜 매이게).
//    · DOM · localStorage · 네트워크를 만지지 않습니다. 외부 자원 0.
// =====================================================================

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LabEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  //  0. 바깥 것 찾기 — hub.js(Hub) · lab-data.js(LAB)
  // ─────────────────────────────────────────────────────────────────
  function W() { return (typeof globalThis !== 'undefined') ? globalThis : ((typeof window !== 'undefined') ? window : null); }
  function HUB() { const w = W(); return (w && w.Hub) ? w.Hub : null; }
  function LABDB() { const w = W(); return (w && w.LAB) ? w.LAB : null; }

  //  한 칸 읽기 — 배열 행([x, s1, s2…])도 {x, s0, s1…} 꼴도 받습니다.
  //  hub.js 의 Hub.cellAt 과 같은 규칙입니다(없으면 배열만 읽는 간이판으로 물러섭니다).
  function cell(row, col){
    const h = HUB();
    if (h && typeof h.cellAt === 'function') return h.cellAt(row, col);
    if (Array.isArray(row)) return Number(row[col]);
    if (row && typeof row === 'object') return Number(col === 0 ? row.x : row['s' + (col - 1)]);
    return NaN;
  }
  //  통계는 Hub.stats 한 곳에서만 — 여기서 다시 만들지 않습니다.
  function stats(list, si){
    const h = HUB();
    if (!h || typeof h.stats !== 'function') throw new Error('LabEngine: hub.js(Hub.stats) 가 먼저 실려 있어야 합니다.');
    return h.stats(list, si);
  }

  // ─────────────────────────────────────────────────────────────────
  //  1. 축 변환
  // ─────────────────────────────────────────────────────────────────
  //  변환 한 벌 — f(값, 최솟값) 이 실제 계산, ok(값) 가 "이 점을 쓸 수 있는가"입니다.
  const LAB_TF = {
    none: { name:'그대로 두기',        lab:l => l,            unit:u => u,                  ok:v => true,   f:v => v },
    inv : { name:'1/값 으로 바꾸기',   lab:l => '1/' + l,     unit:u => u ? '1/' + u : '',  ok:v => v !== 0, f:v => 1 / v },
    sq  : { name:'제곱하기 (값²)',      lab:l => l + '²',      unit:u => u ? u + '²' : '',   ok:v => true,   f:v => v * v },
    sqrt: { name:'제곱근 (√값)',        lab:l => '√' + l,      unit:u => u ? '√' + u : '',   ok:v => v >= 0, f:v => Math.sqrt(v) },
    log : { name:'로그로 보기 (log 값)', lab:l => 'log ' + l,  unit:u => '',                 ok:v => v > 0,  f:v => Math.log(v) / Math.LN10 },
    inv2: { name:'1/값² 으로 바꾸기',   lab:l => '1/' + l + '²', unit:u => u ? '1/' + u + '²' : '', ok:v => v !== 0, f:v => 1 / (v * v) },
    sub : { name:'값 − 최솟값',         lab:l => l + ' − 최솟값', unit:u => u,               ok:v => true,   f:(v, m) => v - m, needMin:true }
  };
  const TF_ORDER = ['none','inv','sq','sqrt','log','inv2','sub'];
  //  건너뛴 점이 생기는 까닭 — 조용히 버리지 않고 화면에 그대로 알립니다.
  const TF_WHY = {
    inv :'0 인 값은 1/값 을 만들 수 없어서',
    inv2:'0 인 값은 1/값² 을 만들 수 없어서',
    log :'0 이거나 음수인 값은 로그를 만들 수 없어서',
    sqrt:'음수인 값은 제곱근을 만들 수 없어서'
  };

  // ─────────────────────────────────────────────────────────────────
  //  2. 숫자 · 단위 표기
  // ─────────────────────────────────────────────────────────────────
  const SUP = { '-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
  //  아주 작거나 큰 값도 읽히게 — 0.00012 → 1.20×10⁻⁴
  function labNum(v){
    const n = Number(v);
    if (v === null || v === undefined || !isFinite(n)) return '—';
    if (n === 0) return '0';
    const a = Math.abs(n);
    if (a < 1e-3 || a >= 1e6){
      const s = n.toExponential(2).split('e');
      const ex = String(Number(s[1])).split('').map(function(c){ return SUP[c] || c; }).join('');
      return String(Number(s[0])) + '×10' + ex;
    }
    return String(Number(n.toPrecision(4)));
  }
  function fmtR2(v){
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (Math.abs(v) >= 0.995) ? Number(v).toFixed(3) : Number(v).toFixed(2);
  }
  //  기울기의 단위 = 세로축 단위 ÷ 가로축 단위.
  //  가로축이 1/cm² 처럼 이미 뒤집힌 단위면 lx/1/cm² 가 아니라 lx·cm² 로 적어 줍니다.
  function slopeUnit(yu, xu){
    let inv = false;
    if (xu && xu.indexOf('1/') === 0){ xu = xu.slice(2); inv = true; }
    if (yu && xu) return inv ? (yu + '·' + xu) : (yu + '/' + xu);
    if (yu) return yu;
    if (xu) return inv ? xu : ('1/' + xu);
    return '';
  }

  // ─────────────────────────────────────────────────────────────────
  //  3. 열 값 읽기 · 파생열 · 변환한 점 · 최소제곱
  // ─────────────────────────────────────────────────────────────────
  //  ds(파생열 목록)를 주지 않고 부르면 쓸 목록 — 데이터 실험실(index.html)이 자기 상태(LABS.derived)를 걸어 둡니다.
  //  옛 derivedIn 의 'ds || LABS.derived' 를 그대로 살리기 위한 자리이며, 아무도 걸지 않으면 빈 목록입니다
  //  (탐구 모드 · node 시험에서는 ds 를 늘 인자로 넘기면 됩니다).
  let derivedSource = function(){ return []; };
  function setDerivedSource(fn){ derivedSource = (typeof fn === 'function') ? fn : function(){ return []; }; }

  //  ds 를 주면 그 목록에서 파생열을 찾습니다 —
  //  붙여넣기 분석 화면이 데이터 실험실의 상태를 건드리지 않고 같은 계산을 쓰기 위함입니다.
  function derivedIn(ds, k){
    const list = ds || derivedSource();
    for (let i = 0; i < list.length; i++) if (list[i].id === k) return list[i];
    return null;
  }
  //  한 줄에서 그 열의 "원래 값" 꺼내기 (파생열은 그 자리에서 계산합니다)
  function rawVal(row, k, ds){
    if (!k) return NaN;
    if (k === 'x') return cell(row, 0);
    if (k.charAt(0) === 's') return cell(row, Number(k.slice(1)) + 1);
    if (k.charAt(0) === 'd'){
      const d = derivedIn(ds, k);
      if (!d) return NaN;
      const a = rawVal(row, d.a, ds), b = rawVal(row, d.b, ds);
      if (!isFinite(a) || !isFinite(b)) return NaN;
      if (d.op === '×') return a * b;
      if (d.op === '÷') return (b === 0) ? NaN : (a / b);   // 0 으로 나누는 칸은 건너뜁니다
      if (d.op === '+') return a + b;
      return a - b;
    }
    return NaN;
  }
  function colMin(rows, k, ds){
    let m = null;
    (rows || []).forEach(function(r){
      const v = rawVal(r, k, ds);
      if (isFinite(v) && (m === null || v < m)) m = v;
    });
    return (m === null) ? 0 : m;
  }

  //  줄 목록 → 변환한 (x, y) 점들.
  //  raw     는 값이 있는 모든 줄의 변환 전 좌표,
  //  rawKept 는 "변환에 성공해 pts 에 남은 점"의 변환 전 좌표입니다 (변환 전후 R² 를 같은 점끼리 견주려고 따로 모읍니다).
  //  minX·minY 를 주면 그 값을 '최솟값 빼기' 변환에 씁니다 — 반 전체 보기에서 모둠마다 다른 값을 빼지 않도록 하기 위함입니다.
  function labPoints(rows, xk, xt, yk, yt, minX, minY, ds){
    const tx = LAB_TF[xt] || LAB_TF.none, ty = LAB_TF[yt] || LAB_TF.none;
    const mx = tx.needMin ? ((minX === undefined || minX === null || !isFinite(minX)) ? colMin(rows, xk, ds) : minX) : 0;
    const my = ty.needMin ? ((minY === undefined || minY === null || !isFinite(minY)) ? colMin(rows, yk, ds) : minY) : 0;
    const out = { pts: [], raw: [], rawKept: [], skipped: 0, missing: 0, minX: mx, minY: my };
    (rows || []).forEach(function(r){
      const a = rawVal(r, xk, ds), b = rawVal(r, yk, ds);
      if (!isFinite(a) || !isFinite(b)){ out.missing++; return; }   // 빈 칸 — 원래 없는 값입니다
      out.raw.push({ x:a, y:b });
      if (!tx.ok(a) || !ty.ok(b)){ out.skipped++; return; }
      const X = tx.f(a, mx), Y = ty.f(b, my);
      if (!isFinite(X) || !isFinite(Y)){ out.skipped++; return; }
      out.pts.push({ x:X, y:Y });
      out.rawKept.push({ x:a, y:b });                               // 같은 점 집합으로 전후를 견줍니다
    });
    return out;
  }

  //  ★ 최소제곱은 여기 한 곳에서만 — 변환한 좌표를 Hub.stats 가 읽는 표 모양으로 넘깁니다.
  function labFit(pts){
    const list = (pts || []).map(function(p){ return [p.x, p.y]; });
    const st = stats(list, 0);
    st.ok = (st.n >= 2 && st.slope !== null && isFinite(st.slope));
    return st;
  }

  // ─────────────────────────────────────────────────────────────────
  //  4. 붙여넣기 분석 — 레시피(exp.analysis) 실행
  //     무엇을 볼지는 lab-data.js 의 exp.analysis(goal · steps · verdict) 가 정합니다.
  // ─────────────────────────────────────────────────────────────────
  const AN_OPS = { '*':'×', '/':'÷', '+':'+', '-':'−', '×':'×', '÷':'÷', '−':'−' };

  function anColName(sp, ds, k){
    if (k === 'x') return (sp.x && sp.x.label) || '가로축';
    if (String(k).charAt(0) === 's'){
      const i = Number(String(k).slice(1)), s = (sp.series || [])[i];
      return s ? (s.label || ('계열 ' + (i + 1))) : String(k);
    }
    const d = derivedIn(ds, k);
    return d ? d.name : String(k);
  }
  function anColUnit(sp, ds, k){
    if (k === 'x') return (sp.x && sp.x.unit) || '';
    if (String(k).charAt(0) === 's'){
      const s = (sp.series || [])[Number(String(k).slice(1))];
      return s ? (s.unit || '') : '';
    }
    const d = derivedIn(ds, k);
    return d ? (d.unit || '') : '';
  }
  //  통계는 Hub.stats 한 곳에서 — 한 열을 [[x, 값], …] 로 만들어 그대로 넘깁니다.
  function anStat(rows, k, ds){
    const list = [];
    (rows || []).forEach(function(r){
      const v = rawVal(r, k, ds);
      if (!isFinite(v)) return;
      const x = rawVal(r, 'x', ds);
      list.push([isFinite(x) ? x : list.length, v]);
    });
    const st = stats(list, 0);
    st.range = (st.max === null || st.min === null) ? null : (st.max - st.min);
    return st;
  }
  //  {mean} {r2} {r2Min} {slope} {intercept} {range} {delta} {n} 를 실제 값으로 채웁니다.
  //   · range 는 max−min 이라 늘 0 이상입니다(방향이 없습니다).
  //   · delta 는 last−first 라 부호가 살아 있습니다(오름/내림을 가릴 때 이 값을 쓰세요).
  //   · r2Min 은 그 실험에서 나온 모든 fit 의 R² 가운데 가장 작은 값입니다.
  function anFill(text, v){
    return String(text == null ? '' : text).replace(/\{(mean|r2Min|r2|slope|intercept|range|delta|n)\}/g, function(m, k){
      const x = v ? v[k] : null;
      if (x === null || x === undefined || !isFinite(x)) return '—';
      if (k === 'n') return String(x);
      if (k === 'r2' || k === 'r2Min') return fmtR2(x);
      return labNum(x);
    });
  }
  //  verdict 의 when 은 'always' 아니면 '이름 비교식 숫자' 한 줄뿐입니다.
  function anVerdict(list, v){
    const arr = list || [];
    for (let i = 0; i < arr.length; i++){
      const w = String(arr[i].when || '').trim();
      if (w === 'always') return arr[i];
      const m = /^(r2Min|r2|slope|intercept|mean|range|delta|n)\s*(>=|<=|==|!=|>|<)\s*(-?[0-9.]+)$/.exec(w);
      if (!m) continue;
      const a = v[m[1]], b = Number(m[3]), op = m[2];
      if (a === null || a === undefined || !isFinite(a)) continue;
      const hit = (op === '>=') ? (a >= b) : (op === '<=') ? (a <= b) :
                  (op === '>')  ? (a >  b) : (op === '<')  ? (a <  b) :
                  (op === '==') ? (a === b) : (a !== b);
      if (hit) return arr[i];
    }
    return arr.length ? arr[arr.length - 1] : null;
  }

  //  레시피를 차례로 실행합니다. 값만 만들고, 그리는 일은 index.html 의 anBlockHTML 이 합니다.
  function runAnalysis(exp, rows){
    const sp = (exp && exp.dataSpec) || { x:{}, series:[] };
    const L  = LABDB();
    const A  = (L && L.analysisOf) ? L.analysisOf(exp) : (exp && exp.analysis);
    const ds = [];
    const out = { goal:(A && A.goal) || '', blocks:[], ds:ds, sp:sp,
                  vals:{ mean:null, r2:null, r2Min:null, slope:null, intercept:null,
                         range:null, delta:null, n:null },
                  mainFit:null, verdict:null };
    ((A && A.steps) || []).forEach(function(st){
      if (!st || !st.kind) return;

      if (st.kind === 'derive'){
        const d = { id:'d' + ds.length, name: st.name || ('만든 열 ' + (ds.length + 1)),
                    unit: st.unit || '', a: st.a, b: st.b, op: AN_OPS[st.op] || '×' };
        ds.push(d);
        const s = anStat(rows, d.id, ds);
        out.blocks.push({ kind:'derive', d:d, st:s,
                          formula: anColName(sp, ds, d.a) + ' ' + d.op + ' ' + anColName(sp, ds, d.b) });
        return;
      }

      if (st.kind === 'stat'){
        const s = anStat(rows, st.of, ds);
        out.vals.mean = s.mean; out.vals.range = s.range; out.vals.n = s.n;
        out.vals.delta = s.delta;                //  last−first (부호가 살아 있는 변화량)
        const v = { mean:s.mean, range:s.range, n:s.n, delta:s.delta,
                    r2:out.vals.r2, r2Min:out.vals.r2Min,
                    slope:out.vals.slope, intercept:out.vals.intercept };
        out.blocks.push({ kind:'stat', st:s, want:(st.want || ['mean','min','max','n']),
                          name:anColName(sp, ds, st.of), unit:anColUnit(sp, ds, st.of),
                          say:anFill(st.say, v) });
        return;
      }

      if (st.kind === 'fit'){
        const xt = st.xt || 'none', yt = st.yt || 'none';
        const P  = labPoints(rows, st.x, xt, st.y, yt, undefined, undefined, ds);
        const f  = labFit(P.pts);
        const tf = (xt !== 'none' || yt !== 'none');
        const P0 = tf ? labPoints(rows, st.x, 'none', st.y, 'none', undefined, undefined, ds) : null;
        out.vals.r2 = f.ok ? f.r2 : null;
        out.vals.slope = f.ok ? f.slope : null;
        out.vals.intercept = f.ok ? f.intercept : null;
        //  r2 · slope 는 '마지막 fit' 값만 남습니다. 계열이 여럿인 실험의 판정에는
        //  지금까지 나온 fit 들의 가장 낮은 R²(r2Min)를 쓰세요.
        if (f.ok && isFinite(f.r2)) out.vals.r2Min = (out.vals.r2Min === null) ? f.r2 : Math.min(out.vals.r2Min, f.r2);
        out.vals.delta = anStat(rows, st.y, ds).delta;   //  세로축 열의 last−first (부호 있음)
        const v = { mean:out.vals.mean, range:out.vals.range, n:f.n, delta:out.vals.delta,
                    r2:out.vals.r2, r2Min:out.vals.r2Min,
                    slope:out.vals.slope, intercept:out.vals.intercept };
        const b = { kind:'fit', x:st.x, y:st.y, xt:xt, yt:yt, P:P, P0:P0, fit:f,
                    fit0: P0 ? labFit(P0.pts) : null,
                    xName:anColName(sp, ds, st.x), xUnit:anColUnit(sp, ds, st.x),
                    yName:anColName(sp, ds, st.y), yUnit:anColUnit(sp, ds, st.y),
                    say:anFill(st.say, v) };
        out.blocks.push(b);
        out.mainFit = b;                       // 마지막 회귀를 반 전체 보기의 기준 축으로 씁니다
        return;
      }

      if (st.kind === 'compare'){
        const of = (st.of || []).slice(), by = st.by || 'mean';
        if (by === 'rank' || of.length < 2){
          const k = of[0];
          const list = [];
          (rows || []).forEach(function(r, i){
            const val = rawVal(r, k, ds);
            if (!isFinite(val)) return;
            const raw = (r && r[0] !== null && r[0] !== undefined) ? String(r[0]).trim() : '';
            list.push({ label: raw || ('줄 ' + (i + 1)), v: val });
          });
          list.sort(function(a, b){ return b.v - a.v; });
          out.blocks.push({ kind:'rank', list:list, name:anColName(sp, ds, k), unit:anColUnit(sp, ds, k),
                            xName:anColName(sp, ds, 'x'), say:anFill(st.say, out.vals) });
          return;
        }
        const items = of.map(function(k){
          let val = null;
          if (by === 'slope'){
            const f = labFit(labPoints(rows, 'x', 'none', k, 'none', undefined, undefined, ds).pts);
            val = f.ok ? f.slope : null;
          } else {
            const s = anStat(rows, k, ds);
            val = (by === 'range') ? s.range : s[by];
          }
          return { key:k, name:anColName(sp, ds, k), unit:anColUnit(sp, ds, k), v:val };
        });
        out.blocks.push({ kind:'compare', by:by, items:items, say:anFill(st.say, out.vals) });
        return;
      }
    });
    out.verdict = anVerdict((A && A.verdict) || [], out.vals);
    return out;
  }

  //  축 이름표 — 변환 이름(1/값 · √값 …)과 단위를 붙여 줍니다.
  function anAxText(name, unit, tf){
    const t = LAB_TF[tf] || LAB_TF.none;
    const u = t.unit(unit);
    return t.lab(name) + (u ? ' (' + u + ')' : '');
  }

  return {
    cell: cell,
    LAB_TF: LAB_TF, TF_ORDER: TF_ORDER, TF_WHY: TF_WHY,
    labNum: labNum, fmtR2: fmtR2, slopeUnit: slopeUnit,
    setDerivedSource: setDerivedSource, derivedIn: derivedIn,
    rawVal: rawVal, colMin: colMin, labPoints: labPoints, labFit: labFit,
    AN_OPS: AN_OPS,
    anColName: anColName, anColUnit: anColUnit, anStat: anStat,
    anFill: anFill, anVerdict: anVerdict, runAnalysis: runAnalysis, anAxText: anAxText
  };
});
