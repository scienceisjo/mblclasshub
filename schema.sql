-- =====================================================================
--  MBL 수업허브 (mblclasshub) — Supabase 전체 스키마 + RPC
--  제작: 해누리중학교 조승재(과학이조선생)
--
--  ▶ 사용법
--    1) Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query
--    2) 이 파일 전체를 복사해서 붙여넣고 Run 하세요.
--    3) 여러 번 실행해도 안전합니다(있으면 만들지 않고, 함수는 덮어씁니다).
--    4) 실행이 끝나면 파일 맨 아래 "확인용 테스트 쿼리"로 동작을 확인하세요.
--
--  ▶ 설계 요약
--    · 계정/로그인 없음. 교사는 "관리코드(10자리)", 학생은 "참여코드(6자리)"만 씁니다.
--    · ★ 표를 직접 읽는 길이 하나도 없습니다. ★
--      mbl_lessons / mbl_groups / mbl_data / mbl_reports / mbl_feedback 모두 RLS 가 켜져 있고
--      SELECT 정책이 없으므로, 공개된 anon key 만 가진 사람은 단 한 줄도 읽지 못합니다.
--      (모둠원 이름이 들어가는 mbl_groups 도 마찬가지입니다.)
--    · 읽기·쓰기 모두 SECURITY DEFINER RPC 로만 가능하고, 그 RPC 는
--      참여코드(6자리) 또는 관리코드(10자리)를 알아야만 동작합니다.
--    · mbl_admin(관리코드) 테이블은 권한도 정책도 없어 anon 이 절대 읽을 수 없습니다.
--    · 그래서 Supabase 실시간(Realtime) 구독은 쓰지 않습니다. 실시간은 SELECT 정책을
--      열어야 동작하는데, 그러면 위의 보호가 통째로 풀립니다.
--      대신 아주 가벼운 변경감지 함수 mbl_sig() 를 두고 화면이 그것만 주기적으로 확인합니다.
--    · 기존 hub_* 테이블/함수와는 접두사가 달라 충돌하지 않습니다.
--
--  ▶ 모둠 비밀번호(PIN 4자리)  ★ 2차 개편에서 추가 ★
--    참여코드는 반 전체가 함께 쓰는 코드입니다. 그래서 참여코드만으로 쓰기를 허락하면
--    3모둠 학생이 5모둠의 데이터·보고서를 지우거나 남의 모둠 이름으로 별점을 보낼 수 있습니다.
--    이를 막기 위해 모둠마다 4자리 숫자 PIN 을 둡니다(0000 도 유효합니다).
--      · 수업을 만들 때 모둠 행과 함께 자동 발급됩니다. 교사만 볼 수 있습니다.
--      · 쓰기 RPC 4개 — mbl_join_group / mbl_save_data / mbl_save_report / mbl_send_feedback —
--        는 p_pin(맨 뒤 인자)을 반드시 받아 확인합니다. 틀리면 {"mbl_error":"..."} 를 돌려주고
--        (hub.js 가 오류로 바꿔 줍니다) 아무것도 저장하지 않습니다.
--      · 연속 5번 틀린 모둠은 10분 잠깁니다. 4자리는 1만 가지뿐이라 제한이 없으면
--        콘솔에서 전부 넣어 볼 수 있기 때문입니다. 교사가 PIN 표를 열면 잠금이 풀립니다.
--      · 읽기(mbl_get_lesson / mbl_get_board / mbl_sig)는 참여코드만으로 됩니다. PIN 이 필요 없습니다.
--      · 교사(mbl_admin_*)는 관리코드만으로 무엇이든 할 수 있습니다. PIN 이 필요 없습니다.
--      · 교사는 mbl_admin_pins 로 모둠별 PIN 표를 보고, mbl_admin_reset_pin 으로 다시 발급합니다.
--      · PIN 이 비어 있는(null) 모둠은 어떤 PIN 으로도 통과하지 못합니다.
--        그래서 아래 1번에서 기존 모둠에도 빠짐없이 PIN 을 채워 넣습니다.
--
--  ▶ 보관 기한(기본 60일)  ★ 2차 개편에서 추가 ★
--    학생 이름이 무기한 남지 않도록 수업마다 expires_at 을 둡니다(새 수업은 만든 날 + 60일).
--      · 기한이 지나면 학생용 mbl_find_lesson 이 막혀 참여코드로는 열리지 않습니다.
--      · 관리코드 경로(mbl_find_by_admin)는 기한이 지나도 열립니다.
--        교사가 기간을 늘리거나(mbl_admin_set 의 p_extend_days) 내려받을 수 있어야 하기 때문입니다.
--      · mbl_admin_delete 로 지금 바로 지울 수 있고, mbl_cleanup() 이 기한 지난 수업을 정리합니다.
--        mbl_create_lesson 안에서도 이 정리를 가볍게 한 번 부릅니다(실패해도 수업은 만들어집니다).
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
--  1. 테이블
-- =====================================================================

-- 수업(세션) 1건 -------------------------------------------------------
create table if not exists mbl_lessons (
  id              uuid primary key default gen_random_uuid(),
  join_code       text not null unique,              -- 학생 참여코드 6자리
  title           text not null default '이름 없는 수업',
  exp_id          text,                              -- lab-data.js 실험 id (예: 'sm-01')
  exp_title       text,
  class_label     text,                              -- 예: '2학년 3반'
  teacher_name    text,
  form            jsonb  not null default '{}'::jsonb,   -- 보고서 질문 등 교사가 고친 양식
  data_spec       jsonb  not null default '{}'::jsonb,   -- 데이터 입력표 규격
  group_count     int    not null default 7,
  phase           text   not null default 'collect',     -- collect → share → present → done
  presenter_group uuid,                                  -- 지금 발표 중인 모둠(mbl_groups.id)
  slide_idx       int    not null default 0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '60 days')   -- 보관 기한(기본 60일)
);

-- 오래된 버전에서 올라올 때를 대비한 보강(있으면 무시됨)
alter table mbl_lessons add column if not exists form            jsonb  not null default '{}'::jsonb;
alter table mbl_lessons add column if not exists data_spec       jsonb  not null default '{}'::jsonb;
alter table mbl_lessons add column if not exists presenter_group uuid;
alter table mbl_lessons add column if not exists slide_idx       int    not null default 0;
alter table mbl_lessons add column if not exists expires_at      timestamptz not null default (now() + interval '60 days');
-- 보고서 양식이 바뀐 시각. 화면이 "양식이 바뀌었나?"를 싸게 판별하는 데 씁니다.
alter table mbl_lessons add column if not exists form_at         timestamptz not null default now();

-- 보관 기한 기본값을 60일로 맞춥니다(예전 배포본은 180일이었습니다).
--   ★ 이미 들어 있는 수업의 값은 건드리지 않습니다. 갑자기 지워지면 안 되기 때문입니다.
--     기한이 비어 있는 행만 만든 날 + 60일로 채웁니다.
alter table mbl_lessons alter column expires_at set default (now() + interval '60 days');
update mbl_lessons set expires_at = created_at + interval '60 days' where expires_at is null;

