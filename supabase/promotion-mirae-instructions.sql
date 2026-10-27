begin;
do $$
declare
 old_body text := E'각 학교의 에브리타임 게시판 기준으로, 우리 동아리 게시글이 최신 상단에 5개 안에 포함되어 있을 경우, 추가 업로드를 하지 않으셔도 됩니다.\n\n홍보 사이트 캡처본 업로드 시, 해당 게시판의 최신 글 목록이 보이도록 캡처본을 보내주시면 홍보를 진행한 것으로 인정하여 카운팅하겠습니다.\n\n감사합니다!';
 new_body text := E'연세대학교 미래캠퍼스에만 적용되는 안내입니다.\n\n본인 홍보 차례에 MAST 게시글이 에브리타임 동아리/학회 게시판의 최신 상단 5개 안에 있으면 새 글은 작성하지 않아도 됩니다. 대신 기존 MAST 글과 최신 글 목록이 보이는 캡처를 반드시 제출해 주세요. 인증 화면에서 “기존 게시글로 인증 (새 글 작성만 면제)”을 선택하면 됩니다.\n\n캡처 확인 후 정상 홍보 참여로 인정합니다. 새 글 작성만 면제되는 것이며, 캡처 인증 제출은 필수입니다.\n\n다른 학교는 본인이 작성한 홍보글의 캡처를 제출해 주세요.';
begin
 update public.team_matching_announcements set body=new_body
  where id=5 and title='📢 에브리타임 홍보 관련 안내' and body=old_body;
 if not found and not exists(select 1 from public.team_matching_announcements where id=5 and body=new_body) then
  raise exception '홍보 안내 내용이 변경되어 자동 수정을 중단했습니다.';
 end if;
end $$;
commit;
