begin;
create table if not exists public.promotion_rotation_config (
 id boolean primary key default true check (id), start_date date not null, interval_days integer not null default 3 check(interval_days=3)
);
create table if not exists public.promotion_school_groups (
 school_key text primary key, school_name text not null, group_code text not null check(group_code in ('A','B','C')),
 member_order uuid[] not null check(cardinality(member_order)>0)
);
alter table public.promotion_missions add column if not exists rotation_round integer unique;
alter table public.promotion_missions add column if not exists rotation_group text check(rotation_group in ('A','B','C'));
alter table public.promotion_mission_assignments add column if not exists rotation_school text;
alter table public.promotion_rotation_config enable row level security;
alter table public.promotion_school_groups enable row level security;
revoke all on public.promotion_rotation_config,public.promotion_school_groups from anon,authenticated;
grant select on public.promotion_rotation_config,public.promotion_school_groups to authenticated;
drop policy if exists rotation_read on public.promotion_rotation_config;
create policy rotation_read on public.promotion_rotation_config for select to authenticated using(public.mast_current_legacy_id() is not null or public.mast_has_permission('promotion'));
drop policy if exists rotation_read on public.promotion_school_groups;
create policy rotation_read on public.promotion_school_groups for select to authenticated using(public.mast_current_legacy_id() is not null or public.mast_has_permission('promotion'));
insert into public.promotion_rotation_config(id,start_date) values(true,'2026-11-10') on conflict(id) do nothing;

create or replace function public.mast_promotion_school_key(p_school text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select lower(regexp_replace(public.mast_canonical_school(p_school),'\s','','g'))
$$;


-- Only the migration and authenticated server RPC can establish a round.
create or replace function public.mast_guard_promotion_round()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare protected boolean; start_day date; target_group text;
begin
 if tg_table_name='promotion_missions' then
  if tg_op='DELETE' then
   if old.rotation_round is not null then raise exception '조별 미션은 배정과 인증 이력 보존을 위해 삭제할 수 없습니다.'; end if;
   return old;
  end if;
  select start_date into start_day from promotion_rotation_config where id;
  if tg_op='INSERT' and new.mission_date>=start_day and current_setting('mast.rotation_write',true) is distinct from 'on' then
   raise exception '조별 미션 확정 기능으로 등록해 주세요.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.rotation_round is distinct from old.rotation_round or new.rotation_group is distinct from old.rotation_group or
      (old.rotation_round is not null and (new.mission_date is distinct from old.mission_date or new.status is distinct from old.status))) then
   raise exception '확정한 조·회차·홍보일은 변경할 수 없습니다. 기존 배정과 인증은 유지됩니다.';
  end if;
  return new;
 end if;
 if tg_op='DELETE' then
  select rotation_round is not null into protected from promotion_missions where id=old.mission_id;
  if protected then raise exception '조별 배정 이력은 삭제할 수 없습니다.'; end if;
  return old;
 end if;
 select rotation_group into target_group from promotion_missions where id=new.mission_id;
 if target_group is not null then
  if tg_op='INSERT' and (current_setting('mast.rotation_write',true) is distinct from 'on' or not exists(
   select 1 from promotion_school_groups where school_key=new.rotation_school and promotion_school_groups.group_code=target_group
  )) then raise exception '이번 조에 확정한 학교 담당자만 배정할 수 있습니다.' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.mission_id is distinct from old.mission_id or new.member_id is distinct from old.member_id or new.rotation_school is distinct from old.rotation_school) then
   raise exception '확정된 배정 대상은 변경할 수 없습니다.' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists mast_guard_promotion_round on public.promotion_missions;
create trigger mast_guard_promotion_round before insert or update or delete on public.promotion_missions for each row execute function public.mast_guard_promotion_round();
drop trigger if exists mast_guard_promotion_round on public.promotion_mission_assignments;
create trigger mast_guard_promotion_round before insert or update or delete on public.promotion_mission_assignments for each row execute function public.mast_guard_promotion_round();
create unique index if not exists promotion_one_school_per_round on public.promotion_mission_assignments(mission_id,rotation_school) where rotation_school is not null;