-- 교사 관리코드 (★ 절대 공개 금지 ★) ---------------------------------
create table if not exists mbl_admin (
  lesson_id  uuid primary key references mbl_lessons(id) on delete cascade,
  admin_code text not null unique,
  created_at timestamptz not null default now()
);

-- 모둠 -----------------------------------------------------------------
create table if not exists mbl_groups (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references mbl_lessons(id) on delete cascade,
  group_no   int  not null,
  group_name text not null default '',
  members    text[] not null default '{}',
  pin        text not null default lpad(floor(random() * 10000)::text, 4, '0'),  -- 모둠 비밀번호 4자리
  pin_fail   int  not null default 0,        -- 연속으로 틀린 횟수(맞으면 0으로 돌아갑니다)
  pin_lock_until timestamptz,                -- 이 시각까지는 잠깁니다(전수조사 방지)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, group_no)
);

-- 모둠 이름·구성원이 바뀐 시각(변경감지용). 예전 버전에서 올라올 때를 대비한 보강.
alter table mbl_groups add column if not exists updated_at timestamptz not null default now();

-- 모둠 비밀번호 4자리. 예전 배포본에서 올라올 때를 대비한 보강 + 기존 행 채우기.
--   ★ PIN 이 비어 있는 모둠은 어떤 PIN 으로도 통과하지 못하므로 반드시 값을 채워 둡니다.
alter table mbl_groups add column if not exists pin text;
alter table mbl_groups alter column pin set default lpad(floor(random() * 10000)::text, 4, '0');
update mbl_groups set pin = lpad(floor(random() * 10000)::text, 4, '0') where pin is null or btrim(pin) = '';

-- PIN 시도 횟수 제한. 4자리는 1만 가지뿐이라 제한이 없으면 콘솔에서 전부 넣어 볼 수 있습니다.
--   연속 5번 틀리면 10분 잠그고, 맞으면 0으로 되돌립니다. 교사는 언제든 풀 수 있습니다.
alter table mbl_groups add column if not exists pin_fail       int not null default 0;
alter table mbl_groups add column if not exists pin_lock_until timestamptz;

-- 예전 수업에 모둠 행이 빠져 있으면 보충합니다(학생은 미리 만들어 둔 모둠을 고르기만 합니다).
insert into mbl_groups (lesson_id, group_no, group_name)
select l.id, g, g::text || '모둠'
  from mbl_lessons l,
       generate_series(1, greatest(coalesce(l.group_count, 7), 1)) as g
on conflict (lesson_id, group_no) do nothing;

-- 모둠별 측정 데이터 (모둠당 1행) --------------------------------------
create table if not exists mbl_data (
  group_id   uuid primary key references mbl_groups(id) on delete cascade,
  lesson_id  uuid not null references mbl_lessons(id) on delete cascade,
  "rows"     jsonb not null default '[]'::jsonb,      -- [[x, s1, s2...], ...] 또는 [{...}]
  note       text,
  updated_at timestamptz not null default now()
);

