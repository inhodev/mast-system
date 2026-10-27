begin;
create or replace function public.mast_submit_promotion_proof(p_assignment_id uuid,p_file_path text,p_skipped boolean default false)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare a public.promotion_mission_assignments%rowtype; mid uuid:=public.mast_current_legacy_id(); proof_id uuid;
begin
 if mid is null then raise exception '로그인을 확인해 주세요.' using errcode='42501'; end if;
 select * into a from public.promotion_mission_assignments where id=p_assignment_id and member_id=mid for update;
 if not found then raise exception '본인에게 배정된 미션만 제출할 수 있습니다.' using errcode='42501'; end if;
 if a.status='exempted' then raise exception '면제된 미션입니다.' using errcode='42501'; end if;
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
commit;
