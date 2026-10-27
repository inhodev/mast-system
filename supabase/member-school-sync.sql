begin;

create or replace function public.mast_sync_member_school()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.school is not distinct from old.school then return new; end if;
 if tg_table_name='team_matching_members' then
  update public.members set school=new.school
   where id=new.mast_member_id and school is distinct from new.school;
 else
  if exists(select 1 from public.team_matching_members where mast_member_id=new.id) then
   if auth.role()='authenticated' and not public.mast_has_permission('members') then
    raise exception '연결된 회원의 학교 변경은 회원 관리 권한이 필요합니다. 회원 관리에서 변경해 주세요.' using errcode='42501';
   end if;
   update public.team_matching_members set school=new.school
    where mast_member_id=new.id and school is distinct from new.school;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.mast_sync_member_school() from public,anon,authenticated;

drop trigger if exists mast_sync_member_school on public.team_matching_members;
create trigger mast_sync_member_school after update of school on public.team_matching_members
 for each row execute function public.mast_sync_member_school();
drop trigger if exists mast_sync_member_school on public.members;
create trigger mast_sync_member_school after update of school on public.members
 for each row execute function public.mast_sync_member_school();

commit;