-- 모둠별 보고서 (모둠당 1행) -------------------------------------------
create table if not exists mbl_reports (
  group_id   uuid primary key references mbl_groups(id) on delete cascade,
  lesson_id  uuid not null references mbl_lessons(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb,
  status     text  not null default 'draft',          -- draft | done
  updated_at timestamptz not null default now()
);

-- 모둠 → 모둠 상호 피드백 ----------------------------------------------
create table if not exists mbl_feedback (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references mbl_lessons(id) on delete cascade,
  from_group uuid not null references mbl_groups(id) on delete cascade,
  to_group   uuid not null references mbl_groups(id) on delete cascade,
  stars      int  not null default 3,
  comment    text,
  created_at timestamptz not null default now()
);

-- 같은 모둠이 같은 모둠에게 보내는 피드백은 1건(갱신)
create unique index if not exists mbl_feedback_uniq
  on mbl_feedback (lesson_id, from_group, to_group);

-- 조회 인덱스
create index if not exists mbl_lessons_teacher_idx on mbl_lessons (teacher_name, created_at desc);
create index if not exists mbl_lessons_created_idx on mbl_lessons (created_at desc);
create index if not exists mbl_groups_lesson_idx   on mbl_groups   (lesson_id, group_no);
create index if not exists mbl_data_lesson_idx     on mbl_data     (lesson_id);
create index if not exists mbl_reports_lesson_idx  on mbl_reports  (lesson_id);
create index if not exists mbl_feedback_lesson_idx on mbl_feedback (lesson_id);

-- =====================================================================
--  2. RLS — 표를 직접 읽는 길을 전부 막습니다
--
--     예전 버전은 실시간 구독을 쓰려고 모든 표에 "누구나 읽기(using true)" 정책을
--     걸어 두었습니다. 그러면 참여코드를 몰라도 anon key 만으로
--         select * from mbl_groups
--     한 줄이면 학생 명단이 통째로 빠져나갑니다.
--     그래서 그 정책들을 지웁니다. RLS 는 계속 켜 두고 SELECT 정책은 하나도 두지
--     않으므로, 이제 anon 이 직접 읽을 수 있는 행은 0건입니다.
--     모든 읽기는 아래 SECURITY DEFINER RPC 를 통해서만, 그것도 참여코드나
--     관리코드를 정확히 아는 사람에게만 열립니다.
-- =====================================================================

alter table mbl_lessons  enable row level security;
alter table mbl_admin    enable row level security;
alter table mbl_groups   enable row level security;
alter table mbl_data     enable row level security;
alter table mbl_reports  enable row level security;
alter table mbl_feedback enable row level security;

-- 예전 배포본에 남아 있는 "누구나 읽기" 정책 제거.
--   정책 이름을 하나씩 적지 않고, mbl_ 로 시작하는 표에 걸린 읽기 정책(SELECT·ALL)을
--   모두 찾아서 지웁니다. Supabase 화면에서 다른 이름으로 만든 정책도 함께 지워집니다.
--   (이 스키마는 읽기·쓰기 정책을 하나도 만들지 않습니다. 모든 접근은 RPC 로만 합니다.)
do $$
declare r record;
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename like 'mbl\_%'
       and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    raise notice '옛 읽기 정책을 지웠습니다: %.%', r.tablename, r.policyname;
  end loop;
end $$;
-- ★ 어떤 표에도 SELECT 정책을 새로 만들지 않습니다.
-- ★ mbl_admin 에도 정책이 없습니다 = 관리코드는 한 줄도 새어 나가지 않습니다.

-- 테이블 권한: 읽기·쓰기 모두 차단. 자료는 오직 RPC 로만 오갑니다.
--   PUBLIC 에 준 권한이 남아 있으면 anon 도 그대로 쓸 수 있으므로 함께 회수합니다.
revoke all on table mbl_lessons, mbl_admin, mbl_groups, mbl_data, mbl_reports, mbl_feedback
  from public, anon, authenticated;
-- (grant 는 하지 않습니다. 예전 버전에서 준 select 권한도 위 revoke 로 회수됩니다.)

-- 자가검증 — 위 두 블록이 제대로 돌았는지 실행만으로 확인합니다.
--   읽기 정책이 하나라도 남아 있으면 여기서 멈추고 무엇이 남았는지 알려 줍니다.
do $$
declare n_pol int; n_grant int; v_list text;
begin
  select count(*), coalesce(string_agg(tablename || '.' || policyname, ', '), '')
    into n_pol, v_list
    from pg_policies
   where schemaname = 'public' and tablename like 'mbl\_%' and cmd in ('SELECT', 'ALL');
  if n_pol > 0 then
    raise exception '표를 직접 읽는 정책이 아직 남아 있습니다(%). Supabase 대시보드 → Authentication → Policies 에서 지운 뒤 다시 실행해 주세요.', v_list;
  end if;

  select count(*) into n_grant
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'mbl\_%'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n_grant > 0 then
    -- RLS 가 켜져 있고 SELECT 정책이 없으므로 이것만으로 새어 나가지는 않습니다.
    -- 다만 깔끔하지 않으므로 알려 둡니다(다른 관리자가 준 권한일 수 있습니다).
    raise warning 'anon/authenticated 에게 표 권한이 % 건 남아 있습니다. Supabase 지원팀 계정이 준 권한일 수 있습니다.', n_grant;
  end if;

  raise notice '확인: 표를 직접 읽는 정책이 0건입니다. 이제 참여코드·관리코드를 아는 사람만 RPC 로 읽을 수 있습니다.';
end $$;

-- =====================================================================
--  3. 내부 헬퍼 함수 (anon 에게 EXECUTE 를 주지 않습니다)
-- =====================================================================

-- 헷갈리는 글자(O, 0, I, 1, L) 를 뺀 코드 생성기
create or replace function mbl_gen_code(p_len int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- 31자 (O,0,I,1,L 제외)
  v_out   text := '';
  i       int;
begin
  for i in 1..greatest(coalesce(p_len,6),1) loop
    v_out := v_out || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;
  return v_out;
end;
$$;

-- 4자리 숫자 PIN 생성기 (0000 도 유효합니다)
create or replace function mbl_gen_pin()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select lpad(floor(random() * 10000)::text, 4, '0');
$$;

-- 참여코드로 수업 찾기 (없거나 보관 기한이 지났으면 예외)
--   ★ 학생 경로 전용입니다. 교사 경로(mbl_find_by_admin)는 기한이 지나도 통과시킵니다.
create or replace function mbl_find_lesson(p_join_code text)
returns mbl_lessons
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  select * into v from mbl_lessons
   where join_code = upper(btrim(coalesce(p_join_code, '')));
  if not found then
    raise exception '수업 코드를 찾을 수 없습니다.';
  end if;
  if v.expires_at is not null and v.expires_at < now() then
    raise exception '수업 보관 기간이 지났습니다. 선생님께 문의하세요.';
  end if;
  return v;
end;
$$;

-- 관리코드로 수업 찾기 (없으면 예외)
create or replace function mbl_find_by_admin(p_admin_code text)
returns mbl_lessons
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  select l.* into v
    from mbl_lessons l
    join mbl_admin a on a.lesson_id = l.id
   where a.admin_code = upper(btrim(coalesce(p_admin_code, '')));
  if not found then
    raise exception '관리 코드를 찾을 수 없습니다.';
  end if;
  return v;
end;
$$;

-- 모둠이 그 수업 소속인지 확인 (아니면 예외)
create or replace function mbl_check_group(p_lesson_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_group_id is null
     or not exists (select 1 from mbl_groups where id = p_group_id and lesson_id = p_lesson_id) then
    raise exception '모둠 정보를 찾을 수 없습니다.';
  end if;
end;
$$;

-- 모둠 비밀번호 확인 + 시도 횟수 제한 (소속 확인까지 함께 합니다)
--   ★ 맞으면 null 을, 틀리면 학생에게 보여 줄 한국어 문구를 돌려줍니다. 예외를 던지지 않습니다.
--     예외를 던지면 그 거래(transaction)가 통째로 되돌려져 방금 센 실패 횟수까지 사라집니다.
--     그러면 콘솔에서 0000~9999 를 다 넣어 보는 전수조사를 아무것도 막지 못합니다.
--     그래서 쓰기 RPC 는 이 함수를 쓰고, 틀렸을 때 {"mbl_error": "..."} 를 돌려줍니다.
--     (hub.js 가 그 값을 받아 오류로 바꿔 주므로 화면 동작은 예전과 같습니다.)
--   ★ pin 이 null 이거나 빈 값인 모둠은 어떤 PIN 으로도 통과하지 못합니다.
--   ★ 연속 5번 틀리면 10분 잠깁니다. 교사가 mbl_admin_pins·mbl_admin_reset_pin 으로 풀어 줍니다.
create or replace function mbl_pin_error(p_lesson_id uuid, p_group_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g    mbl_groups;
  v_fail int;
begin
  if p_group_id is null then
    return '모둠 정보를 찾을 수 없습니다.';
  end if;

  select * into v_g
    from mbl_groups g
   where g.id = p_group_id and g.lesson_id = p_lesson_id;
  if not found then
    return '모둠 정보를 찾을 수 없습니다.';
  end if;

  -- 잠금 중이면 맞는 PIN 이어도 통과시키지 않습니다(맞는지 아닌지도 알려 주지 않습니다).
  if v_g.pin_lock_until is not null and v_g.pin_lock_until > now() then
    return '비밀번호를 여러 번 틀렸습니다. 선생님께 문의하세요.';
  end if;
  -- 잠금 시간이 지났으면 처음부터 다시 셉니다.
  if v_g.pin_lock_until is not null then
    v_g.pin_fail := 0;
  end if;

  if v_g.pin is null or btrim(v_g.pin) = ''
     or btrim(coalesce(p_pin, '')) <> btrim(v_g.pin) then
    v_fail := coalesce(v_g.pin_fail, 0) + 1;
    update mbl_groups
       set pin_fail       = v_fail,
           pin_lock_until = case when v_fail >= 5 then now() + interval '10 minutes' end
     where id = p_group_id;
    return '모둠 비밀번호가 맞지 않습니다.';
  end if;

  if coalesce(v_g.pin_fail, 0) <> 0 or v_g.pin_lock_until is not null then
    update mbl_groups set pin_fail = 0, pin_lock_until = null where id = p_group_id;
  end if;
  return null;
end;
$$;

-- 예외를 던지는 옛 형태(호환용). 실패 횟수를 남겨야 하는 쓰기 RPC 는 위 mbl_pin_error 를 씁니다.
create or replace function mbl_check_pin(p_lesson_id uuid, p_group_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_err text;
begin
  v_err := mbl_pin_error(p_lesson_id, p_group_id, p_pin);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
end;
$$;

-- 공유 보드 한 덩어리(json) 만들기
--   ★ 모둠의 pin 은 여기서 반드시 빼냅니다. 이 함수는 참여코드만 알면 부를 수 있는
--     mbl_get_board 도 함께 쓰므로, pin 을 담으면 같은 반 학생 누구나 남의 모둠 PIN 을
--     보게 되어 PIN 을 둔 의미가 사라집니다. 교사는 mbl_admin_pins 로 따로 확인합니다.
create or replace function mbl_board_json(p_lesson mbl_lessons)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'lesson',   to_jsonb(p_lesson),
    'groups',   coalesce((select jsonb_agg((to_jsonb(g) - 'pin' - 'pin_fail' - 'pin_lock_until') order by g.group_no)
                            from mbl_groups g where g.lesson_id = p_lesson.id), '[]'::jsonb),
    'data',     coalesce((select jsonb_agg(to_jsonb(d) order by d.updated_at)
                            from mbl_data d where d.lesson_id = p_lesson.id), '[]'::jsonb),
    'reports',  coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at)
                            from mbl_reports r where r.lesson_id = p_lesson.id), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at)
                            from mbl_feedback f where f.lesson_id = p_lesson.id), '[]'::jsonb)
  );
