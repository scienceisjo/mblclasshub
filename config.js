// =====================================================================
//  config.js — 우리 학교 Supabase 연결 정보
//  MBL 수업허브 (mblclasshub) / 해누리중학교 조승재
//
//  ▶ 다른 학교에 배포할 때는 이 파일의 두 줄(SUPABASE_URL, SUPABASE_ANON_KEY)만
//    바꾸면 됩니다. 나머지 파일은 손대지 않아도 됩니다.
//
//  ▶ 두 값은 어디서 얻나요?
//    1) https://supabase.com 에서 무료 계정을 만들고 새 프로젝트(New project)를 만듭니다.
//    2) 왼쪽 메뉴 SQL Editor → New query 에 이 폴더의 schema.sql 전체를 붙여넣고 Run 합니다.
//       (여러 번 실행해도 안전합니다.)
//    3) 왼쪽 메뉴 Settings → API 로 갑니다.
//         · Project URL      → 아래 SUPABASE_URL 에 붙여넣기
//         · Project API keys 의 anon / public → 아래 SUPABASE_ANON_KEY 에 붙여넣기
//
//  ▶ anon key 를 이렇게 공개해도 되나요? — 네, 괜찮습니다.
//    anon key 는 "누구나 쓸 수 있는 손잡이"일 뿐이고, 실제 문은 데이터베이스 쪽
//    RLS(Row Level Security) 가 잠급니다. schema.sql 은 모든 표의 직접 읽기를
//    막아 두었고, 자료는 참여코드(6자리)나 관리코드(10자리)를 아는 사람만
//    정해진 RPC 함수로 주고받을 수 있습니다.
//    즉 anon key 만으로는 학생 명단도, 남의 반 자료도 한 줄 볼 수 없습니다.
//
//  ▶ 절대 넣지 말아야 할 것 — service_role 키
//    Settings → API 아래쪽의 service_role(secret) 키는 RLS 를 통째로 무시합니다.
//    이 파일에 넣으면 전교생 자료가 그대로 열립니다. 웹페이지에는 절대 넣지 마세요.
//    (실수로 넣었다면 Settings → API → service_role 의 Reset/Roll 로 즉시 새로 발급하세요.)
//
//  ▶ 값을 비워 두면 각 화면에 "Supabase 연결 정보를 넣어 주세요" 안내가 뜹니다.
//    브라우저 주소창에서 Hub.diagnose() 를 실행하면 무엇이 빠졌는지 알려 줍니다.
// =====================================================================

window.MBL_CONFIG = {
  // ① 프로젝트 주소 (Settings → API → Project URL)
  SUPABASE_URL: 'https://vbvtnmnodeoocbbjauap.supabase.co',

  // ② 공개용 키 (Settings → API → Project API keys → anon / public)
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidnRubW5vZGVvb2NiYmphdWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTQ0OTYsImV4cCI6MjA5NTA3MDQ5Nn0.dvuRrt3qw2Tya_QwGbcXrmGPdfDgI4xmgyH8UjU73Nc',

  // ③ 화면 안내에 쓰이는 이름 (없어도 동작합니다)
  SCHOOL : '해누리중학교',
  TEACHER: '조승재'
};
