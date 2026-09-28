-- =====================================================================
--  MBL 수업허브 — 「모둠 비밀번호 없이 입장」 켜기 (2026-09-28)
-- =====================================================================
--  이미 schema.sql 을 적용해 쓰고 있는 Supabase 프로젝트에 한 번만 실행합니다.
--  Supabase → SQL Editor → 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 결과는 같습니다.
--  (새로 설치하는 학교는 schema.sql 에 이미 들어 있으므로 따로 실행하지 않아도 됩니다.)
--
--  ▣ 무엇이 바뀌나요
--    선생님이 수업을 만들 때 「모둠 비밀번호 쓰기」를 끄면(form.features.groupPin = false),
--    학생은 참여코드를 넣고 모둠을 고른 뒤 「모둠 탐구 공간 입장하기」만 누르면 됩니다.
--    그 수업에서는 저장할 때도 모둠 비밀번호를 묻지 않습니다.
--    ★ 그 대신 참여코드를 아는 학생은 다른 모둠 칸에도 들어가 고칠 수 있습니다.
--      장난이 걱정되거나 여러 차시에 걸쳐 모둠 자료를 이어 쓸 때는 「모둠 비밀번호 쓰기」를 켜 두세요.
--    값이 없는 예전 수업은 지금처럼 비밀번호를 씁니다. 켜고 끄는 것은 관리코드로만 할 수 있습니다.
--
--  ▣ 바꾸는 것
--    ① mbl_pin_error — 비밀번호 검사가 모두 이 함수 한 곳을 지나갑니다. 소속 확인 바로 뒤에서
--       그 수업이 비밀번호를 끈 수업인지 보고, 껐으면 통과시킵니다. 소속 확인은 그대로라
--       다른 수업의 모둠에는 여전히 쓸 수 없습니다.
--    ② mbl_features — 교사 화면이 「이 서버에 이 기능이 적용되었나」를 물어보는 자리(읽기 전용).
--       이 함수가 없는 서버면 교사 화면이 알려 주고 비밀번호를 쓰는 수업으로 만듭니다.
-- =====================================================================

create or replace function mbl_pin_error(p_lesson_id uuid, p_group_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g    mbl_groups;
  v_l    mbl_lessons;
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

  -- 선생님이 「모둠 비밀번호 쓰기」를 끄고 만든 수업(form.features.groupPin = false)은 비밀번호를 묻지 않습니다.
  --   소속 확인(위)은 그대로 하므로 다른 수업의 모둠에는 여전히 쓸 수 없습니다.
  select * into v_l from mbl_lessons l where l.id = p_lesson_id;
  if found and coalesce(v_l.form->'features'->>'groupPin', '') = 'false' then
    return null;
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
-- 내부 헬퍼는 학생 쪽(anon)에서 부를 수 없어야 합니다(부를 수 있으면 남의 모둠 PIN 을 찍어 볼 길이 생깁니다).
revoke execute on function mbl_pin_error(uuid, uuid, text) from public, anon, authenticated;

-- 서버가 아는 기능 — 교사 화면이 물어봅니다. 아무것도 바꾸지 않습니다.
create or replace function mbl_features()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('openGroups', true);
$$;
grant execute on function mbl_features() to anon, authenticated;

-- 자가검증 — mbl_pin_error 가 anon 에게 열려 있지 않은지
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.role_routine_grants
   where specific_schema = 'public'
     and routine_name = 'mbl_pin_error'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n > 0 then
    raise exception 'mbl_pin_error 가 아직 anon 에게 열려 있습니다. Supabase SQL Editor 에서 소유자(postgres)로 다시 실행해 주세요.';
  end if;
end $$;

select mbl_features() as "적용 확인 — openGroups 가 true 면 끝";