$$;

-- ★ from public 만으로는 부족합니다. Supabase 는 기본 권한(default privileges)으로
--   새로 만든 함수에 anon·authenticated 앞으로 "명시적" EXECUTE 를 자동으로 붙입니다.
--   명시적 권한은 PUBLIC 회수로 지워지지 않으므로 세 역할을 모두 적어 회수합니다.
--   (특히 mbl_pin_error·mbl_check_pin 이 열려 있으면, 자료를 건드리지 않고
--    남의 모둠 PIN 만 찍어 보는 "흔적 없는 판별기"가 학생 손에 들어갑니다.)
revoke execute on function mbl_gen_code(int)                from public, anon, authenticated;
revoke execute on function mbl_gen_pin()                    from public, anon, authenticated;
revoke execute on function mbl_find_lesson(text)            from public, anon, authenticated;
revoke execute on function mbl_find_by_admin(text)          from public, anon, authenticated;
revoke execute on function mbl_check_group(uuid, uuid)      from public, anon, authenticated;
revoke execute on function mbl_check_pin(uuid, uuid, text)  from public, anon, authenticated;
revoke execute on function mbl_pin_error(uuid, uuid, text)  from public, anon, authenticated;
revoke execute on function mbl_board_json(mbl_lessons)      from public, anon, authenticated;

-- =====================================================================
--  4. 교사용 RPC
-- =====================================================================

