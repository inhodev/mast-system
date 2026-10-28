begin;
create or replace function public.mast_canonical_school(p_school text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case when regexp_replace(coalesce(p_school,''),'\s','','g') ~ '^연세대(학교)?.*미래'
  then '연세대학교(미래)' else p_school end;
$$;
create or replace function public.mast_normalize_member_school()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 new.school:=public.mast_canonical_school(new.school);
 return new;
end $$;
revoke all on function public.mast_normalize_member_school() from public,anon,authenticated;
grant execute on function public.mast_canonical_school(text) to authenticated,service_role;
drop trigger if exists mast_normalize_member_school on public.members;
create trigger mast_normalize_member_school before insert or update of school on public.members
 for each row execute function public.mast_normalize_member_school();
drop trigger if exists mast_normalize_member_school on public.team_matching_members;
create trigger mast_normalize_member_school before insert or update of school on public.team_matching_members
 for each row execute function public.mast_normalize_member_school();
update public.members set school=public.mast_canonical_school(school)
 where school is distinct from public.mast_canonical_school(school);
update public.team_matching_members set school=public.mast_canonical_school(school)
 where school is distinct from public.mast_canonical_school(school);
commit;
