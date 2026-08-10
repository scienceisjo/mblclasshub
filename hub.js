// =====================================================================
//  hub.js — MBL 수업허브 Supabase 데이터 레이어  (전역 window.Hub)
//  제작: 해누리중학교 조승재(과학이조선생)
//  ★ RPC 이름은 schema.sql 의 mbl_ 접두사 함수와 1:1 로 맞춰져 있습니다 ★
//
//  ▶ 불러오기 (모든 HTML <head> 에서 · config.js 가 hub.js 보다 먼저여야 합니다)
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="lab-data.js"></script>
//     <script src="config.js"></script>
//     <script src="hub.js"></script>
//
//  ▶ 접속 정보는 config.js 의 window.MBL_CONFIG 한 곳에만 있습니다(hub.js 에 하드코딩 없음).
//     Hub.isConfigured()  → 주소·키가 채워져 있으면 true
//     await Hub.diagnose() → {configured, reachable, schemaOk, message} 로 무엇이 문제인지 알려 줍니다.
//
//  ▶ 교사 (teacher.html)
//     const r = await Hub.createLesson({
//       title:'물과 식용유의 비열 비교', expId:'sm-01', expTitle:'물과 식용유의 비열 비교',
//       classLabel:'1학년 3반', teacherName:'조승재',
//       form:{questions:[...]}, dataSpec:{...}, groupCount:7
//     });
//     r.joinCode  // 'ABC234'  ← 칠판에 적어 주는 6자리
//     r.adminCode // 10자리. 이 브라우저 localStorage(mbl_admin_codes)에 자동 보관됩니다.
//
//     const board = await Hub.adminLoad(r.adminCode);
//     await Hub.adminSet(r.adminCode, { phase:'share' });
//
//     const pins = await Hub.adminPins(r.adminCode);   // [{group_id, group_no, group_name, pin}]
//     await Hub.adminResetPin(r.adminCode, groupId);   // 그 모둠 PIN 다시 발급
//     await Hub.adminExtend(r.adminCode, 30);          // 보관 기한 30일 연장
//     await Hub.adminDelete(r.adminCode);              // 수업 즉시 삭제(되돌릴 수 없음)
//
//  ▶ 모둠 비밀번호(PIN) — 같은 반 학생이 남의 모둠 자료를 덮어쓰지 못하게 막는 장치
//     쓰기 4개(joinGroup/saveData/saveReport/sendFeedback)는 PIN 이 있어야 합니다.
//     읽기(getLesson/getBoard/sig)는 참여코드만으로 됩니다.
//     한 번 통과한 PIN 은 이 기기에 보관되어 다시 묻지 않습니다.
//       Hub.rememberPin(joinCode, groupId, '0417') / Hub.getPin(joinCode, groupId) / Hub.forgetPin(...)
//     PIN 을 넘기지 않으면 보관된 값을 자동으로 씁니다.
//     PIN 이 틀리면 던지는 Error 에 err.pinError === true 가 붙고, 보관된 PIN 은 지워집니다.
//     보관 기한이 지난 수업이면 err.expired === true (오프라인 판별의 err.offline 과 같은 결).
//
//  ▶ 학생 (index.html)
//     const lesson = await Hub.getLesson('ABC234');
//     const group  = await Hub.joinGroup('ABC234', 3, '3모둠', ['김하나','이두리'], '0417');
//     await Hub.saveData('ABC234', group.id, [[0,20.1,20.0],[30,23.4,27.8]], '핫플레이트 3단');
//     await Hub.saveReport('ABC234', group.id, {q1:'가열 시간'}, 'done');
//     await Hub.sendFeedback('ABC234', group.id, otherGroupId, 5, '설명이 좋았어요');
//
//  ▶ 변경 감지 (present.html / teacher.html / index.html)
//     const stop = Hub.watch('ABC234', (board, info) => render(board));
//     // 나갈 때  stop();
//
//     Supabase 실시간(Realtime) 구독은 쓰지 않습니다. 실시간을 쓰려면 표를 누구나
//     읽을 수 있게 열어야 하는데, 그러면 학생 이름이 그대로 공개되기 때문입니다.
//     대신 아주 작은 신호(mbl_sig · 150바이트 안팎)만 주기적으로 확인하고,
//     정말 바뀐 것이 있을 때만 무거운 보드(mbl_get_board)를 다시 받습니다.
//     단계별 확인 간격: 수집 15초 / 공유 8초 / 발표 3초 / 마무리 15초
//     (발표 슬라이드 넘김은 보드를 다시 받지 않고 신호만으로 따라갑니다.)
//     Hub.setWatchPace('ABC234', 5000) 으로 간격을 직접 정할 수 있습니다.
//
//  ▶ 오프라인
//     인터넷이 끊겨도 saveData/saveReport 는 localStorage 에 저장되고 {offline:true} 를
//     돌려줍니다. 화면 위에 "임시 저장 중" 배너를 띄우세요.
//     연결이 돌아오면  await Hub.flushOffline('ABC234')  로 한 번에 다시 보냅니다.
//     Hub.onStatus(on => banner.hidden = !on.offline)  로 상태 변화를 받을 수 있습니다.
// =====================================================================