-- 수업 만들기 → {join_code, admin_code, lesson}
-- 만드는 즉시 group_count 만큼 모둠 행을 미리 만들어 둡니다(학생은 고르기만 하면 입장).
create or replace function mbl_create_lesson(
  p_title       text,
  p_exp_id      text,
  p_exp_title   text,
  p_class_label text,
  p_teacher_name text,
  p_form        jsonb,
  p_data_spec   jsonb,
  p_group_count int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_join   text;
  v_admin  text;
  v_n      int;
  v_try    int := 0;
  v_lesson mbl_lessons;
begin
  -- 기한이 지난 옛 수업 정리. 수업을 새로 만드는 순간이 가장 자연스러운 청소 시점입니다.
  -- ★ 이 정리가 실패하더라도 수업 만들기는 반드시 성공해야 합니다.
  begin
    perform mbl_cleanup();
  exception when others then
    null;
  end;

  v_n := coalesce(p_group_count, 7);
  if v_n < 1  then v_n := 1;  end if;
  if v_n > 20 then v_n := 20; end if;

  -- 참여코드 6자리 (중복이면 재시도)
  loop
    v_try  := v_try + 1;
    v_join := mbl_gen_code(6);
    exit when not exists (select 1 from mbl_lessons where join_code = v_join);
    if v_try > 60 then
      raise exception '참여 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
    end if;
  end loop;

  -- 관리코드 10자리
  v_try := 0;
  loop
    v_try   := v_try + 1;
    v_admin := mbl_gen_code(10);
    exit when not exists (select 1 from mbl_admin where admin_code = v_admin);
    if v_try > 60 then
      raise exception '관리 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
    end if;
  end loop;

  insert into mbl_lessons (join_code, title, exp_id, exp_title, class_label,
                           teacher_name, form, data_spec, group_count)
  values (v_join,
          coalesce(nullif(btrim(coalesce(p_title, '')), ''), '이름 없는 수업'),
          nullif(btrim(coalesce(p_exp_id, '')), ''),
          nullif(btrim(coalesce(p_exp_title, '')), ''),
          nullif(btrim(coalesce(p_class_label, '')), ''),
          nullif(btrim(coalesce(p_teacher_name, '')), ''),
          coalesce(p_form, '{}'::jsonb),
          coalesce(p_data_spec, '{}'::jsonb),
          v_n)
  returning * into v_lesson;

  insert into mbl_admin (lesson_id, admin_code) values (v_lesson.id, v_admin);

  -- 모둠 행을 미리 만들면서 모둠마다 4자리 PIN 을 발급합니다(모둠마다 다른 값).
  insert into mbl_groups (lesson_id, group_no, group_name, pin)
  select v_lesson.id, g, g::text || '모둠', mbl_gen_pin()
    from generate_series(1, v_n) as g
  on conflict (lesson_id, group_no) do nothing;

  return json_build_object(
    'join_code',  v_join,
    'admin_code', v_admin,
    'lesson',     to_jsonb(v_lesson),
    -- 교사가 만든 직후 칠판에 띄울 수 있도록 모둠별 PIN 표도 함께 돌려줍니다.
    'pins',       coalesce((select json_agg(json_build_object(
                                     'group_id',   g.id,
                                     'group_no',   g.group_no,
                                     'group_name', g.group_name,
                                     'pin',        g.pin) order by g.group_no)
                              from mbl_groups g where g.lesson_id = v_lesson.id), '[]'::json)
  );
end;
$$;

-- 교사 대시보드 전체 불러오기
create or replace function mbl_admin_load(p_admin_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_by_admin(p_admin_code);
  return mbl_board_json(v);
end;
$$;

-- 수업 상태 바꾸기. NULL 로 넘긴 값은 그대로 둡니다.
--   p_presenter_group 을 비우려면 '00000000-0000-0000-0000-000000000000' 을 넘기세요.
--   p_extend_days 는 보관 기한 연장(일). 맨 뒤에 있고 기본값이 null 이라
--   예전처럼 인자 5개로 부르던 화면 코드는 그대로 동작합니다.
drop function if exists mbl_admin_set(text, text, uuid, int, jsonb);
create or replace function mbl_admin_set(
  p_admin_code      text,
  p_phase           text,
  p_presenter_group uuid,
  p_slide_idx       int,
  p_form            jsonb,
  p_extend_days     int default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v mbl_lessons;
  v_presenter uuid;
  v_clear boolean := false;
begin
  v := mbl_find_by_admin(p_admin_code);

  if p_phase is not null and p_phase not in ('collect', 'share', 'present', 'done') then
    raise exception '알 수 없는 수업 단계입니다: %', p_phase;
  end if;

  v_presenter := p_presenter_group;
  if v_presenter = '00000000-0000-0000-0000-000000000000'::uuid then
    v_clear := true;
    v_presenter := null;
  elsif v_presenter is not null then
    perform mbl_check_group(v.id, v_presenter);
  end if;

  update mbl_lessons set
    phase           = coalesce(p_phase, phase),
    presenter_group = case when v_clear then null
                           when v_presenter is not null then v_presenter
                           else presenter_group end,
    slide_idx       = coalesce(p_slide_idx, slide_idx),
    form            = coalesce(p_form, form),
    form_at         = case when p_form is not null then now() else form_at end,
    -- 보관 기한 연장: 이미 지난 수업이면 오늘부터 다시 셉니다.
    expires_at      = case when coalesce(p_extend_days, 0) > 0
                           then greatest(expires_at, now()) + (p_extend_days * interval '1 day')
                           else expires_at end
  where id = v.id
  returning * into v;

  return to_jsonb(v)::json;
end;
$$;

-- 모둠별 PIN 표 (교사 전용) → [{group_id, group_no, group_name, pin}]
create or replace function mbl_admin_pins(p_admin_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_by_admin(p_admin_code);

  -- 혹시 PIN 이 비어 있는 모둠이 있으면 이 자리에서 채워 줍니다(빈 PIN 은 아무도 통과 못 하므로).
  update mbl_groups set pin = mbl_gen_pin()
   where lesson_id = v.id and (pin is null or btrim(pin) = '');

  -- 여러 번 틀려 잠긴 모둠은 여기서 함께 풀어 줍니다(교사가 PIN 표를 여는 순간이 곧 복구 시점).
  update mbl_groups set pin_fail = 0, pin_lock_until = null
   where lesson_id = v.id and (pin_fail <> 0 or pin_lock_until is not null);

  return coalesce((
    select json_agg(json_build_object(
             'group_id',   g.id,
             'group_no',   g.group_no,
             'group_name', g.group_name,
             'pin',        g.pin) order by g.group_no)
      from mbl_groups g where g.lesson_id = v.id
  ), '[]'::json);
end;
$$;

-- 모둠 PIN 다시 발급 (교사 전용) → {group_id, group_no, pin}
create or replace function mbl_admin_reset_pin(p_admin_code text, p_group_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v   mbl_lessons;
  v_g mbl_groups;
begin
  v := mbl_find_by_admin(p_admin_code);
  perform mbl_check_group(v.id, p_group_id);

  -- 새 PIN 을 주면서 잠금과 실패 횟수도 함께 풀어 줍니다.
  update mbl_groups set pin = mbl_gen_pin(), pin_fail = 0, pin_lock_until = null
   where id = p_group_id and lesson_id = v.id
  returning * into v_g;

  return json_build_object('group_id', v_g.id, 'group_no', v_g.group_no, 'pin', v_g.pin);
end;
$$;

-- 수업 즉시 삭제 (교사 전용). 딸린 모든 행이 함께 사라지며 되돌릴 수 없습니다.
--   화면에서는 반드시 한 번 더 확인을 받은 뒤에 부르세요.
create or replace function mbl_admin_delete(p_admin_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v   mbl_lessons;
  n_g int; n_d int; n_r int; n_f int; n_l int;
begin
  v := mbl_find_by_admin(p_admin_code);

  select count(*) into n_g from mbl_groups   where lesson_id = v.id;
  select count(*) into n_d from mbl_data     where lesson_id = v.id;
  select count(*) into n_r from mbl_reports  where lesson_id = v.id;
  select count(*) into n_f from mbl_feedback where lesson_id = v.id;

  delete from mbl_lessons where id = v.id;   -- mbl_admin 포함 나머지는 on delete cascade
  get diagnostics n_l = row_count;

  return json_build_object(
    'deleted_lessons',  n_l,
    'deleted_groups',   n_g,
    'deleted_data',     n_d,
    'deleted_reports',  n_r,
    'deleted_feedback', n_f,
    'title',            v.title,
    'at',               now()
  );
end;
$$;

-- 같은 교사 이름으로 만든 최근 수업 목록.
--   보안상 admin_code 는 "지금 넘긴 관리코드에 해당하는 수업" 한 건에만 들어갑니다.
--   (다른 수업을 열려면 교사 브라우저의 mbl_admin_codes 에 보관된 코드를 씁니다)
create or replace function mbl_admin_list(p_admin_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_by_admin(p_admin_code);

  return coalesce((
    select json_agg(x order by x.created_at desc) from (
      -- ★ 참여코드는 "지금 넘긴 관리코드에 해당하는 수업" 에만 돌려줍니다.
      --   같은 이름의 다른 교사가 만든 수업의 참여코드가 새어 나가면
      --   그 수업에 남의 자료를 써넣을 수 있으므로 반드시 가립니다.
      select l.id,
             case when l.id = v.id then l.join_code else null end                                as join_code,
             l.title, l.exp_id, l.exp_title, l.class_label,
             l.teacher_name, l.phase, l.group_count, l.created_at,
             (select count(*) from mbl_groups  g where g.lesson_id = l.id)                     as group_rows,
             (select count(*) from mbl_data    d where d.lesson_id = l.id)                     as data_rows,
             (select count(*) from mbl_reports r where r.lesson_id = l.id and r.status='done') as done_rows,
             case when l.id = v.id then upper(btrim(p_admin_code)) else null end               as admin_code
        from mbl_lessons l
       where l.id = v.id
          or (v.teacher_name is not null and l.teacher_name is not distinct from v.teacher_name)
       order by l.created_at desc
       limit 40
    ) x
  ), '[]'::json);
end;
$$;

-- =====================================================================
--  5. 학생용 RPC
-- =====================================================================

-- 참여코드로 수업 정보 얻기 (관리코드는 절대 포함되지 않습니다)
create or replace function mbl_get_lesson(p_join_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_lesson(p_join_code);
  return to_jsonb(v)::json;
end;
$$;

-- 모둠 입장 (이미 있으면 이름·구성원만 갱신)
--   ★ 이름·구성원을 바꾸는 쓰기이므로 모둠 PIN 이 필요합니다.
--   ★ 모둠 행은 수업을 만들 때 미리 만들어 두므로, 여기서는 새로 만들지 않고 고르기만 합니다.
--     (없는 모둠을 만들 수 있게 두면 PIN 없이 들어오는 샛길이 생깁니다.)
drop function if exists mbl_join_group(text, int, text, text[]);
create or replace function mbl_join_group(
  p_join_code  text,
  p_group_no   int,
  p_group_name text,
  p_members    text[],
  p_pin        text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v      mbl_lessons;
  v_g    mbl_groups;
  v_id   uuid;
  v_name text;
  v_err  text;
begin
  v := mbl_find_lesson(p_join_code);

  if p_group_no is null or p_group_no < 1 or p_group_no > 20 then
    raise exception '모둠 번호가 올바르지 않습니다.';
  end if;

  select g.id into v_id from mbl_groups g
   where g.lesson_id = v.id and g.group_no = p_group_no;
  if not found then
    raise exception '모둠 정보를 찾을 수 없습니다.';
  end if;

  -- PIN 이 틀리면 예외 대신 문구를 돌려줍니다(예외를 던지면 실패 횟수가 되돌려집니다).
  v_err := mbl_pin_error(v.id, v_id, p_pin);
  if v_err is not null then return json_build_object('mbl_error', v_err); end if;

  v_name := nullif(btrim(coalesce(p_group_name, '')), '');

  update mbl_groups set
    group_name = coalesce(v_name, group_name),
    members    = case when p_members is null then members else p_members end,
    updated_at = now()
  where id = v_id
  returning * into v_g;

  return (to_jsonb(v_g) - 'pin' - 'pin_fail' - 'pin_lock_until')::json;
end;
$$;

-- 측정 데이터 저장 (모둠당 1행 upsert) — 우리 모둠 PIN 이 있어야 합니다.
drop function if exists mbl_save_data(text, uuid, jsonb, text);
create or replace function mbl_save_data(
  p_join_code text,
  p_group_id  uuid,
  p_rows      jsonb,
  p_note      text,
  p_pin       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v     mbl_lessons;
  v_d   mbl_data;
  v_err text;
begin
  v := mbl_find_lesson(p_join_code);
  v_err := mbl_pin_error(v.id, p_group_id, p_pin);   -- 소속 확인 + PIN 확인 + 시도 횟수 제한
  if v_err is not null then return json_build_object('mbl_error', v_err); end if;

  insert into mbl_data (group_id, lesson_id, "rows", note, updated_at)
  values (p_group_id, v.id, coalesce(p_rows, '[]'::jsonb), p_note, now())
  on conflict (group_id) do update
    set "rows"     = excluded."rows",
        note       = excluded.note,
        updated_at = now()
  returning * into v_d;

  return to_jsonb(v_d)::json;
end;
$$;

-- 보고서 저장 (모둠당 1행 upsert) — 우리 모둠 PIN 이 있어야 합니다.
drop function if exists mbl_save_report(text, uuid, jsonb, text);
create or replace function mbl_save_report(
  p_join_code text,
  p_group_id  uuid,
  p_answers   jsonb,
  p_status    text,
  p_pin       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v     mbl_lessons;
  v_r   mbl_reports;
  v_s   text;
  v_err text;
begin
  v := mbl_find_lesson(p_join_code);
  v_err := mbl_pin_error(v.id, p_group_id, p_pin);   -- 소속 확인 + PIN 확인 + 시도 횟수 제한
  if v_err is not null then return json_build_object('mbl_error', v_err); end if;

  v_s := lower(btrim(coalesce(p_status, 'draft')));
  if v_s not in ('draft', 'done') then v_s := 'draft'; end if;

  insert into mbl_reports (group_id, lesson_id, answers, status, updated_at)
  values (p_group_id, v.id, coalesce(p_answers, '{}'::jsonb), v_s, now())
  on conflict (group_id) do update
    set answers    = excluded.answers,
        status     = excluded.status,
        updated_at = now()
  returning * into v_r;

  return to_jsonb(v_r)::json;
end;
$$;

-- 모둠 상호 피드백 (같은 from→to 는 갱신)
--   ★ 보내는 모둠(p_from_group)의 PIN 이 있어야 합니다. 남의 모둠 이름으로 별점을 못 보냅니다.
drop function if exists mbl_send_feedback(text, uuid, uuid, int, text);
create or replace function mbl_send_feedback(
  p_join_code  text,
  p_from_group uuid,
  p_to_group   uuid,
  p_stars      int,
  p_comment    text,
  p_pin        text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v     mbl_lessons;
  v_f   mbl_feedback;
  v_s   int;
  v_err text;
begin
  v := mbl_find_lesson(p_join_code);
  v_err := mbl_pin_error(v.id, p_from_group, p_pin);  -- 보내는 모둠은 PIN 까지 확인
  if v_err is not null then return json_build_object('mbl_error', v_err); end if;
  perform mbl_check_group(v.id, p_to_group);          -- 받는 모둠은 소속만 확인

  if p_from_group = p_to_group then
    raise exception '우리 모둠에게는 별점을 줄 수 없습니다.';
  end if;

  v_s := least(greatest(coalesce(p_stars, 3), 1), 5);

  insert into mbl_feedback (lesson_id, from_group, to_group, stars, comment)
  values (v.id, p_from_group, p_to_group, v_s, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (lesson_id, from_group, to_group) do update
    set stars      = excluded.stars,
        comment    = excluded.comment,
        created_at = now()
  returning * into v_f;

  return to_jsonb(v_f)::json;
end;
$$;

-- 공유 보드 (학생·발표·교사 공통)
create or replace function mbl_get_board(p_join_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_lesson(p_join_code);
  return mbl_board_json(v);
end;
$$;

-- 변경감지 신호 (아주 가벼움 · 150바이트 안팎)
--   화면은 이 함수만 주기적으로 부르고, 값이 달라졌을 때만 무거운 mbl_get_board 를 부릅니다.
--   phase / presenter_group / slide_idx 가 여기 들어 있으므로
--   발표 슬라이드 넘김은 보드를 다시 받지 않고 이 신호만으로 따라갑니다.
--   *_ver 는 "행 수 : 가장 최근 시각" 이라 내용이 바뀌면 반드시 값이 달라집니다.
create or replace function mbl_sig(p_join_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v mbl_lessons;
begin
  v := mbl_find_lesson(p_join_code);   -- 없는 코드면 여기서 예외

  return json_build_object(
    'phase',           v.phase,
    'presenter_group', v.presenter_group,
    'slide_idx',       v.slide_idx,
    'form_at',         v.form_at,
    'data_ver', (select count(*)::text || ':' || coalesce(max(d.updated_at)::text, '')
                   from mbl_data d     where d.lesson_id = v.id),
    'rep_ver',  (select count(*)::text || ':' || coalesce(max(r.updated_at)::text, '')
                   from mbl_reports r  where r.lesson_id = v.id),
    'fb_ver',   (select count(*)::text || ':' || coalesce(max(f.created_at)::text, '')
                   from mbl_feedback f where f.lesson_id = v.id),
    'grp_ver',  (select count(*)::text || ':' || coalesce(max(g.updated_at)::text, '')
                   from mbl_groups g   where g.lesson_id = v.id)
  );
end;
$$;

-- =====================================================================
--  6. 정리용 함수 — 기한이 지난 수업 삭제 (연결된 데이터도 함께 삭제)
--     학기말에 SQL Editor 에서  select mbl_cleanup();  한 번 실행하면 됩니다.
--     수업을 새로 만들 때(mbl_create_lesson)도 자동으로 한 번 불립니다.
-- =====================================================================
create or replace function mbl_cleanup()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  n_l int := 0; n_g int := 0; n_d int := 0; n_r int := 0; n_f int := 0;
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids
    from mbl_lessons where expires_at is not null and expires_at < now();

  if array_length(v_ids, 1) is not null then
    select count(*) into n_g from mbl_groups   where lesson_id = any(v_ids);
    select count(*) into n_d from mbl_data     where lesson_id = any(v_ids);
    select count(*) into n_r from mbl_reports  where lesson_id = any(v_ids);
    select count(*) into n_f from mbl_feedback where lesson_id = any(v_ids);

    delete from mbl_lessons where id = any(v_ids);   -- 나머지는 on delete cascade
    get diagnostics n_l = row_count;
  end if;

  return json_build_object(
    'deleted_lessons',  n_l,
    'deleted_groups',   n_g,
    'deleted_data',     n_d,
    'deleted_reports',  n_r,
    'deleted_feedback', n_f,
    'at',               now()
  );
end;
$$;
-- 자동 삭제를 원하면 pg_cron 설치 후:
--   select cron.schedule('mbl-cleanup', '0 4 * * 0', $$select mbl_cleanup();$$);

-- =====================================================================
--  7. 실행 권한 — RPC 만 anon 에게 열어 줍니다
-- =====================================================================
--   ★ 쓰기 RPC 4개는 맨 뒤에 p_pin 이 붙은 "새 시그니처" 뿐입니다.
--     PIN 없이 부를 수 있던 옛 시그니처는 위에서 drop function 으로 지웠습니다.
grant execute on function mbl_create_lesson(text, text, text, text, text, jsonb, jsonb, int) to anon, authenticated;
grant execute on function mbl_get_lesson(text)                                               to anon, authenticated;
grant execute on function mbl_join_group(text, int, text, text[], text)                      to anon, authenticated;
grant execute on function mbl_save_data(text, uuid, jsonb, text, text)                       to anon, authenticated;
grant execute on function mbl_save_report(text, uuid, jsonb, text, text)                     to anon, authenticated;
grant execute on function mbl_send_feedback(text, uuid, uuid, int, text, text)               to anon, authenticated;
grant execute on function mbl_get_board(text)                                                to anon, authenticated;
grant execute on function mbl_sig(text)                                                      to anon, authenticated;
grant execute on function mbl_admin_load(text)                                               to anon, authenticated;
grant execute on function mbl_admin_set(text, text, uuid, int, jsonb, int)                   to anon, authenticated;
grant execute on function mbl_admin_list(text)                                               to anon, authenticated;
grant execute on function mbl_admin_pins(text)                                               to anon, authenticated;
grant execute on function mbl_admin_reset_pin(text, uuid)                                    to anon, authenticated;
grant execute on function mbl_admin_delete(text)                                             to anon, authenticated;
-- mbl_cleanup 은 교사(대시보드)에서도 부르지 않습니다. SQL Editor 전용.
--   (mbl_create_lesson 이 SECURITY DEFINER 로 안에서 부르므로 anon 권한은 필요 없습니다.)
revoke execute on function mbl_cleanup() from public, anon, authenticated;

-- 자가검증 ② — PIN 없이 쓸 수 있는 옛 함수가 남아 있지 않은지, PIN 이 빈 모둠이 없는지,
--               내부 헬퍼 함수가 anon 에게 열려 있지 않은지
do $$
declare v_old text := ''; n_pin int; n_fn int; v_fn text;
begin
  -- 내부 헬퍼는 anon 이 부를 수 없어야 합니다. mbl_pin_error·mbl_check_pin 이 열려 있으면
  -- 자료를 건드리지 않고 남의 모둠 PIN 만 찍어 보는 길이 생깁니다.
  select count(*), coalesce(string_agg(distinct routine_name || '→' || grantee, ', '), '')
    into n_fn, v_fn
    from information_schema.role_routine_grants
   where specific_schema = 'public'
     and routine_name in ('mbl_check_pin','mbl_pin_error','mbl_check_group','mbl_find_lesson',
                          'mbl_find_by_admin','mbl_board_json','mbl_gen_code','mbl_gen_pin','mbl_cleanup')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n_fn > 0 then
    raise exception '내부 헬퍼 함수가 아직 anon 에게 열려 있습니다(%). 이 파일의 revoke 문이 듣지 않았습니다. Supabase SQL Editor 에서 소유자(postgres) 로 다시 실행해 주세요.', v_fn;
  end if;

  -- 옛(=PIN 없는) 시그니처가 하나라도 살아 있으면 그 길로 남의 모둠을 덮어쓸 수 있습니다.
  if to_regprocedure('public.mbl_join_group(text,int,text,text[])')       is not null then v_old := v_old || 'mbl_join_group '; end if;
  if to_regprocedure('public.mbl_save_data(text,uuid,jsonb,text)')        is not null then v_old := v_old || 'mbl_save_data '; end if;
  if to_regprocedure('public.mbl_save_report(text,uuid,jsonb,text)')      is not null then v_old := v_old || 'mbl_save_report '; end if;
  if to_regprocedure('public.mbl_send_feedback(text,uuid,uuid,int,text)') is not null then v_old := v_old || 'mbl_send_feedback '; end if;

  if v_old <> '' then
    raise exception 'PIN 없이 저장할 수 있는 옛 함수가 남아 있습니다(%). 이 파일을 다시 실행해 주세요.', v_old;
  end if;

  select count(*) into n_pin from mbl_groups where pin is null or btrim(pin) = '';
  if n_pin > 0 then
    raise exception 'PIN 이 비어 있는 모둠이 % 건 있습니다. 이 파일 1번의 update 문이 실행되지 않았습니다.', n_pin;
  end if;

  raise notice '확인: 쓰기 RPC 4개는 모두 모둠 PIN 을 요구하고, 모든 모둠에 PIN 이 들어 있습니다.';
end $$;

-- =====================================================================
--  8. 실시간(Realtime) 해제
--
--     실시간 구독은 RLS 의 SELECT 를 통과해야 자료가 흘러갑니다. 즉 실시간을 쓰려면
--     2번에서 막아 둔 "누구나 읽기"를 다시 열어야 하고, 그러면 학생 명단이 그대로
--     공개됩니다. 그래서 실시간을 쓰지 않고, 대신 mbl_sig() 를 확인하는 방식으로
--     바꾸었습니다(전송량도 훨씬 적습니다).
--     아래 블록은 예전 버전에서 퍼블리케이션에 등록해 둔 표를 다시 빼냅니다.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['mbl_lessons','mbl_groups','mbl_data','mbl_reports','mbl_feedback'] loop
    if exists (select 1 from pg_publication_tables
                where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      begin
        execute format('alter publication supabase_realtime drop table public.%I', t);
      exception when others then
        raise notice '% 을(를) supabase_realtime 에서 빼지 못했습니다(권한). Database → Replication 에서 꺼 주세요.', t;
      end;
    end if;
  end loop;
end $$;

-- 실시간을 쓰지 않으므로 REPLICA IDENTITY 도 기본값으로 되돌립니다(WAL 절약).
alter table mbl_data     replica identity default;
alter table mbl_reports  replica identity default;
alter table mbl_groups   replica identity default;
alter table mbl_lessons  replica identity default;
alter table mbl_feedback replica identity default;

-- =====================================================================
--  ▣ 확인용 테스트 쿼리 (필요할 때 아래 주석을 풀고 하나씩 실행)
-- =====================================================================
/*
-- 1) 수업 만들기 → join_code / admin_code 를 메모해 두세요.
select mbl_create_lesson(
  '물과 식용유의 비열 비교', 'sm-01', '물과 식용유의 비열 비교',
  '1학년 3반', '조승재',
  '{"questions":[{"q":"조작변인은 무엇인가요?","type":"short"}]}'::jsonb,
  '{"x":{"label":"시간","unit":"초"},"series":[{"label":"물","unit":"℃"},{"label":"식용유","unit":"℃"}],"rows":8,"chart":"line"}'::jsonb,
  7
);

-- 1-1) 교사: 모둠별 PIN 표 보기 (칠판에 띄우거나 모둠에 불러 줍니다)
select mbl_admin_pins('여기에-관리코드');
--     특정 모둠 PIN 다시 발급
select mbl_admin_reset_pin('여기에-관리코드', '여기에-group-uuid'::uuid);

-- 2) 학생: 수업 확인 + 모둠 입장 (참여코드·PIN 은 위에서 받은 값으로 바꾸세요)
select mbl_get_lesson('ABC234');                      -- 읽기는 PIN 이 필요 없습니다
select mbl_join_group('ABC234', 3, '3모둠 열정파', array['김하나','이두리','박세찬'], '0417');

-- 3) 학생: 데이터 저장 (group_id 는 2)에서 받은 id, 맨 뒤가 우리 모둠 PIN)
select mbl_save_data('ABC234', '여기에-group-uuid'::uuid,
  '[[0,20.1,20.0],[30,23.4,27.8],[60,26.0,34.9]]'::jsonb, '핫플레이트 3단', '0417');

-- 4) 학생: 보고서 저장 / 피드백
select mbl_save_report('ABC234', '여기에-group-uuid'::uuid, '{"q1":"가열 시간"}'::jsonb, 'done', '0417');
select mbl_send_feedback('ABC234', '보내는-group-uuid'::uuid, '받는-group-uuid'::uuid, 5, '그래프 설명이 깔끔했어요', '0417');

-- 4-1) ★ PIN 확인 — 틀린 PIN 으로 남의 모둠을 건드려 봅니다
select mbl_save_data('ABC234', '남의-group-uuid'::uuid, '[]'::jsonb, null, '9999');
--     → '모둠 비밀번호가 맞지 않습니다.' 예외가 나야 정상입니다.

-- 5) 공유 보드 / 변경감지 신호 / 교사 대시보드
select mbl_get_board('ABC234');          -- ← groups 안에 pin 이 없어야 정상입니다
select mbl_sig('ABC234');                -- ← 150바이트 안팎의 작은 json 이어야 정상
select mbl_admin_load('여기에-관리코드');
select mbl_admin_set('여기에-관리코드', 'present', null, 2, null);        -- 예전처럼 5개도 됩니다
select mbl_admin_set('여기에-관리코드', null, null, null, null, 30);      -- 보관 기한 30일 연장
select mbl_admin_list('여기에-관리코드');

-- 6) ★ 보안 확인 ① — 정책이 제대로 닫혔는지
--    SQL Editor 는 관리자 권한이라 표가 그냥 보입니다. 그래서 "정책 목록"으로 확인합니다.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename like 'mbl_%';
--    → cmd 가 SELECT 인 줄이 하나도 나오지 않아야 정상입니다.
--      (아무 줄도 안 나오는 것이 가장 정상입니다. mbl_lessons_read 같은 이름이 보이면
--       이 파일의 2번 블록이 실행되지 않은 것입니다.)

--    같이 확인하면 좋은 것: anon 에게 표 권한이 남아 있지 않은지
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee in ('anon','authenticated') and table_name like 'mbl_%';
--    → 한 줄도 나오지 않아야 정상입니다.

-- 7) ★ 보안 확인 ② — 실제 anon 키로 확인
--    브라우저 개발자도구 콘솔(수업허브 화면에서)에 아래를 붙여넣어 보세요.
--      await Hub.sb.from('mbl_groups').select('*')
--    → data 가 [] 이거나 권한 오류여야 정상입니다. 학생 이름이 보이면 안 됩니다.
insert into mbl_lessons (join_code) values ('HACK99');   -- ← anon 으로는 권한 오류여야 함

-- 8) 현황 요약
select l.join_code, l.title, l.class_label, l.phase,
       (select count(*) from mbl_groups  g where g.lesson_id=l.id) as 모둠,
       (select count(*) from mbl_data    d where d.lesson_id=l.id) as 데이터,
       (select count(*) from mbl_reports r where r.lesson_id=l.id and r.status='done') as 제출보고서,
       l.created_at, l.expires_at
  from mbl_lessons l order by l.created_at desc limit 20;

-- 9) ★ PIN 확인 — PIN 이 비어 있는 모둠이 있는지
select l.join_code, l.title, g.group_no, g.group_name
  from mbl_groups g join mbl_lessons l on l.id = g.lesson_id
 where g.pin is null or btrim(g.pin) = ''
 order by l.created_at desc, g.group_no;
--    → 한 줄도 나오지 않아야 정상입니다.
--      (나온다면 이 파일을 다시 Run 하세요. 1번의 update 문이 채워 줍니다.)

--    특정 수업의 모둠별 PIN 표 (칠판용)
select g.group_no as 모둠, g.group_name as 이름, g.pin as 비밀번호
  from mbl_groups g join mbl_lessons l on l.id = g.lesson_id
 where l.join_code = 'ABC234'
 order by g.group_no;

-- 10) ★ 보관 기한 확인 — 곧 지워질 수업(7일 이내) 과 이미 지난 수업
select l.join_code, l.title, l.class_label, l.teacher_name,
       l.expires_at,
       round(extract(epoch from (l.expires_at - now())) / 86400)::int as 남은일수,
       case when l.expires_at < now() then '기한 지남(다음 정리 때 삭제)' else '곧 만료' end as 상태
  from mbl_lessons l
 where l.expires_at < now() + interval '7 days'
 order by l.expires_at;
--    → 필요한 수업은 교사 대시보드의 [30일 연장] 이나 아래 SQL 로 늘리세요.
--      select mbl_admin_set('여기에-관리코드', null, null, null, null, 30);

-- 11) 기한 지난 수업 정리 (수업을 새로 만들 때도 자동으로 한 번 돕니다)
select mbl_cleanup();
--    특정 수업만 지금 바로 삭제 (되돌릴 수 없습니다)
select mbl_admin_delete('여기에-관리코드');
*/
