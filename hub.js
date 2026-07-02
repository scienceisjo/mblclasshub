// =====================================================================
//  hub.js — 모든 활동 앱이 공유하는 공통 리포팅 함수
//  ★ RPC 함수명은 schema.sql 의 hub_ 접두사와 일치 ★
//  사용 전: HTML <head> 에 supabase-js CDN 을 먼저 로드하세요.
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="hub.js"></script>   (또는 이 코드를 인라인 <script> 로 붙여넣기)
// =====================================================================

const Hub = (() => {
  // ↓↓↓ Supabase 대시보드 → Settings → API 에서 복사해 채우세요 ↓↓↓
  const SUPABASE_URL      = 'https://vbvtnmnodeoocbbjauap.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidnRubW5vZGVvb2NiYmphdWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTQ0OTYsImV4cCI6MjA5NTA3MDQ5Nn0.dvuRrt3qw2Tya_QwGbcXrmGPdfDgI4xmgyH8UjU73Nc';
  // ↑↑↑ anon key 는 공개돼도 RLS 로 보호되므로 클라이언트 노출 OK ↑↑↑

  const KEY = 'mblhub_auth';   // 다른 앱과 겹치지 않도록 고유 키
  const sb  = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}

  function _creds() {
    if (!auth) throw new Error('로그인이 필요합니다.');
    return { p_class_code: auth.classCode, p_student_no: auth.studentNo, p_pin: auth.pin };
  }

  // 로그인
  async function login(classCode, studentNo, pin) {
    const { data, error } = await sb.rpc('hub_student_login', {
      p_class_code: classCode, p_student_no: Number(studentNo), p_pin: String(pin)
    });
    if (error) throw new Error('로그인 실패: 학급코드·번호·PIN을 확인하세요.');
    auth = { classCode, studentNo: Number(studentNo), pin: String(pin), profile: data };
    localStorage.setItem(KEY, JSON.stringify(auth));
    return data;
  }

  function logout()     { auth = null; localStorage.removeItem(KEY); }
  function isLoggedIn() { return !!auth; }
  function getProfile() { return auth ? auth.profile : null; }

  // 활동 목록 (단원→차시 순, 완료 여부 포함)
  async function getActivities() {
    const { data, error } = await sb.rpc('hub_get_activities', _creds());
    if (error) throw error;
    return data;
  }

  // 탐구 데이터 제출 — payload 는 자유 구조의 객체
  //   예: Hub.submitData(aid, { 염도: 3.5, 온도: 24, 측정시각: Date.now() })
  async function submitData(activityId, payload) {
    const { data, error } = await sb.rpc('hub_submit_data', {
      ..._creds(), p_activity_id: activityId, p_payload: payload
    });
    if (error) throw error;
    return data;
  }

  // 형성평가/퀴즈 점수 제출 — detail 은 문항별 정오 등
  //   예: Hub.submitScore(aid, 8, 10, { q1: true, q2: false })
  async function submitScore(activityId, score, maxScore, detail = {}) {
    const { data, error } = await sb.rpc('hub_submit_score', {
      ..._creds(), p_activity_id: activityId,
      p_score: score, p_max_score: maxScore, p_detail: detail
    });
    if (error) throw error;
    return data;
  }

  return { login, logout, isLoggedIn, getProfile, getActivities, submitData, submitScore };
})();

// ---- 앱 안에서의 사용 예 ----
// activityId 는 hub_activities 행의 uuid. 허브에서 앱을 열 때 ?aid=<uuid> 로 넘기면 편합니다.
//   const aid = new URLSearchParams(location.search).get('aid');
//   await Hub.submitScore(aid, 8, 10, { q1: true, q2: false });
