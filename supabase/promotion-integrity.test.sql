begin;
insert into members(id,school) values ('00000000-0000-0000-0000-000000000001','학교 A');
insert into team_matching_members(id,mast_member_id,school) values (1,'00000000-0000-0000-0000-000000000001','학교 A');

select set_config('test.role','authenticated',true);
select set_config('test.permission','members',true);
update team_matching_members set school='학교 B' where id=1;
do $$ begin
 if (select school from members limit 1)<>'학교 B' then raise exception 'App to promotion school sync failed'; end if;
end $$;
update members set school='학교 C';
do $$ begin
 if (select school from team_matching_members where id=1)<>'학교 C' then raise exception 'Promotion to app school sync failed'; end if;
end $$;

select set_config('test.permission','promotion',true);
do $$ begin
 begin
  update members set school='Unauthorized school';
  raise exception 'School permissions widened unexpectedly';
 exception when insufficient_privilege then null;
 end;
 if (select school from members limit 1)<>'학교 C' or (select school from team_matching_members where id=1)<>'학교 C' then
  raise exception 'Failed school update was not atomic';
 end if;
end $$;

select set_config('test.role','service_role',true);
insert into promotion_mission_assignments(id,member_id,mission_id,status,late_until_at)
 values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','exempted',now()+interval '1 day');
insert into storage.objects(bucket_id,name) values ('proofs','00000000-0000-0000-0000-000000000001/proof.png');
select set_config('test.role','authenticated',true);
select set_config('test.permission','none',true);
do $$ begin
 begin
  perform mast_submit_promotion_proof('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001/proof.png');
  raise exception 'Exempted proof incorrectly accepted';
 exception when insufficient_privilege then
  if sqlerrm not like '%면제%' then raise; end if;
 end;
 if exists(select 1 from promotion_proofs) then raise exception 'Exempted proof saved'; end if;
end $$;
select set_config('test.role','service_role',true);
update promotion_mission_assignments set status='pending';
select set_config('test.role','authenticated',true);
do $$ declare result jsonb; begin
 result:=mast_submit_promotion_proof('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001/proof.png');
 if not (result->>'ok')::boolean then raise exception 'Valid proof failed'; end if;
 if (select count(*) from promotion_proofs)<>1 or (select status from promotion_mission_assignments limit 1)<>'submitted' then raise exception 'Submission not atomic'; end if;
 perform mast_submit_promotion_proof('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001/proof.png');
 if (select count(*) from promotion_proofs)<>1 then raise exception 'Duplicate proof'; end if;
 begin
  perform mast_submit_promotion_proof('00000000-0000-0000-0000-000000000002','other/proof.png');
  raise exception 'Other member path accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