-- Used for both admin preview and the member's personal schedule. No draft advances the cursor.
create or replace function public.mast_promotion_rotation()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg promotion_rotation_config%rowtype; next_round integer; next_day date; schools jsonb; rounds jsonb;
begin
 if mast_current_legacy_id() is null and not mast_has_permission('promotion') then raise exception '로그인을 확인해 주세요.' using errcode='42501'; end if;
 select * into strict cfg from promotion_rotation_config where id;
 select coalesce(max(rotation_round)+1,0) into next_round from promotion_missions;
 select greatest(cfg.start_date+next_round*cfg.interval_days,coalesce(max(mission_date)+cfg.interval_days,cfg.start_date)) into next_day
  from promotion_missions where rotation_round is not null;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.group_code,t.school_name),'[]'::jsonb) into schools from (
  select sg.*,coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'gi',m.gi,'school',m.school) order by array_position(sg.member_order,m.id) nulls last,m.name collate "C",m.gi,m.id)
    from members m where m.status='active' and mast_promotion_school_key(m.school)=sg.school_key),'[]'::jsonb) as members,
   (select a.member_id from promotion_mission_assignments a join promotion_missions pm on pm.id=a.mission_id
    where a.rotation_school=sg.school_key and pm.rotation_round is not null order by pm.rotation_round desc limit 1) as last_member_id
  from promotion_school_groups sg
 ) t;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'mission_date',mission_date,'rotation_round',rotation_round,'rotation_group',rotation_group) order by rotation_round),'[]'::jsonb)
 into rounds from promotion_missions where rotation_round is not null;
 return jsonb_build_object('start_date',cfg.start_date,'interval_days',cfg.interval_days,'next_round',next_round,'next_group',substr('ABC',next_round%3+1,1),'next_date',next_day,'schools',schools,'rounds',rounds);
end $$;