window.Hub = (function () {
  'use strict';

  // ── 접속 정보 ────────────────────────────────────────────────────
  //  ★ 여기에는 주소·키를 적지 않습니다. 오직 config.js(window.MBL_CONFIG)에서만 읽습니다.
  //    학교마다 config.js 두 줄만 바꿔서 배포하기 위해서입니다.
  function conf() {
    return (typeof window !== 'undefined' && window.MBL_CONFIG) ? window.MBL_CONFIG : {};
  }
  function confUrl() { return String(conf().SUPABASE_URL || '').trim().replace(/\/+$/, ''); }
  function confKey() { return String(conf().SUPABASE_ANON_KEY || '').trim(); }

  //  Hub.isConfigured() → config.js 에 쓸 만한 값이 들어 있으면 true
  function isConfigured() {
    var u = confUrl(), k = confKey();
    if (!u || !k) return false;
    if (!/^https?:\/\//i.test(u)) return false;
    if (/여기에|붙여넣|YOUR[-_ ]?|<.*>/i.test(u + ' ' + k)) return false;   // 예시값 그대로면 미설정으로 봅니다
    return k.length > 30;
  }
  function schoolName() { return String(conf().SCHOOL  || '').trim(); }
  function teacherName(){ return String(conf().TEACHER || '').trim(); }

  var LS = 'mbl_';                       // localStorage 접두사
  var ADMIN_KEY   = 'mbl_admin_codes';   // 교사 관리코드 보관함
  var LEGACY_AUTH = 'mblhub_auth';       // 예전 hub_* 로그인 정보

  // 단계별 신호(sig) 확인 간격 — 실시간 구독 대신 쓰는 값입니다.
  var PACE = {
    collect: 15000,   // 수집: 남의 모둠 자료는 필요 없고 단계 전환만 보면 됩니다
    share  :  8000,   // 공유
    present:  3000,   // 발표: 슬라이드를 따라가야 하므로 촘촘히
    done   : 15000    // 마무리
  };
  // 교사 대시보드(관리코드로 연 화면)는 수집 단계에서도 모둠 현황을 봐야 합니다.
  var PACE_ADMIN = {
    collect: 5000, share: 8000, present: 3000, done: 15000
  };

  // ── Supabase 클라이언트 (config.js 가 늦게 와도 되도록 필요할 때 만듭니다) ──
  var sb = null;
  function client() {
    if (sb) return sb;
    if (!isConfigured()) return null;
    try {
      if (typeof supabase !== 'undefined' && supabase.createClient) {
        sb = supabase.createClient(confUrl(), confKey());
      }
    } catch (e) { sb = null; }
    return sb;
  }
  client();   // 지금 만들 수 있으면 미리 만들어 둡니다

  // ── 상태 ─────────────────────────────────────────────────────────
  var state    = { lesson: null, group: null, board: null };
  var offline  = !sb;
  var listeners = [];

  function notify() {
    var s = { offline: offline, ready: !!sb, configured: isConfigured() };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](s); } catch (e) {}
    }
  }
  function onStatus(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    try { cb({ offline: offline, ready: !!client(), configured: isConfigured() }); } catch (e) {}
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
  function setOffline(v) {
    v = !!v;
    if (offline === v) return;
    offline = v;
    notify();
  }
  function isOffline() { return offline; }

  // ── localStorage 도우미 ──────────────────────────────────────────
  function saveLocal(key, val) {
    try { localStorage.setItem(LS + key, JSON.stringify({ v: val, t: Date.now() })); return true; }
    catch (e) { return false; }
  }
  function loadLocal(key, fallback) {
    try {
      var raw = localStorage.getItem(LS + key);
      if (raw === null) return (fallback === undefined ? null : fallback);
      var o = JSON.parse(raw);
      return (o && Object.prototype.hasOwnProperty.call(o, 'v')) ? o.v : o;
    } catch (e) { return (fallback === undefined ? null : fallback); }
  }
  function dropLocal(key) {
    try { localStorage.removeItem(LS + key); } catch (e) {}
  }

  // ── 작은 도구들 ──────────────────────────────────────────────────
  function norm(code) { return String(code == null ? '' : code).trim().toUpperCase(); }

  // ── 모둠 비밀번호(PIN) 보관함 ────────────────────────────────────
  //  한 번 통과한 PIN 은 이 기기에 남겨 두어 같은 모둠이 다시 묻지 않게 합니다.
  //  키는 수업(참여코드)·모둠 단위로 따로 둡니다:  mbl_pin_ABC234_<모둠id>
  function normPin(pin) { return String(pin == null ? '' : pin).replace(/\s+/g, ''); }
  function pinKey(joinCode, groupRef) { return 'pin_' + norm(joinCode) + '_' + String(groupRef == null ? '' : groupRef); }

  //  Hub.rememberPin(joinCode, groupId, pin)
  function rememberPin(joinCode, groupId, pin) {
    var p = normPin(pin);
    if (!p || groupId == null || groupId === '') return '';
    saveLocal(pinKey(joinCode, groupId), p);
    return p;
  }
  //  Hub.getPin(joinCode, groupId) → '0417' 또는 '' (없으면 빈 문자열)
  function getPin(joinCode, groupId) {
    if (groupId == null || groupId === '') return '';
    return normPin(loadLocal(pinKey(joinCode, groupId), ''));
  }
  //  Hub.forgetPin(joinCode, groupId) — groupId 를 비우면 그 수업의 PIN 을 모두 잊습니다.
  function forgetPin(joinCode, groupId) {
    if (groupId != null && groupId !== '') { dropLocal(pinKey(joinCode, groupId)); return; }
    var head = LS + pinKey(joinCode, '');
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(head) === 0) kill.push(k);
      }
      for (var j = 0; j < kill.length; j++) localStorage.removeItem(kill[j]);
    } catch (e) {}
  }
  // 모둠 번호로도 찾을 수 있게 해 둡니다(입장 전에는 모둠 id 를 모르기 때문입니다).
  function noRef(groupNo) { return 'no' + Number(groupNo); }

  // 문자열 → 32비트 해시(지문용). 내용이 바뀌면 값이 바뀝니다.
  function hash32(s) {
    s = String(s == null ? '' : s);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function looksOffline(err) {
    if (err && (err.offline || (err.raw && err.raw.offline))) return true;
    var m = String((err && (err.message || err.msg)) || err || '').toLowerCase();
    return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch error|aborted|err_internet|offline/.test(m)
        || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  function humanize(err) {
    var m = String((err && err.message) || err || '알 수 없는 오류');
    if (looksOffline(err)) return '인터넷 연결이 불안정합니다.';
    // Postgres 예외 메시지는 한국어로 이미 잘 오므로 그대로 씁니다.
    return m.replace(/^.*?:\s*/, '').trim() || m;
  }

  // 호출부가 "코드로" 갈라 볼 수 있게 표식을 답니다(오프라인 판별의 err.offline 과 같은 결).
  //   err.pinError → 모둠 비밀번호가 틀림      err.expired → 수업 보관 기간이 지남
  function markErr(e, raw) {
    var m = String((e && e.message) || '') + ' '
          + String((raw && (raw.message || raw.details || raw.hint)) || '');
    if (/모둠 비밀번호/.test(m)) e.pinError = true;
    if (/보관 기간이 지났/.test(m)) e.expired = true;
    // 여러 번 틀려 잠긴 경우. 보관된 PIN 은 맞을 수도 있으므로 지우지 않습니다(pinError 아님).
    if (/여러 번 틀렸/.test(m)) e.pinLocked = true;
    return e;
  }
  function isPinError(err) {
    if (!err) return false;
    if (err.pinError) return true;
    return /모둠 비밀번호/.test(String(err.message || ''));
  }

  // 모든 RPC 는 이 문을 통과합니다.
  function rpc(name, args) {
    var c = client();
    if (!c) {
      setOffline(true);
      var e0 = new Error(isConfigured()
        ? '인터넷 연결이 불안정합니다.'
        : 'Supabase 연결 정보를 넣어 주세요. (config.js)');
      e0.offline = true;              // ← 한국어 문구라 정규식에 안 걸리므로 표식을 달아 둡니다
      e0.notConfigured = !isConfigured();
      return Promise.reject(e0);
    }
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) {
        var off1 = looksOffline(res.error);
        if (off1) setOffline(true);
        var e = new Error(humanize(res.error));
        e.raw = res.error;
        e.offline = off1;
        throw markErr(e, res.error);
      }
      setOffline(false);
      // 쓰기 RPC 는 PIN 이 틀렸을 때 예외 대신 {"mbl_error":"..."} 를 돌려줍니다.
      //   (예외를 던지면 서버가 방금 센 "틀린 횟수"까지 되돌려져 잠금이 걸리지 않습니다.)
      //   여기서 오류로 바꿔 주므로 호출부는 예전과 똑같이 catch 로 받으면 됩니다.
      var d = res.data;
      if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.mbl_error === 'string') {
        var e1 = new Error(d.mbl_error);
        e1.raw = { message: d.mbl_error };
        throw markErr(e1, e1.raw);
      }
      return d;
    }, function (err) {
      var off2 = looksOffline(err);
      if (off2) setOffline(true);
      var e = new Error(humanize(err));
      e.raw = err;
      e.offline = off2;
      throw markErr(e, err);
    });
  }

  // 실패해도 화면이 죽지 않게 감싸 주는 헬퍼
  //   var board = await Hub.safe(() => Hub.getBoard(code), {groups:[],data:[]});
  function safe(fn, fallback) {
    return Promise.resolve().then(fn).catch(function (err) {
      try { console.warn('[Hub]', err && err.message ? err.message : err); } catch (e) {}
      return (typeof fallback === 'function') ? fallback(err) : fallback;
    });
  }

  //  Hub.diagnose() → {configured, reachable, schemaOk, message}
  //  화면에 "왜 안 되는지"를 한국어로 알려 주기 위한 자가진단.
  function diagnose() {
    var out = { configured: isConfigured(), reachable: false, schemaOk: false, message: '' };

    if (!out.configured) {
      out.message = 'Supabase 연결 정보가 없습니다. config.js 를 열어 SUPABASE_URL 과 '
                  + 'SUPABASE_ANON_KEY 를 넣어 주세요. (Supabase 대시보드 → Settings → API)';
      return Promise.resolve(out);
    }
    if (!client()) {
      out.message = 'supabase-js 라이브러리를 불러오지 못했습니다. 페이지 <head> 의 '
                  + 'supabase-js 스크립트 줄을 확인하고 새로고침해 주세요.';
      return Promise.resolve(out);
    }

    // 없는 코드로 mbl_sig 를 불러 봅니다.
    //  · "수업 코드를 찾을 수 없습니다" → 서버도 스키마도 정상
    //  · 함수가 없다는 오류        → schema.sql 미실행
    return rpc('mbl_sig', { p_join_code: '______' }).then(function () {
      out.reachable = true; out.schemaOk = true;
      out.message = '정상입니다.';
      return out;
    }, function (err) {
      var raw  = (err && err.raw) || {};
      var code = String(raw.code || '');
      var msg  = String(raw.message || (err && err.message) || '');

      if ((err && err.offline) || looksOffline(err)) {
        out.message = 'Supabase 에 연결하지 못했습니다. 인터넷 연결과 config.js 의 '
                    + 'SUPABASE_URL 주소가 맞는지 확인해 주세요.';
        return out;
      }
      out.reachable = true;

      if (code === 'PGRST202' || code === '42883'
          || /does not exist|could not find the function|schema cache/i.test(msg)) {
        out.schemaOk = false;
        out.message = 'schema.sql 을 아직 실행하지 않았습니다. Supabase 대시보드 → SQL Editor → '
                    + 'New query 에 이 폴더의 schema.sql 전체를 붙여넣고 Run 해 주세요. '
                    + '(여러 번 실행해도 안전합니다.)';
        return out;
      }
      if (code === '401' || code === 'PGRST301' || /jwt|api key|invalid.*key|unauthorized/i.test(msg)) {
        out.message = 'anon key 가 맞지 않습니다. config.js 의 SUPABASE_ANON_KEY 를 '
                    + 'Settings → API → anon / public 값으로 다시 넣어 주세요.';
        return out;
      }
      if (code === '42501' || /permission denied/i.test(msg)) {
        out.schemaOk = false;
        out.message = 'RPC 실행 권한이 없습니다. schema.sql 을 처음부터 끝까지 한 번 더 Run 해 주세요.';
        return out;
      }

      // 여기까지 왔으면 함수는 살아 있고, 그냥 "없는 참여코드"라고 답한 것입니다.
      out.schemaOk = true;
      out.message  = '정상입니다.';
      return out;
    });
  }

  // =================================================================
  //  교사
  // =================================================================

  // 교사 브라우저에 관리코드 보관
  function rememberAdmin(code, lesson) {
    var list;
    try { list = JSON.parse(localStorage.getItem(ADMIN_KEY)) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    var joinCode = lesson && lesson.join_code ? lesson.join_code : '';
    list = list.filter(function (x) { return x && x.adminCode !== code; });
    list.unshift({
      adminCode : code,
      joinCode  : joinCode,
      title     : lesson && lesson.title ? lesson.title : '',
      classLabel: lesson && lesson.class_label ? lesson.class_label : '',
      expId     : lesson && lesson.exp_id ? lesson.exp_id : '',
      createdAt : (lesson && lesson.created_at) || new Date().toISOString()
    });
    if (list.length > 60) list = list.slice(0, 60);
    try { localStorage.setItem(ADMIN_KEY, JSON.stringify(list)); } catch (e) {}
    return list;
  }
  function myAdminCodes() {
    try {
      var list = JSON.parse(localStorage.getItem(ADMIN_KEY));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function forgetAdmin(code) {
    var list = myAdminCodes().filter(function (x) { return x && x.adminCode !== code; });
    try { localStorage.setItem(ADMIN_KEY, JSON.stringify(list)); } catch (e) {}
    return list;
  }

  //  Hub.createLesson({title, expId, expTitle, classLabel, teacherName, form, dataSpec, groupCount})
  //  → {joinCode, adminCode, lesson}
  function createLesson(opt) {
    opt = opt || {};
    return rpc('mbl_create_lesson', {
      p_title       : String(opt.title || '이름 없는 수업'),
      p_exp_id      : opt.expId    || null,
      p_exp_title   : opt.expTitle || null,
      p_class_label : opt.classLabel  || null,
      p_teacher_name: opt.teacherName || null,
      p_form        : opt.form     || {},
      p_data_spec   : opt.dataSpec || {},
      p_group_count : Number(opt.groupCount || 7)
    }).then(function (d) {
      // pins: [{group_id, group_no, group_name, pin}] — 만든 직후 칠판에 띄울 모둠별 비밀번호
      var out = {
        joinCode: d.join_code, adminCode: d.admin_code, lesson: d.lesson,
        pins: Array.isArray(d.pins) ? d.pins : []
      };
      state.lesson = d.lesson;
      rememberAdmin(out.adminCode, d.lesson);
      saveLocal('lesson_' + out.joinCode, d.lesson);
      return out;
    });
  }

  //  Hub.adminLoad(adminCode) → {lesson, groups, data, reports, feedback}
  function adminLoad(adminCode) {
    return rpc('mbl_admin_load', { p_admin_code: norm(adminCode) }).then(function (b) {
      var board = shapeBoard(b);
      state.lesson = board.lesson;
      state.board  = board;
      if (board.lesson) {
        rememberAdmin(norm(adminCode), board.lesson);
        saveLocal('board_' + board.lesson.join_code, board);
      }
      return board;
    });
  }

  //  Hub.adminSet(adminCode, {phase, presenterGroup, slideIdx, form, extendDays})
  //  넘기지 않은 항목은 그대로 둡니다. presenterGroup 을 비우려면 null 대신 '' 를 넘기세요.
  //  extendDays 가 양수면 보관 기한을 그만큼 미룹니다(넣지 않으면 기한은 그대로).
  var CLEAR_UUID = '00000000-0000-0000-0000-000000000000';
  function adminSet(adminCode, patch) {
    patch = patch || {};
    var pg = null;
    if (Object.prototype.hasOwnProperty.call(patch, 'presenterGroup')) {
      pg = patch.presenterGroup ? String(patch.presenterGroup) : CLEAR_UUID;
    }
    return rpc('mbl_admin_set', {
      p_admin_code     : norm(adminCode),
      p_phase          : patch.phase != null ? String(patch.phase) : null,
      p_presenter_group: pg,
      p_slide_idx      : (patch.slideIdx == null ? null : Number(patch.slideIdx)),
      p_form           : (patch.form == null ? null : patch.form),
      p_extend_days    : (patch.extendDays == null ? null : Number(patch.extendDays))
    }).then(function (l) {
      state.lesson = l;
      if (l && l.join_code) saveLocal('lesson_' + l.join_code, l);
      return l;
    });
  }

  //  Hub.adminPins(adminCode) → [{group_id, group_no, group_name, pin}]
  //  교사만 볼 수 있습니다(학생용 보드에는 PIN 이 들어 있지 않습니다).
  function adminPins(adminCode) {
    return rpc('mbl_admin_pins', { p_admin_code: norm(adminCode) }).then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    });
  }

  //  Hub.adminResetPin(adminCode, groupId) → {group_id, group_no, pin}
  //  PIN 이 새로 바뀌므로 그 모둠은 기기에 저장된 옛 PIN 으로는 들어오지 못합니다.
  function adminResetPin(adminCode, groupId) {
    return rpc('mbl_admin_reset_pin', {
      p_admin_code: norm(adminCode),
      p_group_id  : groupId
    });
  }

  //  Hub.adminExtend(adminCode, days) → lesson (보관 기한 연장. 기본 30일)
  function adminExtend(adminCode, days) {
    var n = Number(days);
    if (!(n > 0)) n = 30;
    return adminSet(adminCode, { extendDays: n });
  }

  //  Hub.adminDelete(adminCode) → {deleted_lessons, deleted_groups, ...}
  //  ★ 되돌릴 수 없습니다. 화면에서 반드시 한 번 더 확인을 받은 뒤에 부르세요.
  function adminDelete(adminCode) {
    var code = norm(adminCode);
    return rpc('mbl_admin_delete', { p_admin_code: code }).then(function (r) {
      // 지워진 수업의 흔적을 이 브라우저에서도 정리합니다.
      try {
        var join = state.lesson && state.lesson.join_code ? state.lesson.join_code : '';
        if (!join) {
          var mine = myAdminCodes().filter(function (x) { return x && x.adminCode === code; })[0];
          join = mine && mine.joinCode ? mine.joinCode : '';
        }
        if (join) {
          dropLocal('lesson_' + norm(join));
          dropLocal('board_'  + norm(join));
          dropLocal(queueKey(join));
          forgetPin(join);
        }
      } catch (e) {}
      forgetAdmin(code);
      state.lesson = null; state.board = null;
      return r;
    });
  }

  //  Hub.adminListLessons(adminCode) → 최근 수업 목록
  //  서버 목록과 이 브라우저에 보관된 관리코드를 합쳐 돌려줍니다.
  function adminListLessons(adminCode) {
    var local = myAdminCodes();
    return rpc('mbl_admin_list', { p_admin_code: norm(adminCode) }).then(function (rows) {
      var list = Array.isArray(rows) ? rows : [];
      var byJoin = {};
      local.forEach(function (x) { if (x && x.joinCode) byJoin[x.joinCode] = x.adminCode; });
      return list.map(function (r) {
        if (!r.admin_code && byJoin[r.join_code]) r.admin_code = byJoin[r.join_code];
        return r;
      });
    }, function () {
      // 서버가 안 되면 이 브라우저에 남아 있는 목록이라도 보여 줍니다.
      return local.map(function (x) {
        return {
          join_code: x.joinCode, title: x.title, class_label: x.classLabel,
          exp_id: x.expId, created_at: x.createdAt, admin_code: x.adminCode, local: true
        };
      });
    });
  }

  // =================================================================
  //  학생 (모둠)
  // =================================================================

  //  Hub.getLesson(joinCode) → lesson (adminCode 없음)
  function getLesson(joinCode) {
    var code = norm(joinCode);
    return rpc('mbl_get_lesson', { p_join_code: code }).then(function (l) {
      state.lesson = l;
      saveLocal('lesson_' + code, l);
      return l;
    }, function (err) {
      var cached = loadLocal('lesson_' + code, null);
      if (cached && looksOffline(err.raw || err)) { state.lesson = cached; return cached; }
      throw err;
    });
  }

  //  Hub.joinGroup(joinCode, groupNo, groupName, members, pin) → group
  //  pin 을 넘기지 않으면 이 기기에 보관된 그 모둠 PIN 을 씁니다.
  //  틀리면 err.pinError === true 로 던지고 보관된 PIN 은 지웁니다.
  function joinGroup(joinCode, groupNo, groupName, members, pin) {
    var code = norm(joinCode);
    var no   = Number(groupNo);
    var p    = normPin(pin) || getPin(code, noRef(no));
    return rpc('mbl_join_group', {
      p_join_code : code,
      p_group_no  : no,
      p_group_name: groupName != null ? String(groupName) : null,
      p_members   : Array.isArray(members) ? members.map(String) : null,
      p_pin       : p
    }).then(function (g) {
      state.group = g;
      saveLocal('group_' + code, g);
      // 통과한 PIN 은 모둠 id 로도, 모둠 번호로도 찾을 수 있게 남겨 둡니다.
      if (p) {
        if (g && g.id) rememberPin(code, g.id, p);
        rememberPin(code, noRef(g && g.group_no != null ? g.group_no : no), p);
      }
      return g;
    }, function (err) {
      if (isPinError(err)) {
        forgetPin(code, noRef(no));
        var old = loadLocal('group_' + code, null);
        if (old && old.id && Number(old.group_no) === no) forgetPin(code, old.id);
        throw err;
      }
      var cached = loadLocal('group_' + code, null);
      if (cached && Number(cached.group_no) === no && looksOffline(err.raw || err)) {
        state.group = cached;
        return cached;
      }
      throw err;
    });
  }

  // ── 오프라인 대기열 ──────────────────────────────────────────────
  function queueKey(code) { return 'queue_' + norm(code); }
  function pushQueue(code, item) {
    var q = loadLocal(queueKey(code), []) || [];
    // 같은 종류·같은 모둠의 대기 항목은 마지막 것만 남깁니다.
    q = q.filter(function (x) { return !(x.kind === item.kind && x.groupId === item.groupId); });
    q.push(item);
    saveLocal(queueKey(code), q);
    return q.length;
  }

  // 쓰기에 쓸 PIN 을 정합니다: 넘겨받은 값 → 이 기기에 보관된 값
  function pinFor(code, groupId, pin) {
    return normPin(pin) || getPin(code, groupId);
  }

  //  Hub.saveData(joinCode, groupId, rows, note, pin)
  //  성공하면 localStorage 에도 백업, 실패하면 localStorage 에만 저장하고 {offline:true}
  function saveData(joinCode, groupId, rows, note, pin) {
    var code = norm(joinCode);
    var p = pinFor(code, groupId, pin);
    var payload = { rows: rows || [], note: note == null ? '' : String(note) };
    saveLocal('data_' + code + '_' + groupId, payload);
    return rpc('mbl_save_data', {
      p_join_code: code, p_group_id: groupId,
      p_rows: payload.rows, p_note: payload.note, p_pin: p
    }).then(function (row) {
      rememberPin(code, groupId, p);
      return row;
    }, function (err) {
      if (isPinError(err)) { forgetPin(code, groupId); throw err; }
      if (!looksOffline(err.raw || err)) throw err;
      pushQueue(code, { kind: 'data', groupId: groupId, rows: payload.rows, note: payload.note, pin: p, at: Date.now() });
      setOffline(true);
      return { offline: true, group_id: groupId, rows: payload.rows, note: payload.note };
    });
  }

  //  Hub.saveReport(joinCode, groupId, answers, status, pin)  status: 'draft' | 'done'
  function saveReport(joinCode, groupId, answers, status, pin) {
    var code = norm(joinCode);
    var p = pinFor(code, groupId, pin);
    var st = (status === 'done') ? 'done' : 'draft';
    var payload = { answers: answers || {}, status: st };
    saveLocal('report_' + code + '_' + groupId, payload);
    return rpc('mbl_save_report', {
      p_join_code: code, p_group_id: groupId,
      p_answers: payload.answers, p_status: st, p_pin: p
    }).then(function (row) {
      rememberPin(code, groupId, p);
      return row;
    }, function (err) {
      if (isPinError(err)) { forgetPin(code, groupId); throw err; }
      if (!looksOffline(err.raw || err)) throw err;
      pushQueue(code, { kind: 'report', groupId: groupId, answers: payload.answers, status: st, pin: p, at: Date.now() });
      setOffline(true);
      return { offline: true, group_id: groupId, answers: payload.answers, status: st };
    });
  }

  //  Hub.sendFeedback(joinCode, fromGroup, toGroup, stars, comment, pin)
  //  pin 은 "보내는 모둠(fromGroup)" 의 비밀번호입니다.
  function sendFeedback(joinCode, fromGroup, toGroup, stars, comment, pin) {
    var code = norm(joinCode);
    var p = pinFor(code, fromGroup, pin);
    return rpc('mbl_send_feedback', {
      p_join_code : code,
      p_from_group: fromGroup,
      p_to_group  : toGroup,
      p_stars     : Math.max(1, Math.min(5, Number(stars) || 3)),
      p_comment   : comment == null ? '' : String(comment),
      p_pin       : p
    }).then(function (row) {
      rememberPin(code, fromGroup, p);
      // 내가 보낸 별점은 서버를 다시 읽지 않고 보드에 바로 반영합니다.
      // (학생 화면은 남의 피드백 때문에 보드를 다시 받지 않기 때문입니다)
      try {
        if (row && row.id && state.board && Array.isArray(state.board.feedback)) {
          state.board.feedback = state.board.feedback.filter(function (x) {
            return !(x && String(x.from_group) === String(row.from_group)
                       && String(x.to_group) === String(row.to_group));
          }).concat([row]);
        }
      } catch (e) {}
      return row;
    }, function (err) {
      if (isPinError(err)) { forgetPin(code, fromGroup); throw err; }
      if (!looksOffline(err.raw || err)) throw err;
      pushQueue(code, {
        kind: 'feedback', groupId: String(fromGroup) + '>' + String(toGroup),
        fromGroup: fromGroup, toGroup: toGroup,
        stars: Number(stars) || 3, comment: comment || '', pin: p, at: Date.now()
      });
      setOffline(true);
      return { offline: true };
    });
  }

  //  Hub.flushOffline(joinCode) → {sent, left}
  function flushOffline(joinCode) {
    var code = norm(joinCode);
    var q = loadLocal(queueKey(code), []) || [];
    if (!q.length) return Promise.resolve({ sent: 0, left: 0 });

    var left = [], sent = 0;
    var chain = Promise.resolve();
    q.forEach(function (item) {
      chain = chain.then(function () {
        var p;
        // 대기열에 넣을 때 함께 저장해 둔 PIN 을 씁니다(없으면 이 기기에 보관된 값).
        if (item.kind === 'data') {
          p = rpc('mbl_save_data', {
            p_join_code: code, p_group_id: item.groupId, p_rows: item.rows, p_note: item.note,
            p_pin: pinFor(code, item.groupId, item.pin)
          });
        } else if (item.kind === 'report') {
          p = rpc('mbl_save_report', {
            p_join_code: code, p_group_id: item.groupId, p_answers: item.answers, p_status: item.status,
            p_pin: pinFor(code, item.groupId, item.pin)
          });
        } else if (item.kind === 'feedback') {
          p = rpc('mbl_send_feedback', {
            p_join_code: code, p_from_group: item.fromGroup, p_to_group: item.toGroup,
            p_stars: item.stars, p_comment: item.comment,
            p_pin: pinFor(code, item.fromGroup, item.pin)
          });
        } else {
          return;
        }
        return p.then(function () { sent++; }, function (err) {
          if (looksOffline(err.raw || err)) { left.push(item); return; }   // 다음 기회에 다시
          // PIN 이 바뀌었으면 보관된 값을 지웁니다. 자료는 localStorage 백업에 그대로 있으니
          // 학생이 새 PIN 으로 다시 저장하면 됩니다(무한 재시도는 하지 않습니다).
          if (isPinError(err)) forgetPin(code, item.kind === 'feedback' ? item.fromGroup : item.groupId);
          // 코드가 틀린 것 같은 오류는 버립니다(무한 재시도 방지).
        });
      });
    });

    return chain.then(function () {
      if (left.length) saveLocal(queueKey(code), left);
      else dropLocal(queueKey(code));
      if (!left.length) setOffline(false);
      return { sent: sent, left: left.length };
    });
  }

  function pendingCount(joinCode) {
    var q = loadLocal(queueKey(joinCode), []) || [];
    return q.length;
  }

  // =================================================================
  //  공유 보드 · 실시간
  // =================================================================

  function shapeBoard(b) {
    b = b || {};
    return {
      lesson  : b.lesson || null,
      groups  : Array.isArray(b.groups)   ? b.groups   : [],
      data    : Array.isArray(b.data)     ? b.data     : [],
      reports : Array.isArray(b.reports)  ? b.reports  : [],
      feedback: Array.isArray(b.feedback) ? b.feedback : []
    };
  }

  //  Hub.getBoard(joinCode) → {lesson, groups, data, reports, feedback}
  function getBoard(joinCode) {
    var code = norm(joinCode);
    return rpc('mbl_get_board', { p_join_code: code }).then(function (b) {
      var board = shapeBoard(b);
      state.board  = board;
      state.lesson = board.lesson || state.lesson;
      saveLocal('board_' + code, board);
      return board;
    }, function (err) {
      var cached = loadLocal('board_' + code, null);
      if (cached && looksOffline(err.raw || err)) { state.board = shapeBoard(cached); return state.board; }
      throw err;
    });
  }

  // 화면을 괜히 다시 그리지 않도록 쓰는 가벼운 지문
  function sign(b) {
    if (!b) return '';
    var l = b.lesson || {};
    var fs = '';
    try { fs = JSON.stringify(l.form || {}); } catch (e) { fs = ''; }
    var fsig = fs.length + ':' + hash32(fs);
    var s = [l.phase, l.slide_idx, l.presenter_group, fsig, b.groups.length,
             b.data.length, b.reports.length, b.feedback.length].join('|');
    for (var i = 0; i < b.data.length; i++)    s += '|d' + b.data[i].group_id + b.data[i].updated_at;
    for (var j = 0; j < b.reports.length; j++) s += '|r' + b.reports[j].group_id + b.reports[j].status + b.reports[j].updated_at;
    for (var k = 0; k < b.groups.length; k++)  s += '|g' + b.groups[k].group_no + (b.groups[k].group_name || '') + (b.groups[k].members || []).join(',');
    for (var m = 0; m < b.feedback.length; m++) s += '|f' + b.feedback[m].id + b.feedback[m].stars + (b.feedback[m].comment || '');
    return s;
  }

  //  Hub.sig(joinCode) → {phase, presenter_group, slide_idx, form_at, data_ver, rep_ver, fb_ver, grp_ver}
  //  150바이트 안팎의 아주 작은 변경감지 신호입니다. 보드(24KB)보다 훨씬 가볍습니다.
  function sig(joinCode) {
    return rpc('mbl_sig', { p_join_code: norm(joinCode) });
  }

  // 어느 화면에서 보고 있는지 — 화면마다 필요한 자료가 다릅니다.
  //   admin(교사 대시보드) · board(전자칠판) : 다른 모둠의 피드백까지 모두 봐야 합니다.
  //   student(학생 화면)                     : 남의 피드백은 화면에 쓰지 않습니다.
  function pageRole() {
    var p = '';
    try { p = String((window.location && window.location.pathname) || '').toLowerCase(); } catch (e) { p = ''; }
    if (p.indexOf('teacher') >= 0) return 'admin';
    if (p.indexOf('present') >= 0) return 'board';
    return 'student';
  }

  // 열려 있는 watcher 목록 (Hub.setWatchPace 가 여기서 대상을 찾습니다)
  var WATCHERS = [];

  //  Hub.watch(joinCode, cb [, opts]) → unwatch()
  //  작은 신호(mbl_sig)만 주기적으로 확인하고, 정말 바뀐 것이 있을 때만 보드를 다시 받습니다.
  //  cb(board, {mode:'poll', offline, sig}) — 언제나 완전한 board 를 넘깁니다.
  //  opts.role 로 화면 종류를 직접 정할 수 있습니다('admin' | 'board' | 'student').
  function watch(joinCode, cb, opts) {
    var code    = norm(joinCode);
    opts        = opts || {};
    var role    = String(opts.role || pageRole());
    var wide    = (role === 'admin' || role === 'board');   // 남의 피드백까지 보는 화면인가
    var stopped = false;
    var timer   = null;
    var busy    = false;
    var last    = null;      // 마지막으로 그린 보드의 지문
    var lastSig = null;      // 마지막으로 받은 신호
    var board   = null;      // 마지막으로 받은 보드
    var forced  = 0;         // setWatchPace 로 정한 간격(0이면 단계별 기본값)
    var curPace = 0;
    var pending = false;     // "보드를 다시 받아야 함" 표시
    var boardAt = 0;         // 마지막으로 보드를 받은 시각
    // 학생 화면은 여러 모둠이 잇달아 저장해도 보드를 20초에 한 번만 다시 받습니다.
    // (교사 화면·전자칠판은 곧바로 받습니다)
    var FLOOR   = wide ? 0 : 20000;
    var visHandler = null, onlineHandler = null;

    function paceFor(phase) {
      if (forced > 0) return forced;
      var table = (role === 'admin') ? PACE_ADMIN : PACE;
      return table[phase] || table.collect;
    }

    function emit(b) {
      if (!b) return;
      var sg = sign(b);
      if (sg === last) return;          // 실제로 바뀐 것이 없으면 다시 그리지 않습니다
      last = sg;
      try { cb(b, { mode: 'poll', offline: offline, sig: lastSig }); }
      catch (e) { console.warn('[Hub.watch]', e); }
    }

    // 무거운 보드를 다시 받아야 하는 변화인지 판단합니다.
    function needBoard(prev, next) {
      if (!board || !prev) return true;                       // 아직 보드가 없으면 받아야 합니다
      if (prev.form_at !== next.form_at) return true;         // 보고서 양식이 바뀜
      if (prev.grp_ver !== next.grp_ver) return true;         // 모둠 입장·이름 변경
      var phase = next.phase || 'collect';
      if (prev.data_ver !== next.data_ver || prev.rep_ver !== next.rep_ver) {
        // 발표 중에는 학생 화면이 슬라이드만 따라가면 됩니다(전송량 절약).
        if (wide || phase !== 'present') return true;
      }
      // 남의 별점·칭찬은 교사 화면과 전자칠판에서만 씁니다.
      if (prev.fb_ver !== next.fb_ver && wide) return true;
      return false;
    }

    // 보드를 다시 받지 않고 신호만으로 슬라이드를 따라갑니다.
    function patchLesson(sg) {
      if (!board || !board.lesson) return false;
      var l = board.lesson, ch = false;
      if (sg.phase != null && l.phase !== sg.phase) { l.phase = sg.phase; ch = true; }
      if ((l.presenter_group || null) !== (sg.presenter_group || null)) {
        l.presenter_group = sg.presenter_group || null; ch = true;
      }
      if (Number(l.slide_idx || 0) !== Number(sg.slide_idx || 0)) {
        l.slide_idx = Number(sg.slide_idx || 0); ch = true;
      }
      return ch;
    }

    function pullBoard() {
      if (stopped || busy) return Promise.resolve(null);
      busy = true;
      boardAt = Date.now();
      return getBoard(code).then(function (b) {
        busy = false;
        if (stopped) return null;
        board = b;
        emit(b);
        return b;
      }, function () {
        busy = false;
        if (stopped) return null;
        // 서버를 못 읽어도 화면이 비지 않도록 캐시(없으면 빈 보드)라도 내보냅니다.
        if (!board) { board = shapeBoard(loadLocal('board_' + code, null)); emit(board); }
        return null;
      });
    }

    function tick() {
      if (stopped || busy) return;
      if (typeof document !== 'undefined' && document.hidden) return;   // 숨겨진 탭은 쉬게 둡니다
      sig(code).then(function (sg) {
        if (stopped || !sg) return;
        var prev = lastSig;
        lastSig = sg;
        applyPace(sg.phase);
        if (needBoard(prev, sg)) pending = true;
        if (pending && (!board || Date.now() - boardAt >= FLOOR)) {
          pending = false;
          pullBoard();
          return;
        }
        // 보드를 다시 받지 않아도 되는 동안에도 슬라이드는 바로 따라갑니다.
        if (patchLesson(sg)) emit(board);
      }, function () {
        if (stopped) return;
        // 신호도 못 받으면(오프라인·코드 오류) 화면이 비지 않게 캐시라도 한 번 내보냅니다.
        // (lastSig 는 그대로 null 이므로 연결이 돌아오면 곧바로 보드를 다시 받습니다)
        if (!board) { board = shapeBoard(loadLocal('board_' + code, null)); emit(board); }
      });
    }

    function startTimer(ms) {
      stopTimer();
      if (stopped) return;
      timer = setInterval(tick, ms);
    }
    function stopTimer() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    }
    function applyPace(phase) {
      var ms = paceFor(phase || (lastSig && lastSig.phase) || 'collect');
      if (ms === curPace && timer !== null) return;
      curPace = ms;
      startTimer(ms);
    }

    // Hub.setWatchPace 가 부르는 함수. 0·null 이면 단계별 기본값으로 돌아갑니다.
    function setPace(ms) {
      forced = Number(ms) > 0 ? Number(ms) : 0;
      curPace = 0;
      applyPace(lastSig && lastSig.phase);
    }

    applyPace('collect');   // 신호를 받기 전까지는 기본 간격으로 돌립니다
    tick();                 // 첫 신호 → (보드 없음이므로) 곧바로 보드 1회 조회

    // 탭이 다시 보이면 즉시 한 번 확인합니다.
    if (typeof document !== 'undefined') {
      visHandler = function () { if (!document.hidden && !stopped) tick(); };
      document.addEventListener('visibilitychange', visHandler);
    }
    if (typeof window !== 'undefined') {
      onlineHandler = function () {
        if (stopped) return;
        setOffline(false);
        flushOffline(code).then(function () { tick(); });
      };
      window.addEventListener('online', onlineHandler);
    }

    var entry = { code: code, setPace: setPace };
    WATCHERS.push(entry);

    return function unwatch() {
      if (stopped) return;
      stopped = true;
      stopTimer();
      var i = WATCHERS.indexOf(entry);
      if (i >= 0) WATCHERS.splice(i, 1);
      if (visHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visHandler);
      if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
    };
  }

  //  Hub.setWatchPace(joinCode, ms) → 간격을 정한 watcher 수
  //  ms 를 0·null 로 주면 단계별 기본값(PACE)으로 되돌립니다.
  function setWatchPace(joinCode, ms) {
    var code = norm(joinCode), n = 0;
    for (var i = 0; i < WATCHERS.length; i++) {
      if (WATCHERS[i].code === code) { WATCHERS[i].setPace(ms); n++; }
    }
    return n;
  }

  // =================================================================
  //  (하위호환) 예전 hub_* 활동 리포팅 — 기존 앱들이 계속 쓰고 있습니다.
  // =================================================================
  var auth = null;
  try { auth = JSON.parse(localStorage.getItem(LEGACY_AUTH)); } catch (e) {}

  function _creds() {
    if (!auth) throw new Error('로그인이 필요합니다.');
    return { p_class_code: auth.classCode, p_student_no: auth.studentNo, p_pin: auth.pin };
  }
  function login(classCode, studentNo, pin) {
    return rpc('hub_student_login', {
      p_class_code: classCode, p_student_no: Number(studentNo), p_pin: String(pin)
    }).then(function (data) {
      auth = { classCode: classCode, studentNo: Number(studentNo), pin: String(pin), profile: data };
      try { localStorage.setItem(LEGACY_AUTH, JSON.stringify(auth)); } catch (e) {}
      return data;
    }, function () {
      throw new Error('로그인 실패: 학급코드·번호·PIN을 확인하세요.');
    });
  }
  function logout()     { auth = null; try { localStorage.removeItem(LEGACY_AUTH); } catch (e) {} }
  function isLoggedIn() { return !!auth; }
  function getProfile() { return auth ? auth.profile : null; }
  function getActivities() { return rpc('hub_get_activities', _creds()); }
  function submitData(activityId, payload) {
    var a = _creds(); a.p_activity_id = activityId; a.p_payload = payload;
    return rpc('hub_submit_data', a);
  }
  function submitScore(activityId, score, maxScore, detail) {
    var a = _creds();
    a.p_activity_id = activityId; a.p_score = score;
    a.p_max_score = maxScore; a.p_detail = detail || {};
    return rpc('hub_submit_score', a);
  }

  // =================================================================
  var API = {
    // 설정·자가진단
    isConfigured: isConfigured, diagnose: diagnose, client: client,
    schoolName: schoolName, teacherName: teacherName,
    // 상태
    state: state, isOffline: isOffline, onStatus: onStatus,
    // 교사
    createLesson: createLesson, adminLoad: adminLoad, adminSet: adminSet,
    adminListLessons: adminListLessons,
    adminPins: adminPins, adminResetPin: adminResetPin,
    adminExtend: adminExtend, adminDelete: adminDelete,
    myAdminCodes: myAdminCodes, forgetAdmin: forgetAdmin,
    // 학생
    getLesson: getLesson, joinGroup: joinGroup,
    saveData: saveData, saveReport: saveReport, sendFeedback: sendFeedback,
    // 모둠 비밀번호(PIN)
    rememberPin: rememberPin, getPin: getPin, forgetPin: forgetPin,
    // 공유·변경감지
    getBoard: getBoard, sig: sig, watch: watch, setWatchPace: setWatchPace,
    // 오프라인
    flushOffline: flushOffline, pendingCount: pendingCount,
    saveLocal: saveLocal, loadLocal: loadLocal, dropLocal: dropLocal,
    // 공통
    safe: safe, norm: norm,
    // 하위호환 (예전 hub_* RPC)
    login: login, logout: logout, isLoggedIn: isLoggedIn, getProfile: getProfile,
    getActivities: getActivities, submitData: submitData, submitScore: submitScore
  };

  // Hub.sb — config.js 가 늦게 와도 되도록 쓸 때마다 클라이언트를 얻습니다.
  try {
    Object.defineProperty(API, 'sb', { get: function () { return client(); }, enumerable: true });
  } catch (e) { API.sb = client(); }

  return API;
})();
