// =====================================================================
//  sensorkit.js — MBL 수업허브 "센서 연결 엔진"  (전역 window.SensorKit)
//
//  ▣ 무엇인가
//    학생이 센서 화면을 보며 값을 표에 옮겨 적던 일을 없앱니다.
//    보드를 케이블(웹 시리얼)이나 블루투스(웹 블루투스)로 브라우저에 직접 붙여
//    들어오는 값을 그대로 실험 표에 넣습니다. 그러면 그래프·데이터실험실·
//    보고서·대시보드가 저절로 따라옵니다.
//
//  ▣ 쓰는 법
//    <script src="hub.js"></script>
//    <script src="sensorkit.js"></script>          ← 외부 자원을 부르지 않으므로 <head> 도 괜찮습니다.
//
//    SensorKit.support()                 → {serial, ble, why, serialWhy, bleWhy, secure}
//    SensorKit.parseLine(line, state)    → {kind:'schema'|'data'|'skip', ...}   ※ 순수 함수
//    SensorKit.newState(opt)             → parseLine 에 넘길 상태 그릇
//    SensorKit.connect(kind, opt)        → 'serial' | 'ble' | 'mock' 연결 객체
//    SensorKit.mount(el, opt)            → 수집 UI (opt.onRow(values, meta) 로 한 줄씩 올려 줍니다)
//
//  ▣ 설계 원칙
//    · 순수한 곳(parseLine · 센서표 · 모의값 만들기)과 DOM 을 만지는 곳(mount)을 나눕니다.
//      그래서 parseLine 은 브라우저 없이 node 로 검증됩니다.
//    · 유선(웹 시리얼)은 표준 API 만 씁니다. 의존성 0.
//    · 무선(웹 블루투스)만 이지메이커 SDK 가 필요하고, 학생이 무선을 고른 그 순간에만
//      동적으로 불러옵니다. 못 불러와도 유선·직접입력·CSV 는 그대로 됩니다.
//    · 숫자 읽기는 index.html 의 parseTable · hub.js 의 Hub.num 과 같은 규칙을 씁니다
//      ('20.1 ℃' → 20.1, '1.250,5' → 1250.5). Hub 가 실려 있으면 Hub.num 을 그대로 씁니다.
//    · 모의 장치 값에는 반드시 표시가 남습니다(meta.mock). 진짜 자료와 섞이면 안 됩니다.
//    · 실시간 구독 0 · Supabase 접촉 0 · schema.sql 변경 0.
// =====================================================================

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SensorKit = api;
})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var W = (typeof window !== 'undefined') ? window : null;

  // ─────────────────────────────────────────────────────────────────
  //  0. 아주 작은 도구들
  // ─────────────────────────────────────────────────────────────────
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; });
  }
  function isFn(f) { return typeof f === 'function'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  //  숫자 읽기 — hub.js 의 Hub.num 과 같은 규칙입니다.
  //  '20.1 ℃' → 20.1 · '1,250' → 1250 · '1,25' → 1.25 · '1.250,5' → 1250.5 · '' → NaN
  function numFallback(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).replace(/\s+/g, '').replace(/[^0-9,.eE+\-]/g, '');
    if (!s) return NaN;
    var dot = s.lastIndexOf('.'), com = s.lastIndexOf(',');
    if (dot >= 0 && com >= 0) {
      if (com > dot) s = s.replace(/\./g, '').replace(',', '.');
      else           s = s.replace(/,/g, '');
    } else if (com >= 0) {
      if (/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
      else if (/^[+-]?\d+,\d+$/.test(s))     s = s.replace(',', '.');
      else                                   s = s.replace(/,/g, '');
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function num(v) {
    var H = W && W.Hub;
    if (H && isFn(H.num)) { var n = H.num(v); return (typeof n === 'number') ? n : NaN; }
    return numFallback(v);
  }

  //  index.html 의 isNumCell 과 같은 잣대 — "숫자로 읽을 수 있는 칸인가"
  function isNumCell(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return false;
    var core = s.replace(/[^0-9+\-.,eE]+/g, '');
    if (!/^[+-]?[0-9]+(?:[.,][0-9]+)*(?:[eE][+-]?[0-9]+)?$/.test(core)) return false;
    return isFinite(num(s));
  }

  function fmtNum(v) {
    if (!isFinite(v)) return '';
    var a = Math.abs(v);
    if (a >= 1000) return String(Math.round(v * 10) / 10);
    if (a >= 10)   return String(Math.round(v * 100) / 100);
    if (a >= 1)    return String(Math.round(v * 1000) / 1000);
    if (a === 0)   return '0';
    return String(Math.round(v * 10000) / 10000);
  }

  // ─────────────────────────────────────────────────────────────────
  //  1. 센서 번호표 (이지메이커 블록코딩 기준)
  // ─────────────────────────────────────────────────────────────────
  var SENSORS = {
    12: { name: '공기압센서',            unit: 'hPa',   units: ['hPa'] },
    20: { name: '밝기센서',              unit: 'lx',    units: ['lx'] },
    21: { name: '소리센서',              unit: '',      units: [''] },
    23: { name: '온습도센서',            unit: '℃',    units: ['℃', '%'] },
    24: { name: '이산화탄소센서',        unit: 'ppm',   units: ['ppm'] },
    26: { name: '자이로-가속도(3축)',    unit: 'm/s²',  units: ['m/s²', 'm/s²', 'm/s²'] },
    27: { name: '자이로-각속도(3축)',    unit: '°/s',   units: ['°/s', '°/s', '°/s'] },
    28: { name: '자이로-지자기(3축)',    unit: 'µT',    units: ['µT', 'µT', 'µT'] },
    29: { name: '자이로-자세(기울기)',   unit: '°',     units: ['°', '°', '°'] },
    30: { name: '자이로-전체 가속도',    unit: 'm/s²',  units: ['m/s²'] },
    31: { name: '자이로-방위각',         unit: '°',     units: ['°'] },
    32: { name: '전류센서(전류)',        unit: 'mAh',   units: ['mAh'] },
    33: { name: '전류센서(전력)',        unit: 'mW',    units: ['mW'] },
    34: { name: '전류센서(버스전압)',    unit: 'V',     units: ['V'] },
    35: { name: '전압센서',              unit: 'V',     units: ['V'] },
    36: { name: '초음파거리센서',        unit: 'cm',    units: ['cm'] }
  };
  //  화면의 "센서 종류 고르기" 에 뿌릴 차례 (템플릿과 같은 차례)
  var SENSOR_ORDER = [20, 21, 36, 12, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];

  function sensorName(id) {
    var s = SENSORS[String(Number(id))];
    return s ? s.name : ('S' + id);
  }
  function sensorUnit(id, ch) {
    var s = SENSORS[String(Number(id))];
    if (!s) return '';
    var i = Math.max(1, Number(ch) || 1) - 1;
    return (s.units && s.units[i]) || s.unit || '';
  }

  //  괄호에서 단위 뽑기 — '온도(℃)' → {label:'온도', unit:'℃'}
  function splitUnit(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    var m = s.match(/^(.*?)[\s]*[\(\[]([^\)\]]{1,8})[\)\]]\s*$/);
    if (m && m[1].trim()) return { label: m[1].trim(), unit: m[2].trim() };
    return { label: s, unit: '' };
  }

  //  열 이름 한 개를 사람이 읽는 말로 — 'A:S20:CH1' → 'A · 밝기센서 · CH1'
  function parseCol(raw, i) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    var m = s.match(/^(.*):S(\d+):CH(\d+)$/);
    if (m) {
      var dev = (m[1] || '').trim() || ('장치' + (i + 1));
      var sid = Number(m[2]), ch = Number(m[3]);
      return {
        raw: s, device: dev, sensorId: sid, ch: ch,
        label: dev + ' · ' + sensorName(sid) + ' · CH' + ch,
        unit: sensorUnit(sid, ch)
      };
    }
    var u = splitUnit(s);
    //  'A:온도' 처럼 장치이름:항목 꼴이면 가운뎃점으로 이어 읽기 좋게 만듭니다.
    var dev2 = '', lab2 = u.label;
    var k = lab2.indexOf(':');
    if (k > 0 && k < lab2.length - 1 && lab2.indexOf(':', k + 1) < 0) {
      dev2 = lab2.slice(0, k).trim();
      lab2 = dev2 + ' · ' + lab2.slice(k + 1).trim();
    }
    return {
      raw: s, device: dev2, sensorId: 0, ch: 0,
      label: lab2 || ('열 ' + (i + 1)),
      unit: u.unit
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  2. parseLine — 이 파일의 핵심. 순수 함수입니다.
  //     state 를 읽기만 하고 고치지 않습니다(부르는 쪽이 state.cols 를 갈아 끼웁니다).
  // ─────────────────────────────────────────────────────────────────
  function newState(opt) {
    opt = opt || {};
    return {
      cols: null,                                     // [{raw, label, unit, sensorId, ch, device}]
      version: 0,
      //  '1,25' 를 소수점 쉼표로 읽을지 — 기본은 아닙니다.
      //  index.html 의 parseTable 도 줄을 먼저 쉼표로 가른 뒤 칸마다 숫자를 읽으므로
      //  기본은 [1, 25] 두 값입니다. 유럽식 내보내기를 쓰는 보드면 true 로 두세요.
      //  mount 화면에서는 애매한 줄이 처음 들어올 때 학생에게 물어보고 이 값을 켭니다.
      decimalComma: !!opt.decimalComma
    };
  }

  //  구분자 고르기 — 탭 > 세미콜론 > 쉼표 > 공백
  function sniff(line) {
    if (line.indexOf('\t') >= 0) return '\t';
    if (line.indexOf(';')  >= 0) return ';';
    if (line.indexOf(',')  >= 0) return ',';
    if (/\s/.test(line.trim())) return ' ';
    return '';
  }
  function splitBy(line, d) {
    if (!d) return [line];
    if (d === ' ') return line.trim().split(/\s+/);
    return line.split(d);
  }

  //  '온도:23.5' 꼴인가 — 이름은 숫자만이면 안 되고, 값은 숫자로 읽혀야 합니다.
  function asNamed(field) {
    var s = String(field).trim();
    var k = s.indexOf(':');
    if (k <= 0 || k === s.length - 1) return null;
    var name = s.slice(0, k).trim();
    var val  = s.slice(k + 1).trim();
    if (!name || /^[+-]?[\d.,]+$/.test(name)) return null;   // '12:34:56' 같은 시각은 걸러냅니다
    if (val.indexOf(':') >= 0) return null;
    if (!isNumCell(val)) return null;
    return { name: name, value: num(val) };
  }

  var TS_RE = /^\d{12,16}$/;                                  // 13자리 안팎의 정수 = timestamp
  var CLOCK_RE = /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/;             // '12:34:56' 은 값이 아니라 시각입니다
  //  '00:01:30' → 90 초. index.html 의 toNum · isNumCell 과 똑같은 규칙입니다.
  var CLOCK_SEC_RE = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d(?:[.,]\d+)?))?$/;
  function clockSec(v) {
    var m = CLOCK_SEC_RE.exec(String(v === null || v === undefined ? '' : v).trim());
    if (!m) return null;
    var a = Number(m[1]), b = Number(m[2]);
    if (m[3] === undefined) return a * 60 + b;                    // 분:초
    return a * 3600 + b * 60 + Number(String(m[3]).replace(',', '.'));
  }
  //  '1.250,5' 처럼 자릿점(.)+소수점(,) 인 한 덩이 숫자 — Hub.num 과 같이 1250.5 로 읽습니다.
  var EU_RE = /^[+-]?\d{1,3}(\.\d{3})+$/;

  function parseLine(line, state) {
    state = state || newState();
    var raw = String(line === null || line === undefined ? '' : line);
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);      // BOM
    var s = raw.replace(/[\u0000\u200B-\u200D\uFEFF]/g, '').replace(/[\r\n]+$/, '').trim();

    if (!s) return { kind: 'skip', why: 'blank', raw: raw };
    if (s.charAt(0) === '#' || s.slice(0, 2) === '//') return { kind: 'skip', why: 'comment', raw: raw };

    // ── @schema — 열 구성 ────────────────────────────────────────
    if (/^@schema\b/i.test(s)) {
      var p = s.split(',').map(function (x) { return x.trim(); });
      var ver = 0, rest;
      if (p.length >= 2 && /^\d+$/.test(p[1])) { ver = Number(p[1]); rest = p.slice(2); }
      else                                     { rest = p.slice(1); }
      rest = rest.filter(function (x) { return x !== ''; });
      if (!rest.length) return { kind: 'skip', why: 'empty-schema', raw: raw };
      var cols = rest.map(parseCol);
      return {
        kind: 'schema',
        version: ver,
        cols: cols,
        labels: cols.map(function (c) { return c.label; }),
        units:  cols.map(function (c) { return c.unit; }),
        raw: raw
      };
    }

    // ── 값 줄 ────────────────────────────────────────────────────
    var d = sniff(s);
    var fields = splitBy(s, d).map(function (x) { return String(x).trim(); });

    //  공백은 어설픈 구분자입니다 — '20.1 ℃' 는 값 하나이지 두 칸이 아닙니다.
    //  그래서 공백으로 가른 칸이 죄다 숫자일 때만 구분자로 인정합니다.
    if (d === ' ' && !fields.every(isNumCell)) { d = ''; fields = [s]; }

    //  ① '이름:값' 꼴 — 하나라도 그 꼴이면 이름 붙은 줄로 봅니다.
    var named = fields.map(asNamed);
    var namedN = named.filter(Boolean).length;
    if (namedN && namedN === fields.filter(function (f) { return f !== ''; }).length) {
      var nm = [], nv = [];
      named.forEach(function (o) { if (o) { nm.push(o.name); nv.push(o.value); } });
      return { kind: 'data', ts: null, values: nv, names: nm, label: null, raw: raw, ambiguous: false };
    }

    //  ② 소수점 쉼표 한 값 — '1,25'. 애매한 자리라 표시를 남깁니다.
    var ambiguous = false;
    //  '1.250,5' — 자릿점이 이미 찍혀 있으면 뒤의 쉼표는 틀림없이 소수점입니다. 애매하지 않습니다.
    if (d === ',' && fields.length === 2 && EU_RE.test(fields[0]) && /^\d+$/.test(fields[1])) {
      return { kind: 'data', ts: null, values: [numFallback(s)], names: null, label: null, raw: raw, ambiguous: false };
    }
    //  '1,25' — 둘 다 맨 정수라 값 둘인지 소수 하나인지 알 길이 없습니다. 표시를 남깁니다.
    if (d === ',' && fields.length === 2 &&
        /^[+-]?\d+$/.test(fields[0]) && /^\d+$/.test(fields[1]) &&
        !(state.cols && state.cols.length >= 2)) {
      ambiguous = true;
      if (state.decimalComma) {
        return { kind: 'data', ts: null, values: [numFallback(s)], names: null, label: null, raw: raw, ambiguous: true };
      }
    }

    //  ③ 첫 칸이 timestamp 인가
    var ts = null;
    if (fields.length >= 2 && TS_RE.test(fields[0])) { ts = Number(fields[0]); fields = fields.slice(1); }

    //  ③-2 첫 칸이 '00:01:30' 꼴 경과시간인가 — 버리지 않고 초로 읽어 x(시각)로 씁니다.
    //      CSV 로 같은 줄을 넣을 때(index.html 의 toNum)와 같은 값이 나옵니다.
    if (ts === null && fields.length >= 2 && CLOCK_RE.test(fields[0])) {
      var csec = clockSec(fields[0]);
      if (csec !== null) { ts = csec * 1000; fields = fields.slice(1); }
    }

    //  ④ 첫 칸이 글자 딱지인가 — '물,23.5,41.2'
    var label = null;
    if (ts === null && fields.length >= 2 && fields[0] !== '' && !isNumCell(fields[0]) && !/^@/.test(fields[0])) {
      var restNum = fields.slice(1).filter(function (f) { return f !== '' && !CLOCK_RE.test(f); });
      if (restNum.length && restNum.every(isNumCell)) { label = fields[0]; fields = fields.slice(1); }
    }

    //  ⑤ 숫자로 바꾸기 — 못 읽는 칸은 null 로 두되, 하나도 못 읽으면 skip
    var vals = fields.map(function (f) {
      if (f === '' || CLOCK_RE.test(f)) return null;
      var n = num(f);
      return isFinite(n) ? n : null;
    });
    var good = vals.filter(function (v) { return v !== null; }).length;
    if (!good) return { kind: 'skip', why: 'nonnumeric', raw: raw };

    //  숫자가 너무 적은 줄은 자료가 아니라 안내문일 때가 많습니다(parseTable 의 6할 잣대).
    //  ★ 시각 칸('12:34:56')은 값이 아니므로 분모에서 뺍니다 — 빼지 않으면 '시각,값' 줄이 통째로 버려집니다.
    var filled = fields.filter(function (f) { return f !== '' && !CLOCK_RE.test(f); }).length;
    if (filled > 1 && good < Math.max(1, Math.ceil(filled * 0.6))) {
      return { kind: 'skip', why: 'mostly-text', raw: raw };
    }

    //  꼬리의 빈 칸은 버립니다.
    while (vals.length > 1 && vals[vals.length - 1] === null) vals.pop();

    return { kind: 'data', ts: ts, values: vals, names: null, label: label, raw: raw, ambiguous: ambiguous };
  }

  //  들어온 결과로 state 를 갱신하는 도우미 — parseLine 을 순수하게 두기 위해 따로 뺐습니다.
  function applyResult(state, res) {
    if (!state || !res) return state;
    if (res.kind === 'schema') { state.cols = res.cols; state.version = res.version; }
    return state;
  }

  //  계열 이름 정하기 — @schema · '이름:값' · 실험의 dataSpec 순으로 봅니다.
  function seriesLabels(state, res, spec) {
    var n = (res && res.values) ? res.values.length : 0;
    var out = [], i;
    if (res && res.names && res.names.length === n) {
      for (i = 0; i < n; i++) { var u = splitUnit(res.names[i]); out.push({ label: u.label, unit: u.unit }); }
      return out;
    }
    if (state && state.cols && state.cols.length) {
      for (i = 0; i < n; i++) {
        var c = state.cols[i];
        out.push(c ? { label: c.label, unit: c.unit } : { label: '값 ' + (i + 1), unit: '' });
      }
      return out;
    }
    var ser = (spec && spec.series) || [];
    for (i = 0; i < n; i++) {
      out.push(ser[i] ? { label: ser[i].label || ('값 ' + (i + 1)), unit: ser[i].unit || '' }
                      : { label: '값 ' + (i + 1), unit: '' });
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  3. support() — 지금 브라우저가 무엇을 할 수 있나
  // ─────────────────────────────────────────────────────────────────
  function support() {
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    var ua = (nav && nav.userAgent) || '';
    var secure = (typeof isSecureContext !== 'undefined') ? !!isSecureContext
               : !!(W && W.location && (W.location.protocol === 'https:' || W.location.hostname === 'localhost'));
    var hasSerial = !!(nav && nav.serial);
    var hasBle    = !!(nav && nav.bluetooth);

    var isIOS  = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav && nav.maxTouchPoints > 1);
    var isSafari  = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Whale/.test(ua);
    var isFirefox = /Firefox/.test(ua);
    var isAndroid = /Android/.test(ua);

    var sw = '', bw = '';
    if (!secure)          { sw = bw = '주소가 https 가 아니어서 브라우저가 막습니다.'; }
    else if (hasSerial)   { sw = ''; }
    else if (isIOS)       { sw = '아이폰·아이패드는 케이블 연결을 지원하지 않습니다.'; }
    else if (isSafari)    { sw = '사파리는 케이블 연결을 지원하지 않습니다. 크롬·엣지를 써 주세요.'; }
    else if (isFirefox)   { sw = '파이어폭스는 케이블 연결을 지원하지 않습니다. 크롬·엣지를 써 주세요.'; }
    else if (isAndroid)   { sw = '안드로이드는 케이블 연결을 지원하지 않습니다. 무선(블루투스)을 써 주세요.'; }
    else                  { sw = '이 브라우저는 웹 시리얼을 지원하지 않습니다. 크롬·엣지·크롬북을 써 주세요.'; }

    if (!secure)          { /* 위에서 채웠습니다 */ }
    else if (hasBle)      { bw = ''; }
    else if (isIOS)       { bw = '아이폰·아이패드는 웹 블루투스를 지원하지 않습니다.'; }
    else if (isSafari)    { bw = '사파리는 웹 블루투스를 지원하지 않습니다. 크롬·엣지를 써 주세요.'; }
    else if (isFirefox)   { bw = '파이어폭스는 웹 블루투스를 지원하지 않습니다. 크롬·엣지를 써 주세요.'; }
    else                  { bw = '이 브라우저는 웹 블루투스를 지원하지 않습니다. 크롬·엣지·크롬북·안드로이드를 써 주세요.'; }

    var serial = !!(hasSerial && secure);
    var ble    = !!(hasBle && secure);
    var why = serial && ble ? '케이블·블루투스 둘 다 됩니다.'
            : serial ? ('케이블은 됩니다. 블루투스는 안 됩니다 — ' + bw)
            : ble    ? ('블루투스는 됩니다. 케이블은 안 됩니다 — ' + sw)
            : (sw || bw);

    return {
      serial: serial, ble: ble, secure: secure, why: why,
      serialWhy: sw, bleWhy: bw,
      ua: ua
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  4. 사람이 읽는 오류 말
  // ─────────────────────────────────────────────────────────────────
  function humanError(e, where) {
    var name = (e && e.name) || '';
    var msg  = (e && e.message) || String(e || '');
    if (name === 'NotFoundError')   return '장치를 고르지 않았습니다. 창이 뜨면 목록에서 보드를 고르고 [연결]을 눌러 주세요.';
    if (name === 'AbortError')      return '연결이 도중에 멈췄습니다. 다시 눌러 주세요.';
    if (name === 'NotAllowedError') return '브라우저가 권한을 막았습니다. 주소창 옆 자물쇠에서 권한을 허용해 주세요.';
    if (name === 'SecurityError')   return '보안 때문에 막혔습니다. https 주소인지, 버튼을 눌러서 시작했는지 확인해 주세요.';
    if (name === 'InvalidStateError') return '이미 열려 있는 포트입니다. 다른 탭이나 프로그램(아두이노 IDE 등)이 잡고 있지 않은지 확인해 주세요.';
    if (name === 'NetworkError')    return '연결이 끊겼습니다. 케이블·전원을 확인하고 다시 연결해 주세요.';
    if (/locked|already open/i.test(msg)) return '다른 프로그램이 이 포트를 쓰고 있습니다. 그 프로그램을 닫고 다시 해 주세요.';
    return (where ? (where + ' — ') : '') + (msg || '알 수 없는 문제가 생겼습니다.');
  }

  // ─────────────────────────────────────────────────────────────────
  //  5. 줄 모으개 — 조각난 문자열을 줄 단위로 잘라 줍니다(순수).
  // ─────────────────────────────────────────────────────────────────
  function LineBuf() {
    this.buf = '';
  }
  LineBuf.prototype.push = function (chunk) {
    this.buf += String(chunk === null || chunk === undefined ? '' : chunk);
    if (this.buf.length > 65536) this.buf = this.buf.slice(-8192);   // 줄바꿈이 안 오는 보드 방어
    var lines = this.buf.split(/\r\n|\n|\r/);
    this.buf = lines.pop();
    return lines;
  };
  LineBuf.prototype.flush = function () {
    var last = this.buf; this.buf = '';
    return last ? [last] : [];
  };

  // ─────────────────────────────────────────────────────────────────
  //  6. 모의 장치 — 하드웨어 없이 흐름을 익힐 때 (순수한 값 만들기 + 흘려보내기)
  // ─────────────────────────────────────────────────────────────────
  function has(s, words) {
    var t = String(s || '').toLowerCase();
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) >= 0) return true;
    return false;
  }

  //  dataSpec 을 보고 "그럴듯한 값" 만드는 규칙을 고릅니다.
  //  돌려주는 것: { cols:[{label,unit}], xLabel, xUnit, at(i) → [x, v1, v2…] }
  function mockPlan(spec, seedHint) {
    spec = spec || {};
    var xs  = spec.x || {};
    var ser = (spec.series && spec.series.length) ? spec.series : [{ label: '측정값', unit: '' }];
    var xLab = xs.label || '회차', xUnit = xs.unit || '';
    var rows = Math.max(3, Math.min(60, Number(spec.rows) || 8));

    var seed = 0, hs = String(seedHint || '') + '|' + xLab + '|' + ser.map(function (s) { return s.label; }).join('|');
    for (var i = 0; i < hs.length; i++) seed = ((seed * 33) ^ hs.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function jit(a) { return (rnd() - 0.5) * 2 * a; }

    var allLab = ser.map(function (s) { return s.label || ''; }).join(' ') + ' ' + xLab;
    var allUnit = ser.map(function (s) { return s.unit || ''; }).join(' ');

    var kind = 'trend';
    if (has(allLab, ['냉각', '식히', '식는', '식어', '차가', '얼음']))       kind = 'cool';
    else if (has(allLab + allUnit, ['온도', '℃', '가열', '비열', '수온'])) kind = 'heat';
    else if (has(allLab, ['거리', '조도', '밝기', '조명', 'lx', '소리']))   kind = 'decay';
    else if (has(allLab, ['압력', '부피', '기압', 'hpa', 'kpa']))          kind = 'boyle';
    else if (has(allLab, ['이산화탄소', 'co2', 'ppm']))                    kind = 'rise';
    else if (has(allLab, ['전압', '전류', 'v', 'a', '저항']))              kind = 'linear';

    var base = ser.map(function (s, k) {
      var u = (s.unit || '').toLowerCase(), L = (s.label || '');
      if (has(L + u, ['℃', '온도'])) return 20 + k * 1.5;
      if (has(L + u, ['%', '습도']))  return 45 + k * 4;
      if (has(L + u, ['ppm']))        return 420 + k * 30;
      if (has(L + u, ['hpa']))        return 1013 - k * 2;
      if (has(L + u, ['lx', '조도', '밝기'])) return 800 - k * 120;
      if (has(L + u, ['cm', '거리']))  return 10 + k * 5;
      if (has(L + u, ['v']))           return 3 + k * 0.5;
      return 10 + k * 5;
    });

    //  i 는 얼마든지 커질 수 있습니다. 되감으면 표에 톱니가 생기므로
    //  진행도 t 만 1 에서 멈추게 하고(가열 곡선이 자연스레 평평해집니다) 가로축은 계속 늘립니다.
    function at(i) {
      var t = rows > 1 ? Math.min(1, Math.max(0, i / (rows - 1))) : 0;   // 0 → 1 에서 멈춤
      var x;
      if (has(xLab + xUnit, ['시간', '초', '분', 'sec', 'min', 's'])) x = Math.round(i * (60 / Math.max(1, rows - 1)) * 10) / 10;
      else if (has(xLab, ['거리', 'cm', 'm']))                        x = Math.round((5 + i * 5) * 10) / 10;
      else if (has(xLab, ['부피', 'ml', 'cc']))                        x = 50 - i * 3;
      else                                                            x = i + 1;

      var out = [x];
      base.forEach(function (b, k) {
        var v;
        if (kind === 'heat')       v = b + (78 - b) * (1 - Math.exp(-2.2 * t * (1 + k * 0.55)));
        else if (kind === 'cool')  v = 20 + (b + 55 - 20) * Math.exp(-2.0 * t * (1 + k * 0.3));
        else if (kind === 'decay') v = b / Math.pow(1 + 2.6 * t, 2) + b * 0.05;
        else if (kind === 'boyle') v = b * 1.6 / (0.55 + 1.1 * t);
        else if (kind === 'rise')  v = b * (1 + 1.4 * t);
        else if (kind === 'linear')v = b * (0.35 + 1.3 * t);
        else                       v = b * (1 + 0.45 * t);
        v = v + jit(Math.max(0.02, Math.abs(v) * 0.012));
        out.push(Math.round(v * 100) / 100);
      });
      return out;
    }

    return {
      kind: kind, rows: rows, xLabel: xLab, xUnit: xUnit,
      cols: ser.map(function (s, k) { return { label: (s.label || ('값 ' + (k + 1))), unit: s.unit || '' }; }),
      at: at
    };
  }

  //  모의 장치가 실제로 뱉는 줄 — 진짜 보드와 똑같이 @schema 부터 보냅니다.
  function mockLines(spec, count, seedHint) {
    var plan = mockPlan(spec, seedHint);
    var out = ['@schema,1,' + plan.cols.map(function (c) {
      return '모의장치:' + c.label + (c.unit ? ('(' + c.unit + ')') : '');
    }).join(',')];
    var n = Math.max(1, Number(count) || plan.rows);
    var t0 = 1712345678901;
    for (var i = 0; i < n; i++) {
      var v = plan.at(i);
      out.push(String(t0 + i * 1000) + ',' + v.slice(1).join(','));
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  //  7. connect(kind, opt) — 연결 객체
  //     공통: { kind, mock, open(), start(), stop(), close(), isOpen, isRunning }
  //     콜백: opt.onLine(line) · opt.onStatus(state, msg) · opt.onError(msg, err)
  // ─────────────────────────────────────────────────────────────────
  var EZON_SVC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  //  이지메이커 BLE SDK — 저작권 표기가 없어 이 저장소에 사본을 두지 않습니다.
  //  학생이 '무선'을 고른 그 순간에만 원본 주소에서 한 번 불러옵니다.
  //  못 불러오면 "인터넷 연결이 필요합니다" 를 알리고 유선·직접입력·CSV 는 그대로 됩니다.
  var EZON_SDK_SRCS = ['./lib/ezon-ble.js', 'https://ezon-ble-sdk.pages.dev/ezon-ble.iife.js'];
  var sdkPromise = null;                                   // 같은 스크립트를 두 번 넣지 않습니다.

  function loadEzonSdk(timeoutMs) {
    if (W && W.navigator && W.navigator.ezonBle) return Promise.resolve(W.navigator.ezonBle);
    if (sdkPromise) return sdkPromise;
    if (!W || !W.document) return Promise.reject(new Error('브라우저가 아닙니다.'));

    sdkPromise = new Promise(function (resolve, reject) {
      var doc = W.document;
      var el = doc.querySelector('script[data-sensorkit-sdk="ezon"]');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true; sdkPromise = null;
        reject(new Error('SDK 를 불러오는 데 너무 오래 걸립니다.'));
      }, Math.max(3000, Number(timeoutMs) || 12000));

      function ok() {
        if (done) return; done = true; clearTimeout(timer);
        try { if (W.ezonBle && isFn(W.ezonBle.install)) W.ezonBle.install(); } catch (e) {}
        if (W.navigator && W.navigator.ezonBle) resolve(W.navigator.ezonBle);
        else { sdkPromise = null; reject(new Error('SDK 는 받았지만 navigator.ezonBle 이 없습니다.')); }
      }
      function bad() {
        if (done) return; done = true; clearTimeout(timer); sdkPromise = null;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        reject(new Error('SDK 파일을 받지 못했습니다.'));
      }

      if (el) { el.addEventListener('load', ok); el.addEventListener('error', bad); if (el.dataset.loaded === '1') ok(); return; }

      //  주소를 차례차례 시도합니다(지금은 원본 하나뿐). 하나라도 되면 그것으로 끝냅니다.
      var at = 0;
      function tryNext() {
        if (done) return;
        if (at >= EZON_SDK_SRCS.length) { bad(); return; }
        var src = EZON_SDK_SRCS[at++];
        var tag = doc.createElement('script');
        tag.src = src;
        tag.async = true;
        tag.setAttribute('data-sensorkit-sdk', 'ezon');
        tag.addEventListener('load', function () { tag.dataset.loaded = '1'; el = tag; ok(); });
        tag.addEventListener('error', function () {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
          tryNext();                                   // 이 주소가 안 되면 다음 주소로 넘어갑니다.
        });
        (doc.head || doc.documentElement).appendChild(tag);
      }
      tryNext();
    });
    return sdkPromise;
  }

  function baseConn(kind, opt) {
    opt = opt || {};
    return {
      kind: kind,
      mock: kind === 'mock',
      isOpen: false,
      isRunning: false,
      _opt: opt,
      _say: function (st, msg) { if (isFn(opt.onStatus)) { try { opt.onStatus(st, msg); } catch (e) {} } },
      _line: function (l) { if (isFn(opt.onLine)) { try { opt.onLine(l); } catch (e) {} } },
      _err: function (msg, e) { if (isFn(opt.onError)) { try { opt.onError(msg, e); } catch (x) {} } }
    };
  }

  // ── 유선(웹 시리얼) ───────────────────────────────────────────
  function connectSerial(opt) {
    var c = baseConn('serial', opt);
    var port = null, reader = null, pipeDone = null, lb = new LineBuf(), stopping = false;

    c.open = function () {
      var nav = (typeof navigator !== 'undefined') ? navigator : null;
      if (!nav || !nav.serial) {
        var s = support();
        return Promise.reject(new Error(s.serialWhy || '이 브라우저는 케이블 연결(웹 시리얼)을 지원하지 않습니다.'));
      }
      return nav.serial.requestPort()
        .then(function (p) {
          port = p;
          return port.open({ baudRate: Number(opt.baudRate) || 115200 });
        })
        .then(function () {
          c.isOpen = true;
          c._say('open', '케이블로 연결했습니다.');
          if (nav.serial.addEventListener) {
            nav.serial.addEventListener('disconnect', onUnplug);
          }
          return c;
        })
        .catch(function (e) { throw new Error(humanError(e, '케이블 연결')); });
    };

    function onUnplug(ev) {
      if (!c.isOpen) return;
      if (ev && ev.target && port && ev.target !== port) return;
      c.isRunning = false; c.isOpen = false;
      c._say('lost', '케이블이 빠졌습니다. 지금까지 모은 값은 그대로 남아 있습니다.');
    }

    c.start = function () {
      if (!c.isOpen || !port) return Promise.reject(new Error('먼저 연결해 주세요.'));
      if (c.isRunning) return Promise.resolve(c);
      c.isRunning = true; stopping = false;
      c._say('run', '값을 받고 있습니다.');
      (function loop() {
        var dec;
        try { dec = new TextDecoderStream(); }
        catch (e) { c.isRunning = false; c._err('이 브라우저가 글자 해독기를 만들지 못했습니다.', e); return; }
        pipeDone = port.readable.pipeTo(dec.writable).catch(function () {});
        reader = dec.readable.getReader();
        (function pump() {
          reader.read().then(function (r) {
            if (r.done) { finish(); return; }
            if (r.value) lb.push(r.value).forEach(function (l) { c._line(l); });
            if (c.isRunning) pump(); else finish();
          }).catch(function (e) {
            if (!stopping) c._err(humanError(e, '값 받기'), e);
            finish();
          });
        })();
      })();
      return Promise.resolve(c);
    };

    function finish() {
      try { if (reader) reader.releaseLock(); } catch (e) {}
      reader = null;
      lb.flush().forEach(function (l) { c._line(l); });
      if (c.isRunning) {
        c.isRunning = false;
        c._say('lost', '값이 더 오지 않습니다. 케이블·전원을 확인해 주세요.');
      }
    }

    c.stop = function () {
      if (!c.isRunning) return Promise.resolve(c);
      stopping = true; c.isRunning = false;
      var p = reader ? reader.cancel().catch(function () {}) : Promise.resolve();
      return p.then(function () { return pipeDone || null; })
              .catch(function () {})
              .then(function () { c._say('open', '수집을 멈췄습니다.'); return c; });
    };

    c.close = function () {
      return c.stop().then(function () {
        var nav = (typeof navigator !== 'undefined') ? navigator : null;
        if (nav && nav.serial && nav.serial.removeEventListener) nav.serial.removeEventListener('disconnect', onUnplug);
        var p = port ? port.close().catch(function () {}) : Promise.resolve();
        return p;
      }).then(function () {
        port = null; c.isOpen = false;
        c._say('closed', '연결을 끊었습니다.');
        return c;
      });
    };

    return c;
  }

  // ── 무선(웹 블루투스) ─────────────────────────────────────────
  function connectBle(opt) {
    opt = opt || {};
    var c = baseConn('ble', opt);
    var hub = null, reader = null, lb = new LineBuf(), looping = false, stopping = false;
    c.sensorId = Number(opt.sensorId) || 20;
    c.intervalMs = Number(opt.intervalMs) || 500;

    c.open = function () {
      var s = support();
      if (!s.ble) return Promise.reject(new Error(s.bleWhy || '이 브라우저는 블루투스 연결을 지원하지 않습니다.'));
      return loadEzonSdk(opt.sdkTimeoutMs)
        .catch(function (e) {
          throw new Error('인터넷 연결이 필요합니다 — 무선 연결에 쓰는 프로그램을 내려받지 못했습니다(' +
                          ((e && e.message) || '') + '). 학교 인터넷을 확인하시고, 그동안은 케이블·직접 입력·CSV 를 쓰실 수 있습니다.');
        })
        .then(function (ez) {
          return ez.requestPort({
            filters: [{ namePrefix: 'EZ' }, { services: [EZON_SVC] }],
            optionalServices: [EZON_SVC]
          });
        })
        .then(function (p) { hub = p; return hub.open(); })
        .then(function () {
          c.isOpen = true;
          c._say('open', '블루투스로 연결했습니다.');
          pump();
          return c;
        })
        .catch(function (e) {
          if (e && /인터넷 연결이 필요합니다/.test(e.message || '')) throw e;
          throw new Error(humanError(e, '블루투스 연결'));
        });
    };

    function pump() {
      if (looping || !hub || !hub.readable) return;
      looping = true;
      try { reader = hub.readable.getReader(); }
      catch (e) { looping = false; c._err(humanError(e, '값 받기'), e); return; }
      (function step() {
        reader.read().then(function (r) {
          if (r.done) { done(); return; }
          if (r.value) lb.push(r.value).forEach(function (l) { if (c.isRunning) c._line(l); });
          if (c.isOpen) step(); else done();
        }).catch(function (e) {
          if (!stopping) c._err(humanError(e, '값 받기'), e);
          done();
        });
      })();
    }
    function done() {
      try { if (reader) reader.releaseLock(); } catch (e) {}
      reader = null; looping = false;
      if (c.isOpen && c.isRunning) {
        c.isRunning = false;
        c._say('lost', '블루투스 연결이 끊겼습니다. 지금까지 모은 값은 그대로 남아 있습니다.');
      }
    }

    c.getDevices = function () {
      try { return (hub && isFn(hub.getDevices)) ? hub.getDevices() : []; } catch (e) { return []; }
    };
    c.addDevice = function () {
      if (!hub || !isFn(hub.connectMore)) return Promise.reject(new Error('지금 SDK 는 장치 추가를 지원하지 않습니다.'));
      return hub.connectMore().then(function () { return c.getDevices(); })
                .catch(function (e) { throw new Error(humanError(e, '장치 추가')); });
    };
    c.setSensor = function (sensorId, intervalMs, deviceId) {
      if (!hub) return Promise.reject(new Error('먼저 연결해 주세요.'));
      var sid = Number(sensorId) || c.sensorId;
      var iv  = Math.max(0, Number(intervalMs) || c.intervalMs);
      c.sensorId = sid; c.intervalMs = iv;
      var p;
      if (!deviceId || deviceId === '__all__') p = hub.setSensorAll(sid, iv);
      else if (isFn(hub.setSensor))            p = hub.setSensor(deviceId, sid, iv);
      else                                     p = hub.setSensorAll(sid, iv);
      return Promise.resolve(p).catch(function (e) { throw new Error(humanError(e, '센서 설정')); });
    };
    c.setDeviceName = function (id, name) {
      if (!hub || !isFn(hub.setDeviceName)) return Promise.reject(new Error('지금 SDK 는 이름 바꾸기를 지원하지 않습니다.'));
      return hub.setDeviceName(id, name).catch(function (e) { throw new Error(humanError(e, '장치 이름')); });
    };

    c.start = function () {
      if (!c.isOpen || !hub) return Promise.reject(new Error('먼저 연결해 주세요.'));
      if (c.isRunning) return Promise.resolve(c);
      stopping = false;
      return c.setSensor(c.sensorId, c.intervalMs, '__all__')
        .then(function () { return hub.startAll(); })
        .then(function () {
          c.isRunning = true; pump();
          c._say('run', '값을 받고 있습니다.');
          return c;
        })
        .catch(function (e) { throw new Error(e && e.message ? e.message : humanError(e, '수집 시작')); });
    };

    c.stop = function () {
      if (!c.isRunning) return Promise.resolve(c);
      stopping = true; c.isRunning = false;
      var p = (hub && isFn(hub.stopAll)) ? hub.stopAll() : Promise.resolve();
      return Promise.resolve(p).catch(function () {})
        .then(function () { c._say('open', '수집을 멈췄습니다.'); return c; });
    };

    c.close = function () {
      return c.stop().then(function () {
        c.isOpen = false;
        try { if (reader) reader.cancel(); } catch (e) {}
        var p = (hub && isFn(hub.close)) ? hub.close() : Promise.resolve();
        return Promise.resolve(p).catch(function () {});
      }).then(function () {
        hub = null;
        c._say('closed', '연결을 끊었습니다.');
        return c;
      });
    };

    return c;
  }

  // ── 모의 장치 ─────────────────────────────────────────────────
  function connectMock(opt) {
    opt = opt || {};
    var c = baseConn('mock', opt);
    var timer = null, i = 0, plan = null, sentSchema = false;
    c.intervalMs = Math.max(50, Number(opt.intervalMs) || 500);
    c.spec = opt.spec || null;

    c.open = function () {
      plan = mockPlan(c.spec, opt.seed);
      c.isOpen = true;
      c._say('open', '시험용 모의 장치를 붙였습니다. 진짜 센서 값이 아닙니다.');
      return Promise.resolve(c);
    };

    c.setSpec = function (spec) { c.spec = spec; plan = mockPlan(spec, opt.seed); sentSchema = false; };

    c.start = function () {
      if (!c.isOpen) return Promise.reject(new Error('먼저 연결해 주세요.'));
      if (c.isRunning) return Promise.resolve(c);
      if (!plan) plan = mockPlan(c.spec, opt.seed);
      c.isRunning = true;
      if (!sentSchema) {
        sentSchema = true;
        c._line('# 시험용 모의 값입니다 — 진짜 센서 값이 아닙니다');
        c._line('@schema,1,' + plan.cols.map(function (col) {
          return '모의장치:' + col.label + (col.unit ? ('(' + col.unit + ')') : '');
        }).join(','));
      }
      timer = setInterval(function () {
        var v = plan.at(i); i++;
        c._line(String(Date.now()) + ',' + v.slice(1).join(','));
      }, c.intervalMs);
      if (timer && isFn(timer.unref)) timer.unref();        // node 에서 프로세스를 붙잡지 않게
      c._say('run', '모의 값을 흘려보내고 있습니다.');
      return Promise.resolve(c);
    };

    c.stop = function () {
      if (timer) { clearInterval(timer); timer = null; }
      c.isRunning = false;
      c._say('open', '모의 값을 멈췄습니다.');
      return Promise.resolve(c);
    };

    c.close = function () {
      return c.stop().then(function () {
        c.isOpen = false; i = 0; sentSchema = false;
        c._say('closed', '모의 장치를 뗐습니다.');
        return c;
      });
    };

    return c;
  }

  function connect(kind, opt) {
    if (kind === 'serial') return connectSerial(opt);
    if (kind === 'ble')    return connectBle(opt);
    if (kind === 'mock')   return connectMock(opt);
    throw new Error("connect 는 'serial' · 'ble' · 'mock' 만 받습니다.");
  }

  // ─────────────────────────────────────────────────────────────────
  //  8. 골고루 뽑기 — index.html 의 pickIdx 와 같은 규칙(처음·끝 포함).
  // ─────────────────────────────────────────────────────────────────
  function pickIdx(n, want) {
    if (want >= n) { var all = []; for (var i = 0; i < n; i++) all.push(i); return all; }
    if (want <= 1) return [0];
    var out = [];
    for (var k = 0; k < want; k++) {
      var j = Math.round(k * (n - 1) / (want - 1));
      if (!out.length || out[out.length - 1] !== j) out.push(j);
    }
    return out;
  }

  //  모은 값 → 표에 넣을 행. rows 는 [x, s1, s2…] 꼴로, 첫 칸은 가로축입니다.
  //  가로축이 '시간' 이면 첫 값을 0 으로 맞춘 경과 시간(초)을 씁니다.
  function toRows(buf, spec, want, opt) {
    opt = opt || {};
    var cols = ((spec && spec.series) ? spec.series.length : 1) + 1;
    var xs = (spec && spec.x) || {};
    var xIsTime = has(String(xs.label || '') + String(xs.unit || ''), ['시간', '초', '분', 'sec', 'min', 'time']);
    var xIsCount = has(String(xs.label || ''), ['회차', '번호', '순번', '샘플']);
    var perMin = has(String(xs.unit || ''), ['분', 'min']);

    var idx = pickIdx(buf.length, Math.max(1, Number(want) || buf.length));
    var t0 = buf.length ? (buf[0].t || 0) : 0;

    return idx.map(function (bi, k) {
      var it = buf[bi];
      var row = [];
      var x;
      if (xIsCount || !xIsTime) x = (k + 1);
      else {
        var sec = ((it.t || 0) - t0) / 1000;
        x = perMin ? (Math.round(sec / 60 * 100) / 100) : (Math.round(sec * 10) / 10);
      }
      row.push(String(x));
      for (var c = 1; c < cols; c++) {
        var v = it.v[c - 1];
        row.push((v === null || v === undefined || !isFinite(v)) ? '' : fmtNum(v));
      }
      return row;
    });
  }

  // ─────────────────────────────────────────────────────────────────
  //  9. 작은 실시간 그래프 (인라인 SVG · 라이브러리 0)
  // ─────────────────────────────────────────────────────────────────
  var GC = ['var(--g1,#20B2A6)', 'var(--g2,#54B4E8)', 'var(--g3,#FFC130)', 'var(--g4,#FF8C6B)',
            'var(--g5,#8B7FD4)', 'var(--g6,#4FB477)', 'var(--g7,#E88FB5)'];

  function miniSVG(view, nSer, w, h) {
    w = w || 460; h = h || 120;
    var P = { l: 6, r: 6, t: 8, b: 8 };
    if (!view.length || !nSer) {
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="실시간 그래프">' +
             '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="none"/>' +
             '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" font-size="12" fill="var(--muted,#6E8A96)">값을 기다리는 중…</text></svg>';
    }
    var lo = Infinity, hi = -Infinity;
    view.forEach(function (it) {
      for (var i = 0; i < nSer; i++) {
        var v = it.v[i];
        if (v === null || v === undefined || !isFinite(v)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { hi = lo + 1; lo = lo - 1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;

    var iw = w - P.l - P.r, ih = h - P.t - P.b;
    var n = view.length;
    function X(i) { return P.l + (n <= 1 ? iw / 2 : (i * iw / (n - 1))); }
    function Y(v) { return P.t + ih - ((v - lo) / (hi - lo)) * ih; }

    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="실시간 그래프">';
    s += '<line x1="' + P.l + '" y1="' + (P.t + ih) + '" x2="' + (P.l + iw) + '" y2="' + (P.t + ih) +
         '" stroke="var(--line-2,#D3E6EA)" stroke-width="1"/>';
    for (var k = 0; k < nSer; k++) {
      var d = '', open = false;
      for (var i = 0; i < n; i++) {
        var v = view[i].v[k];
        if (v === null || v === undefined || !isFinite(v)) { open = false; continue; }
        d += (open ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
        open = true;
      }
      if (d) s += '<path d="' + d + '" fill="none" stroke="' + GC[k % GC.length] +
                  '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      var last = null;
      for (var j = n - 1; j >= 0; j--) { var lv = view[j].v[k]; if (lv !== null && lv !== undefined && isFinite(lv)) { last = { i: j, v: lv }; break; } }
      if (last) s += '<circle cx="' + X(last.i).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) +
                     '" r="3" fill="' + GC[k % GC.length] + '"/>';
    }
    return s + '</svg>';
  }

  // ─────────────────────────────────────────────────────────────────
  //  10. 화면에 붙이는 CSS (한 번만 넣습니다)
  // ─────────────────────────────────────────────────────────────────
  var CSS_ID = 'sensorkit-css';
  var CSS = [
    '.skw{border:1px solid var(--line-2,#D3E6EA);border-radius:var(--r,18px);background:var(--paper,#fff);padding:14px;margin:12px 0}',
    '.skw *{box-sizing:border-box}',
    '.sk-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.sk-b{border:1px solid var(--line-2,#D3E6EA);background:var(--cream,#FFFDF6);color:var(--ink,#254753);',
    'border-radius:12px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;line-height:1.3}',
    '.sk-b:hover{border-color:var(--mint,#20B2A6)}',
    '.sk-b[disabled]{opacity:.45;cursor:not-allowed}',
    '.sk-b.pri{background:var(--mint,#20B2A6);border-color:var(--mint,#20B2A6);color:#fff}',
    '.sk-b.warn{background:var(--coral,#FF8C6B);border-color:var(--coral,#FF8C6B);color:#fff}',
    '.sk-b.sm{padding:6px 10px;font-size:13px;font-weight:600}',
    '.sk-tag{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12.5px;font-weight:700}',
    '.sk-tag.off{background:#F1F5F6;color:var(--muted,#6E8A96)}',
    '.sk-tag.on{background:#E7F7F5;color:var(--mint-d,#14867C)}',
    '.sk-tag.run{background:#FFF3DC;color:#9A6A12}',
    '.sk-tag.bad{background:#FDEDED;color:var(--bad,#E05A5A)}',
    '.sk-muted{color:var(--muted,#6E8A96);font-size:13px;margin:6px 0 0}',
    '.sk-msg{margin:8px 0 0;font-size:13.5px;line-height:1.6}',
    '.sk-msg.bad{color:var(--bad,#E05A5A)}.sk-msg.ok{color:var(--mint-d,#14867C)}.sk-msg.warn{color:var(--warn,#E8873C)}',
    '.sk-ways{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:10px 0 2px}',
    '.sk-way{text-align:left;border:1px solid var(--line-2,#D3E6EA);border-radius:14px;background:var(--paper,#fff);',
    'padding:12px;cursor:pointer;font:inherit;color:var(--ink,#254753)}',
    '.sk-way:hover:not([disabled]){border-color:var(--mint,#20B2A6);box-shadow:var(--shadow,0 10px 28px rgba(37,71,83,.09))}',
    '.sk-way[disabled]{opacity:.5;cursor:not-allowed;background:#FAFCFC}',
    '.sk-way b{display:block;font-size:15px;margin-bottom:3px}',
    '.sk-way span{display:block;font-size:12.5px;color:var(--muted,#6E8A96);line-height:1.5}',
    '.sk-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}',
    '.sk-card{border:1px solid var(--line,#E4EFF1);border-radius:14px;padding:10px 12px;background:var(--cream,#FFFDF6)}',
    '.sk-card .lb{font-size:12px;color:var(--muted,#6E8A96);display:block;margin-bottom:2px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sk-card .vv{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
    '.sk-card .uu{font-size:13px;font-weight:600;color:var(--muted,#6E8A96);margin-left:3px}',
    '.sk-chart{border:1px solid var(--line,#E4EFF1);border-radius:14px;padding:6px;background:var(--paper,#fff)}',
    '.sk-num{width:88px;border:1px solid var(--line-2,#D3E6EA);border-radius:10px;padding:7px 9px;font:inherit;',
    'font-variant-numeric:tabular-nums}',
    '.sk-sel{border:1px solid var(--line-2,#D3E6EA);border-radius:10px;padding:7px 9px;font:inherit;background:#fff;max-width:230px}',
    '.sk-lb{font-size:13px;color:var(--muted,#6E8A96);font-weight:600}',
    '.sk-mock{border:1px dashed var(--coral,#FF8C6B);background:#FFF6F2;color:#9C4B30;border-radius:12px;',
    'padding:9px 12px;font-size:13.5px;font-weight:700;margin:10px 0}',
    '.sk-hide{display:none}'
  ].join('');

  function ensureCSS() {
    if (!W || !W.document) return;
    if (W.document.getElementById(CSS_ID)) return;
    var st = W.document.createElement('style');
    st.id = CSS_ID; st.textContent = CSS;
    (W.document.head || W.document.documentElement).appendChild(st);
  }

  // ─────────────────────────────────────────────────────────────────
  //  11. mount(el, opt) — 수집 UI
  //
  //    opt = {
  //      spec,                 // 실험의 dataSpec (모의값·표 넣기 목표 행 수에 씁니다)
  //      maxRows,              // 표가 감당하는 최대 행 (기본 60)
  //      onRow(values, meta),  // 한 줄씩 올려 줍니다.  meta = {source, mock, ts, labels, batch, index, total, manual}
  //      onRows(rows, meta),   // (있으면) 여러 줄을 한꺼번에.  rows = [[x, s1, s2…], …]
  //      onStatus(state, msg)  // 바깥에서도 상태를 알고 싶을 때
  //    }
  //    돌려주는 것: { destroy(), setSpec(spec), buffer(), connection() }
  // ─────────────────────────────────────────────────────────────────
  function mount(el, opt) {
    opt = opt || {};
    if (!el || !W || !W.document) throw new Error('mount 는 브라우저에서 DOM 붙일 자리와 함께 불러 주세요.');
    ensureCSS();

    var VIEW_MAX = 180;                                  // 화면(그래프)에 남겨 두는 값
    var BUF_MAX  = Math.max(200, Number(opt.bufferMax) || 20000);
    var MAXROWS  = Math.max(3, Number(opt.maxRows) || 60);

    var spec  = opt.spec || null;
    var state = newState();
    var conn  = null;
    var buf   = [];                                      // [{t, v:[…]}] — 모은 값 전부(상한 있음)
    var view  = [];                                      // 최근 것만 — 그래프·카드용
    var labels = [];                                     // [{label, unit}]
    var lastVals = null;
    var dirty = false, painter = null, lineCount = 0, skipCount = 0;
    var askedComma = false;                              // '1,25' 물음은 한 번만 띄웁니다
    var sup = support();

    var uid = 'sk' + Math.random().toString(36).slice(2, 8);
    function q(n) { return el.querySelector('[data-sk="' + n + '"]'); }

    el.innerHTML = shell();
    bind();
    paintWays();

    function shell() {
      return '<div class="skw" id="' + uid + '">' +
        '<div class="sk-row">' +
          '<button type="button" class="sk-b pri" data-sk="connect">🔌 센서 연결</button>' +
          '<span class="sk-tag off" data-sk="tag">연결 안 됨</span>' +
          '<span class="sk-muted" data-sk="count" style="margin:0"></span>' +
        '</div>' +
        '<p class="sk-msg" data-sk="msg"></p>' +

        '<div class="sk-hide" data-sk="ways">' +
          '<p class="sk-muted">어떻게 이을까요?</p>' +
          '<div class="sk-ways">' +
            '<button type="button" class="sk-way" data-sk="way-serial"><b>🔌 유선(케이블)</b><span data-sk="why-serial"></span></button>' +
            '<button type="button" class="sk-way" data-sk="way-ble"><b>📶 무선(블루투스)</b><span data-sk="why-ble"></span></button>' +
            '<button type="button" class="sk-way" data-sk="way-mock"><b>🧪 시험용 모의 장치</b><span>센서가 없어도 흐름을 익혀 볼 수 있습니다. 진짜 값이 아닙니다.</span></button>' +
          '</div>' +
          '<p class="sk-muted">무선은 처음 한 번 인터넷이 필요합니다. 케이블·직접 입력·CSV 는 인터넷 없이도 됩니다.</p>' +
        '</div>' +

        '<div class="sk-hide" data-sk="live">' +
          '<div class="sk-mock sk-hide" data-sk="mockwarn">🧪 시험용 모의 값입니다 — 진짜 센서 값이 아닙니다. 수업 자료로 저장하지 마세요.</div>' +
          '<div class="sk-cards" data-sk="cards"></div>' +
          '<div class="sk-chart" data-sk="chart"></div>' +
          '<div class="sk-row" style="margin-top:10px">' +
            '<button type="button" class="sk-b pri" data-sk="run">▶ 수집 시작</button>' +
            '<span class="sk-lb">수집 주기</span>' +
            '<input type="number" class="sk-num" data-sk="iv" value="500" min="50" step="50" />' +
            '<span class="sk-lb">ms</span>' +
            '<span class="sk-hide" data-sk="blebox">' +
              '<span class="sk-lb" style="margin-left:6px">센서</span> ' +
              '<select class="sk-sel" data-sk="sensor"></select> ' +
              '<button type="button" class="sk-b sm" data-sk="apply">적용</button> ' +
              '<button type="button" class="sk-b sm" data-sk="add">➕ 장치 추가</button>' +
            '</span>' +
          '</div>' +
          '<div class="sk-row" style="margin-top:10px">' +
            '<button type="button" class="sk-b" data-sk="one">✍️ 지금 값 한 줄 담기</button>' +
            '<button type="button" class="sk-b pri" data-sk="fill">📋 표에 넣기</button>' +
            '<button type="button" class="sk-b" data-sk="fillall">표에 전부 넣기</button>' +
            '<button type="button" class="sk-b" data-sk="clear">비우기</button>' +
            '<button type="button" class="sk-b warn" data-sk="off">연결 끊기</button>' +
          '</div>' +
          '<p class="sk-muted" data-sk="hint"></p>' +
        '</div>' +
      '</div>';
    }

    // ── 상태 표시 ─────────────────────────────────────────────
    function tag(kind, text) {
      var t = q('tag'); if (!t) return;
      t.className = 'sk-tag ' + kind;
      t.textContent = text;
    }
    function say(text, tone) {
      var m = q('msg'); if (!m) return;
      m.className = 'sk-msg' + (tone ? (' ' + tone) : '');
      m.textContent = text || '';
    }
    //  '1,25' 를 만났을 때 — 학생에게 한 번 묻습니다. (say 는 textContent 라 단추를 못 넣습니다)
    function askComma() {
      var m = q('msg'); if (!m) return;
      m.className = 'sk-msg warn';
      m.innerHTML = '이 보드가 <b>1,25</b> 를 소수점으로 쓰는 것 같습니다 — 값 하나로 읽을까요? ' +
        '<button type="button" class="sk-b sm" data-sk="comma-yes">네, 소수점입니다</button> ' +
        '<button type="button" class="sk-b sm" data-sk="comma-no">아니요, 값 둘입니다</button>';
      var y = q('comma-yes'), n = q('comma-no');
      if (y) y.addEventListener('click', useDecimalComma);
      if (n) n.addEventListener('click', function () {
        say('값 둘로 그대로 읽습니다.', '');
      });
    }
    //  켜면 지금까지 모은 애매한 줄을 다시 읽습니다. buf 와 view 는 같은 객체를 가리키므로 함께 고쳐집니다.
    function useDecimalComma() {
      state.decimalComma = true;
      var n = 0;
      for (var i = 0; i < buf.length; i++) {
        var it = buf[i];
        if (!it.amb) continue;
        var r2;
        try { r2 = parseLine(it.amb, state); } catch (e) { r2 = null; }
        if (r2 && r2.kind === 'data') { it.v = r2.values.slice(); n++; }
        delete it.amb;
      }
      if (lastVals) labels = seriesLabels(state, { values: lastVals.v }, spec);
      dirty = true; schedule();
      say('소수점 쉼표로 읽습니다. 이미 모은 ' + n + '줄도 다시 읽었습니다.', 'ok');
    }

    function counts() {
      var c = q('count'); if (!c) return;
      c.textContent = buf.length ? ('모은 값 ' + buf.length.toLocaleString() + '줄' +
                                    (skipCount ? (' · 못 읽은 줄 ' + skipCount) : '')) : '';
    }

    function paintWays() {
      var s1 = q('why-serial'), s2 = q('why-ble');
      var b1 = q('way-serial'), b2 = q('way-ble');
      if (s1) s1.textContent = sup.serial
        ? 'USB 케이블로 잇습니다. 인터넷이 없어도 됩니다. (크롬·엣지·크롬북)'
        : (sup.serialWhy || '이 기기에서는 쓸 수 없습니다.');
      if (s2) s2.textContent = sup.ble
        ? '블루투스로 잇습니다. 처음 한 번 인터넷이 필요합니다. (크롬·엣지·크롬북·안드로이드)'
        : (sup.bleWhy || '이 기기에서는 쓸 수 없습니다.');
      if (b1) b1.disabled = !sup.serial;
      if (b2) b2.disabled = !sup.ble;
    }

    function fillSensorSelect() {
      var sel = q('sensor'); if (!sel) return;
      sel.innerHTML = SENSOR_ORDER.map(function (id) {
        return '<option value="' + id + '">' + esc(id + ' · ' + sensorName(id)) + '</option>';
      }).join('');
      sel.value = '20';
    }

    // ── 들어온 줄 다루기 ─────────────────────────────────────
    function onLine(line) {
      lineCount++;
      var res;
      try { res = parseLine(line, state); }
      catch (e) { skipCount++; return; }

      if (res.kind === 'schema') {
        applyResult(state, res);
        labels = res.cols.map(function (c) { return { label: c.label, unit: c.unit }; });
        view = []; lastVals = null;
        dirty = true; schedule();
        return;
      }
      if (res.kind === 'skip') {
        if (res.why === 'nonnumeric' || res.why === 'mostly-text') skipCount++;
        return;
      }

      //  '1,25' — 값 둘인지 소수 하나인지 알 길이 없는 자리입니다. 조용히 넘기지 않고 한 번 물어봅니다.
      if (res.ambiguous && !state.decimalComma && !askedComma) { askedComma = true; askComma(); }

      if (!labels.length || (res.names && res.names.length)) labels = seriesLabels(state, res, spec);
      var t = (res.ts !== null && res.ts !== undefined) ? res.ts : Date.now();
      var item = { t: t, v: res.values.slice() };
      //  나중에 '소수점입니다' 를 고르면 이 줄들만 다시 읽습니다(원문은 '1,25' 처럼 아주 짧습니다).
      if (res.ambiguous && !state.decimalComma) item.amb = res.raw;

      buf.push(item);
      if (buf.length > BUF_MAX) buf.splice(0, buf.length - BUF_MAX);
      view.push(item);
      if (view.length > VIEW_MAX) view.splice(0, view.length - VIEW_MAX);
      lastVals = item;
      dirty = true; schedule();
    }

    //  화면 갱신은 100ms 마다 묶어서 — 값이 아무리 빨리 와도 페이지가 멈추지 않게.
    function schedule() {
      if (painter) return;
      painter = setTimeout(function () { painter = null; if (dirty) { dirty = false; paintLive(); } }, 100);
    }

    function paintLive() {
      var cards = q('cards'), chart = q('chart');
      if (cards) {
        if (!lastVals) cards.innerHTML = '<div class="sk-card"><span class="lb">기다리는 중</span><span class="vv">—</span></div>';
        else cards.innerHTML = lastVals.v.map(function (v, i) {
          var L = labels[i] || { label: '값 ' + (i + 1), unit: '' };
          return '<div class="sk-card"><span class="lb" title="' + esc(L.label) + '">' + esc(L.label) + '</span>' +
                 '<span class="vv">' + esc(v === null || v === undefined ? '—' : fmtNum(v)) + '</span>' +
                 (L.unit ? '<span class="uu">' + esc(L.unit) + '</span>' : '') + '</div>';
        }).join('');
      }
      if (chart) chart.innerHTML = miniSVG(view, lastVals ? lastVals.v.length : 0);
      counts();
      hint();
    }

    function hint() {
      var h = q('hint'); if (!h) return;
      var want = specRows();
      h.textContent = buf.length
        ? ('[표에 넣기] 를 누르면 ' + buf.length.toLocaleString() + '줄에서 처음·끝을 포함해 골고루 ' +
           Math.min(want, buf.length) + '줄을 뽑아 표에 넣습니다. 넣은 뒤 값을 확인하고 [데이터 저장]을 눌러 주세요.')
        : '수집을 시작하면 값이 여기에 쌓입니다.';
    }

    function specRows() {
      var r = (spec && Number(spec.rows)) || 8;
      return clamp(r, 3, MAXROWS);
    }

    // ── 표에 넣기 ────────────────────────────────────────────
    function push(rows, extra) {
      var meta = {
        source: conn ? conn.kind : 'none',
        mock: !!(conn && conn.mock),
        labels: labels.slice(),
        total: rows.length
      };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) meta[k] = extra[k];

      if (isFn(opt.onRows)) { try { opt.onRows(rows, meta); } catch (e) { say(humanError(e, '표에 넣기'), 'bad'); return false; } return true; }
      if (isFn(opt.onRow)) {
        for (var i = 0; i < rows.length; i++) {
          var m = {};
          for (var kk in meta) if (Object.prototype.hasOwnProperty.call(meta, kk)) m[kk] = meta[kk];
          m.index = i; m.batch = rows.length > 1;
          try { opt.onRow(rows[i], m); } catch (e2) { say(humanError(e2, '표에 넣기'), 'bad'); return false; }
        }
        return true;
      }
      say('이 화면은 표에 넣을 곳이 붙어 있지 않습니다(onRow 가 없습니다).', 'warn');
      return false;
    }

    function doFill(all) {
      if (!buf.length) { say('아직 모은 값이 없습니다. [수집 시작]을 눌러 주세요.', 'warn'); return; }
      var want = all ? Math.min(buf.length, MAXROWS) : Math.min(specRows(), buf.length);
      var rows = toRows(buf, spec, want);
      if (!push(rows)) return;
      var mockNote = (conn && conn.mock) ? ' ⚠ 시험용 모의 값입니다 — 수업 자료로 저장하지 마세요.' : '';
      say('표에 넣었습니다. 모은 ' + buf.length.toLocaleString() + '줄 → ' + rows.length + '줄.' +
          (all && buf.length > MAXROWS ? (' (표는 ' + MAXROWS + '줄까지라 그만큼만 넣었습니다.)') : '') +
          mockNote, (conn && conn.mock) ? 'warn' : 'ok');
    }

    function doOne() {
      if (!lastVals) { say('아직 들어온 값이 없습니다.', 'warn'); return; }
      var rows = toRows([lastVals], spec, 1);
      if (!push(rows, { manual: true, batch: false })) return;
      say('지금 값을 한 줄 담았습니다.' + ((conn && conn.mock) ? ' ⚠ 시험용 모의 값입니다.' : ''),
          (conn && conn.mock) ? 'warn' : 'ok');
    }

    // ── 연결 ────────────────────────────────────────────────
    function statusCB(st, msg) {
      if (st === 'open')   tag('on', conn && conn.mock ? '모의 장치' : '연결됨');
      if (st === 'run')    tag('run', '받는 중');
      if (st === 'lost')   tag('bad', '끊김');
      if (st === 'closed') tag('off', '연결 안 됨');
      if (msg) say(msg, st === 'lost' ? 'bad' : (st === 'run' ? 'ok' : ''));
      if (st === 'lost') setRun(false);
      if (isFn(opt.onStatus)) { try { opt.onStatus(st, msg); } catch (e) {} }
    }

    function setRun(on) {
      var b = q('run'); if (!b) return;
      b.textContent = on ? '⏹ 수집 중지' : '▶ 수집 시작';
      b.className = 'sk-b ' + (on ? 'warn' : 'pri');
    }

    function openWith(kind) {
      var iv = Number((q('iv') || {}).value) || 500;
      state = newState();
      labels = []; view = []; lastVals = null; skipCount = 0; lineCount = 0;
      conn = connect(kind, {
        spec: spec, intervalMs: iv, sensorId: 20,
        onLine: onLine, onStatus: statusCB,
        onError: function (m) { say(m, 'bad'); }
      });
      say('연결 창을 여는 중입니다. 목록에서 보드를 골라 주세요…', '');
      conn.open().then(function () {
        q('ways').classList.add('sk-hide');
        q('live').classList.remove('sk-hide');
        q('connect').textContent = '🔌 다시 고르기';
        q('blebox').classList.toggle('sk-hide', kind !== 'ble');
        q('mockwarn').classList.toggle('sk-hide', kind !== 'mock');
        if (kind === 'ble') fillSensorSelect();
        setRun(false);
        paintLive();
      }).catch(function (e) {
        conn = null;
        tag('bad', '연결 못 함');
        say((e && e.message) || '연결하지 못했습니다.', 'bad');
        if (kind === 'ble') say(((e && e.message) || '연결하지 못했습니다.') +
          ' 케이블(유선)이나 직접 입력·CSV 로도 자료를 넣을 수 있습니다.', 'bad');
      });
    }

    function closeConn() {
      var c = conn; conn = null;
      var p = c ? c.close().catch(function () {}) : Promise.resolve();
      return p.then(function () {
        q('live').classList.add('sk-hide');
        q('connect').textContent = '🔌 센서 연결';
        tag('off', '연결 안 됨');
        say(buf.length ? ('연결을 끊었습니다. 모은 값 ' + buf.length.toLocaleString() + '줄은 그대로 있습니다.') : '연결을 끊었습니다.', '');
      });
    }

    // ── 이벤트 ──────────────────────────────────────────────
    function on(name, fn) { var b = q(name); if (b) b.addEventListener('click', fn); }
    function bind() {
      on('connect', function () {
        sup = support(); paintWays();
        var w = q('ways');
        var show = w.classList.contains('sk-hide');
        w.classList.toggle('sk-hide', !show);
        if (show) say(sup.why || '', (sup.serial || sup.ble) ? '' : 'warn');
      });
      on('way-serial', function () { q('ways').classList.add('sk-hide'); openWith('serial'); });
      on('way-ble',    function () { q('ways').classList.add('sk-hide'); openWith('ble'); });
      on('way-mock',   function () { q('ways').classList.add('sk-hide'); openWith('mock'); });

      on('run', function () {
        if (!conn) { say('먼저 센서를 연결해 주세요.', 'warn'); return; }
        if (conn.isRunning) { conn.stop().then(function () { setRun(false); }); return; }
        var iv = clamp(Number((q('iv') || {}).value) || 500, 50, 60000);
        if (conn.kind === 'mock') conn.intervalMs = iv;
        if (conn.kind === 'ble')  conn.intervalMs = iv;
        conn.start().then(function () { setRun(true); })
                    .catch(function (e) { say((e && e.message) || '수집을 시작하지 못했습니다.', 'bad'); });
      });
      on('apply', function () {
        if (!conn || conn.kind !== 'ble') return;
        var sid = Number((q('sensor') || {}).value) || 20;
        var iv  = clamp(Number((q('iv') || {}).value) || 500, 0, 60000);
        conn.setSensor(sid, iv, '__all__')
            .then(function () { state = newState(); labels = []; view = []; say(sensorName(sid) + ' 로 바꿨습니다.', 'ok'); })
            .catch(function (e) { say((e && e.message) || '센서를 바꾸지 못했습니다.', 'bad'); });
      });
      on('add', function () {
        if (!conn || conn.kind !== 'ble') return;
        conn.addDevice().then(function (ds) { say('장치 ' + (ds ? ds.length : 0) + '개가 붙어 있습니다.', 'ok'); })
                        .catch(function (e) { say((e && e.message) || '장치를 더 붙이지 못했습니다.', 'bad'); });
      });
      on('one',     function () { doOne(); });
      on('fill',    function () { doFill(false); });
      on('fillall', function () { doFill(true); });
      on('clear',   function () {
        buf = []; view = []; lastVals = null; skipCount = 0;
        paintLive(); say('모은 값을 비웠습니다. 표는 그대로입니다.', '');
      });
      on('off', function () { closeConn(); });
    }

    return {
      setSpec: function (s) { spec = s || null; if (conn && isFn(conn.setSpec)) conn.setSpec(spec); hint(); },
      buffer:     function () { return buf.slice(); },
      rows:       function (want) { return toRows(buf, spec, want || specRows()); },
      connection: function () { return conn; },
      isMock:     function () { return !!(conn && conn.mock); },
      destroy:    function () {
        if (painter) { clearTimeout(painter); painter = null; }
        var p = conn ? conn.close().catch(function () {}) : Promise.resolve();
        conn = null; buf = []; view = [];
        try { el.innerHTML = ''; } catch (e) {}
        return p;
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  내보내기
  // ─────────────────────────────────────────────────────────────────
  return {
    version: '1.0.0',
    SENSORS: SENSORS,
    SENSOR_ORDER: SENSOR_ORDER,
    EZON_SVC: EZON_SVC,
    EZON_SDK: EZON_SDK_SRCS[EZON_SDK_SRCS.length - 1],   // 원본 주소(참고용)
    EZON_SDK_SRCS: EZON_SDK_SRCS,                        // 실제로 시도하는 주소(원본 하나뿐입니다)

    support: support,
    newState: newState,
    parseLine: parseLine,
    applyResult: applyResult,
    seriesLabels: seriesLabels,
    connect: connect,
    mount: mount,

    //  검증·재사용을 위해 열어 두는 순수 함수들
    num: num,
    isNumCell: isNumCell,
    fmtNum: fmtNum,
    parseCol: parseCol,
    sensorName: sensorName,
    sensorUnit: sensorUnit,
    pickIdx: pickIdx,
    toRows: toRows,
    mockPlan: mockPlan,
    mockLines: mockLines,
    miniSVG: miniSVG,
    humanError: humanError,
    LineBuf: LineBuf,
    _esc: esc
  };
});
