begin;
create or replace function public.mast_canonical_school(p_school text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case
  when key ~ '^연세대(학교)?미래$' then '연세대학교(미래)'
  when key ~ '^한양대(학교)?(erica|에리카)$' then '한양대학교 ERICA'
  when key='고려대학교세종' then '고려대학교(세종)'
  when key='단국대학교천안' then '단국대학교(천안)'
  when key='홍익대학교세종' then '홍익대학교(세종)'
  when key='강원대학교춘천' then '강원대학교(춘천)'
  when key='상명대학교서울' then '상명대학교(서울)'
  when key='동국대학교서울' then '동국대학교'
  when key='서울홍익대학교' then '홍익대학교'
  when key='한경국립대' then '한경국립대학교'
  else trim(p_school) end
 from (select regexp_replace(regexp_replace(lower(coalesce(p_school,'')),'[[:space:]()（）]','','g'),'캠퍼스|캠','','g') key) normalized
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
