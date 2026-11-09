"""Exercise group assignments, proof submission and rollback in disposable PostgreSQL."""
import pathlib,subprocess,tempfile,uuid
root=pathlib.Path(__file__).resolve().parents[1]
evidence=root.parent/'promotion-rollout-20261109'
def literal(v): return "'"+str(v).replace("'","''")+"'"
sql="""
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create function mast_has_permission(text) returns boolean language sql as $$ select coalesce(current_setting('test.permission',true)=$1,false) $$;
create function mast_current_legacy_id() returns uuid language sql as $$ select nullif(current_setting('test.member',true),'')::uuid $$;
create table members(id uuid primary key,name text,gi text,school text,status text);
create table promotion_missions(id uuid primary key default gen_random_uuid(),mission_date date unique,title text,body text,post_title text,post_body text,due_at timestamptz,late_until_at timestamptz,status text,created_by text,mission_image_url text,mission_image_path text);
create table promotion_mission_assignments(id uuid primary key default gen_random_uuid(),member_id uuid,mission_id uuid references promotion_missions,status text,due_at timestamptz,late_until_at timestamptz,reviewed_at timestamptz,reviewed_by_member_id uuid,submitted_at timestamptz,status_reason text, unique(mission_id,member_id));
create table promotion_proofs(id uuid primary key default gen_random_uuid(),assignment_id uuid unique,mission_id uuid,member_id uuid,proof_file_path text,proof_image_url text,submitted_at timestamptz);
create table storage.objects(bucket_id text,name text);
"""
sql+=(root/'supabase/promotion-school-canonical.sql').read_text().split('update public.members')[0].replace('begin;','')
# Existing canonical script also performs roster writes; only its immutable function is needed here.
sql=sql[:sql.index('create or replace function public.mast_canonical_school')]+(root/'supabase/promotion-school-canonical.sql').read_text().split('$$;')[0].replace('begin;','')+'$$;\n'
seeds=[]; member_no=0
for group,sizes in [('A',[7,3,3,2,2,2,2,1,1,1,1,1,1]),('B',[7,3,3,2,2,2,2,1,1,1,1,1,1]),('C',[5,5,3,3,2,2,1,1,1,1,1,1])]:
 for school_no,size in enumerate(sizes,1):
  school=f'테스트-{group}-{school_no:02}';ids=[]
  for _ in range(size):
   member_no+=1;mid=str(uuid.UUID(int=member_no));ids.append(mid)
   sql+='insert into members values('+','.join(literal(v) for v in [mid,f'회원{member_no:02}','1기',school,'active'])+');\n'
  seeds.append('('+','.join([literal(school.lower()),literal(school),literal(group),'array['+','.join(literal(v)+'::uuid' for v in ids)+']'])+')')
sql+=(root/'supabase/promotion-group-rotation.sql').read_text()
sql+=(root/'supabase/promotion-daily-rotation.sql').read_text()
sql+='insert into promotion_school_groups values '+','.join(seeds)+';\n'
sql+=(root/'supabase/promotion-proof-submission.sql').read_text()
sql+=(root/'supabase/promotion-group-rotation.test.sql').read_text()
with tempfile.TemporaryDirectory(prefix='mast-groups-pg-') as tmp:
 folder=pathlib.Path(tmp);data=folder/'data'
 subprocess.run(['initdb','-D',str(data),'-A','trust','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['pg_ctl','-D',str(data),'-l',str(folder/'postgres.log'),'-o',f'-k {folder} -h "" -p 55438','start'],check=True,stdout=subprocess.DEVNULL)
 try:
  subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-h',str(folder),'-p','55438','-d','postgres'],input=sql,text=True,check=True,stdout=subprocess.DEVNULL)
 finally:subprocess.run(['pg_ctl','-D',str(data),'stop'],check=True,stdout=subprocess.DEVNULL)
print('PASS: A/B/C/A, 13/13/12, seeded member order, duplicate save, no rest assignments, stale preview rejection, proof/exemption/ownership, history preservation, rollback')
