begin;
select set_config('test.permission','promotion',true);
select set_config('test.role','authenticated',true);
update promotion_rotation_config set start_date=(now() at time zone 'Asia/Seoul')::date;
create temporary table original_history as select * from promotion_mission_assignments;
create temporary table test_missions(id uuid,round_no integer);
do $$
#variable_conflict use_column
declare ctx jsonb; j jsonb; result jsonb; expected uuid[]; r integer; day date; n integer; before_count integer; a promotion_mission_assignments%rowtype; proof_path text;
begin
 for r in 0..3 loop
  ctx:=mast_promotion_rotation();day:=(ctx->>'next_date')::date;
  select array_agg((t.members->t.idx->>'id')::uuid) into expected from (
   select s->'members' members,coalesce((select (ordinality::integer)%jsonb_array_length(s->'members') from jsonb_array_elements(s->'members') with ordinality where value->>'id'=s->>'last_member_id'),0) idx
   from jsonb_array_elements(ctx->'schools') s where s->>'group_code'=ctx->>'next_group'
  ) t;
  j:=jsonb_build_object('mission_date',day,'due_at',(day+1)::text||'T02:00:00+09:00','title','그룹 테스트','post_title','테스트 게시글','post_body','테스트 내용');
  result:=mast_save_promotion_round(j,r,expected);
  if result->>'rotation_group'<>substr('ABCA',r+1,1) then raise exception 'Wrong group'; end if;
  select count(*) into n from promotion_mission_assignments where mission_id=(result->>'id')::uuid;
  if n<>(case when r=2 then 12 else 13 end) then raise exception 'Wrong assigned count: %',n; end if;
  if exists(select 1 from promotion_mission_assignments a join members m on m.id=a.member_id join promotion_school_groups sg on sg.school_key=mast_promotion_school_key(m.school)
   where a.mission_id=(result->>'id')::uuid and sg.group_code<>result->>'rotation_group') then raise exception 'Resting group assigned'; end if;
  insert into test_missions values((result->>'id')::uuid,r);
  select count(*) into before_count from promotion_mission_assignments;
  if (mast_promotion_rotation()->>'next_date')::date<>day+1 then raise exception 'Daily next date did not advance one day';end if;
  perform mast_save_promotion_round(j,r,expected);
  if (mast_promotion_rotation()->>'next_round')::integer<>r+1 or (select count(*) from promotion_mission_assignments)<>before_count then raise exception 'Duplicate save consumed round or duplicated assignment'; end if;
 end loop;
 if not exists(select 1 from promotion_mission_assignments a join promotion_missions pm on pm.id=a.mission_id join members m on m.id=a.member_id where pm.rotation_round=2 and m.school='테스트-C-01' and m.name='회원55') then raise exception 'Approved initial Inha member mismatch'; end if;
 if not exists(select 1 from promotion_mission_assignments a join promotion_missions pm on pm.id=a.mission_id join members m on m.id=a.member_id where pm.rotation_round=3 and m.school='테스트-A-01' and m.name='회원02') then raise exception 'A return did not advance Gachon'; end if;
 ctx:=mast_promotion_rotation();
 begin
  perform mast_save_promotion_round(jsonb_build_object('mission_date',ctx->>'next_date','due_at',((ctx->>'next_date')::date+1)::text||'T02:00:00+09:00','title','오래된 화면','post_title','글'),0,'{}');
  raise exception 'Stale preview accepted';
 exception when raise_exception then if sqlerrm not like '%먼저 확정%' then raise;end if; end;
 select * into a from promotion_mission_assignments where mission_id=(select id from test_missions where round_no=0) limit 1;
 perform set_config('test.member',a.member_id::text,true);
 perform set_config('test.permission','none',true);
 proof_path:=a.member_id::text||'/rotation-qa.png';
 insert into storage.objects(bucket_id,name) values('proofs',proof_path);
 result:=mast_submit_promotion_proof(a.id,proof_path,false);
 if not (result->>'ok')::boolean or not exists(select 1 from promotion_proofs where assignment_id=a.id) then raise exception 'Proof submission failed'; end if;
 perform mast_submit_promotion_proof(a.id,proof_path,false);
 if (select count(*) from promotion_proofs where assignment_id=a.id)<>1 then raise exception 'Resubmission duplicated proof'; end if;
 perform set_config('test.member',(select id::text from members where id not in(select member_id from promotion_mission_assignments where mission_id=a.mission_id) limit 1),true);
 begin perform mast_submit_promotion_proof(a.id,proof_path,false);raise exception 'Resting member submitted proof';exception when insufficient_privilege then null;end;
 begin perform mast_save_promotion_round('{}',4,'{}');raise exception 'Non-admin assigned a mission';exception when insufficient_privilege then null;end;
 perform set_config('test.permission','promotion',true);
 update promotion_mission_assignments set status='exempted' where id=a.id;
 perform set_config('test.member',a.member_id::text,true);
 begin perform mast_submit_promotion_proof(a.id,proof_path,false);raise exception 'Exempted submitted proof';exception when insufficient_privilege then null;end;
 begin delete from promotion_mission_assignments where id=a.id;raise exception 'Confirmed assignment deleted';exception when raise_exception then if sqlerrm not like '%삭제할 수%' then raise;end if;end;
 begin delete from promotion_missions where id=a.mission_id;raise exception 'Confirmed mission deleted';exception when raise_exception then if sqlerrm not like '%삭제할 수%' then raise;end if;end;
 if exists(select * from original_history except select * from promotion_mission_assignments) then raise exception 'Historical assignments changed';end if;
end $$;
rollback;