create or replace function public.mast_save_promotion_round(p_mission jsonb,p_expected_round integer,p_expected_member_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; saved promotion_missions%rowtype; day date; due timestamptz; late_limit timestamptz; grp text;
 sg jsonb; roster jsonb; selected_member uuid; last_id uuid; idx integer; picks uuid[]:='{}'; keys text[]:='{}'; n integer; i integer;
begin
 if not mast_has_permission('promotion') then raise exception '홍보 관리 권한이 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('mast_promotion_rotation'));
 ctx:=mast_promotion_rotation(); day:=(p_mission->>'mission_date')::date; due:=(p_mission->>'due_at')::timestamptz; late_limit:=due+interval '24 hours';
 if day is null or due is null or due<(day::timestamp at time zone 'Asia/Seoul') or nullif(trim(p_mission->>'title'),'') is null or nullif(trim(p_mission->>'post_title'),'') is null then
  raise exception '홍보일·마감·미션명·게시글 제목을 확인해 주세요.';
 end if;
 select * into saved from promotion_missions where mission_date=day for update;
 if found then
  if saved.rotation_round is null then raise exception '기존 미션은 과거 기록에서 수정해 주세요. 배정과 인증은 유지됩니다.'; end if;
  -- A repeated save is idempotent and never recreates assignments or advances the group.
  update promotion_missions set title=trim(p_mission->>'title'),body=p_mission->>'body',post_title=trim(p_mission->>'post_title'),post_body=p_mission->>'post_body',
   due_at=due,late_until_at=late_limit,mission_image_url=p_mission->>'mission_image_url',mission_image_path=p_mission->>'mission_image_path'
   where id=saved.id returning * into saved;
  update promotion_mission_assignments set due_at=due,late_until_at=late_limit where mission_id=saved.id;
  return to_jsonb(saved);
 end if;
 if day<(ctx->>'next_date')::date then raise exception '다음 홍보일보다 이르게 확정할 수 없습니다.'; end if;
 if p_expected_round is distinct from (ctx->>'next_round')::integer then raise exception '다른 운영진이 먼저 확정했습니다. 새로고침해 주세요.'; end if;
 grp:=ctx->>'next_group';
 for sg in select value from jsonb_array_elements(ctx->'schools') where value->>'group_code'=grp loop
  roster:=sg->'members';n:=jsonb_array_length(roster);
  if n=0 then raise exception '% 학교에 활동 회원이 없습니다. 조 편성을 확인해 주세요.',sg->>'school_name'; end if;
  last_id:=nullif(sg->>'last_member_id','')::uuid;idx:=0;
  if last_id is not null then
   for i in 0..n-1 loop if (roster->i->>'id')::uuid=last_id then idx:=(i+1)%n;exit;end if; end loop;
  end if;
  selected_member:=(roster->idx->>'id')::uuid;
  picks:=array_append(picks,selected_member);keys:=array_append(keys,sg->>'school_key');
 end loop;
 if cardinality(picks)=0 then raise exception '이번 조에 배정할 학교가 없습니다.'; end if;
 if (select array_agg(x order by x) from unnest(p_expected_member_ids) x) is distinct from (select array_agg(x order by x) from unnest(picks) x) then
  raise exception '배정 명단이 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
 end if;
 perform set_config('mast.rotation_write','on',true);
 insert into promotion_missions(mission_date,title,body,post_title,post_body,due_at,late_until_at,status,created_by,mission_image_url,mission_image_path,rotation_round,rotation_group)
 values(day,trim(p_mission->>'title'),p_mission->>'body',trim(p_mission->>'post_title'),p_mission->>'post_body',due,late_limit,'active',p_mission->>'created_by',p_mission->>'mission_image_url',p_mission->>'mission_image_path',p_expected_round,grp) returning * into saved;
 for i in 1..cardinality(picks) loop
  insert into promotion_mission_assignments(mission_id,member_id,status,due_at,late_until_at,status_reason,rotation_school)
  values(saved.id,picks[i],'pending',due,late_limit,grp||'조 확정 배정',keys[i]);
 end loop;
 perform set_config('mast.rotation_write','off',true);
 return to_jsonb(saved);
end $$;
revoke all on function public.mast_promotion_rotation(),public.mast_save_promotion_round(jsonb,integer,uuid[]) from public,anon;
grant execute on function public.mast_promotion_rotation(),public.mast_save_promotion_round(jsonb,integer,uuid[]) to authenticated;

create or replace function public.mast_submit_promotion_proof(p_assignment_id uuid,p_file_path text,p_skipped boolean default false)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare a public.promotion_mission_assignments%rowtype; mid uuid:=public.mast_current_legacy_id(); proof_id uuid;
begin
 if mid is null then raise exception '로그인을 확인해 주세요.' using errcode='42501'; end if;
 select * into a from public.promotion_mission_assignments where id=p_assignment_id and member_id=mid for update;
 if not found then raise exception '본인에게 배정된 미션만 제출할 수 있습니다.' using errcode='42501'; end if;
 if a.status='exempted' then raise exception '면제된 미션입니다.' using errcode='42501'; end if;
 if exists(select 1 from public.promotion_missions where id=a.mission_id and rotation_round is not null and mission_date>(now() at time zone 'Asia/Seoul')::date) then raise exception '홍보일이 되면 인증을 제출할 수 있습니다.'; end if;
 if a.status not in ('assigned','pending','rejected','submitted') then raise exception '본인 인증 제출 상태가 변경되었습니다.' using errcode='42501'; end if;
 if a.late_until_at is not null and now()>a.late_until_at then raise exception '인증 제출 시간이 지났습니다.'; end if;
 if p_skipped and not exists(
  select 1 from public.members where id=mid
   and regexp_replace(coalesce(school,''),'\s','','g') ~ '^연세대(학교)?.*미래'
 ) then raise exception '기존 게시글 인증은 연세대학교 미래캠퍼스만 가능합니다.' using errcode='42501'; end if;
 if p_file_path is null or split_part(p_file_path,'/',1)<>mid::text then raise exception '본인 사진 경로를 확인해 주세요.' using errcode='42501'; end if;
 if not exists(select 1 from storage.objects where bucket_id='proofs' and name=p_file_path) then raise exception '업로드된 사진을 찾지 못했습니다.'; end if;
 insert into public.promotion_proofs(assignment_id,mission_id,member_id,proof_file_path,proof_image_url,submitted_at)
 values(a.id,a.mission_id,mid,p_file_path,'https://forcmszeljtghqhfoinf.supabase.co/storage/v1/object/public/proofs/'||p_file_path,now())
 on conflict(assignment_id) do update set proof_file_path=excluded.proof_file_path,proof_image_url=excluded.proof_image_url,submitted_at=excluded.submitted_at
 returning id into proof_id;
 update public.promotion_mission_assignments set status='submitted',submitted_at=now(),status_reason=case when p_skipped then '기존 게시글 캡처 인증(연세대학교 미래캠퍼스)' else null end where id=a.id;
 return jsonb_build_object('ok',true,'proof_id',proof_id);
end $$;
revoke all on function public.mast_submit_promotion_proof(uuid,text,boolean) from public,anon;
grant execute on function public.mast_submit_promotion_proof(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';

notify pgrst,'reload schema';
commit;
