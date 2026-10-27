"""Run SQL regressions against a disposable local Postgres, never a remote database."""
import pathlib
import re
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]

schema = """
create role anon; create role authenticated;
create schema auth; create schema storage;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create function mast_has_permission(text) returns boolean language sql as $$ select coalesce(current_setting('test.permission',true)=$1,false) $$;
create function mast_current_legacy_id() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create table members(id uuid primary key, school text);
create table team_matching_members(id integer primary key,mast_member_id uuid references members,school text,role text,admin_sections text[],roster_status text,is_leader boolean,updated_at timestamptz);
create table promotion_mission_assignments(id uuid primary key,member_id uuid,mission_id uuid,status text,due_at timestamptz,late_until_at timestamptz,reviewed_at timestamptz,reviewed_by_member_id uuid,submitted_at timestamptz,status_reason text);
create table promotion_proofs(id uuid primary key default gen_random_uuid(),assignment_id uuid unique,mission_id uuid,member_id uuid,proof_file_path text,proof_image_url text,submitted_at timestamptz);
create table storage.objects(bucket_id text,name text);
"""
source = (root / 'supabase/server-auth-lockdown.sql').read_text()
guard = re.search(r'create or replace function public\.mast_guard_write\(\).*?end \$\$;', source, re.S).group()
triggers = """
create trigger mast_guard_write before insert or update on team_matching_members for each row execute function mast_guard_write();
create trigger mast_guard_write before insert or update on promotion_mission_assignments for each row execute function mast_guard_write();
"""
sql = schema + guard + triggers
for file in ['member-school-sync.sql', 'promotion-proof-submission.sql', 'promotion-integrity.test.sql']:
    sql += '\n' + (root / 'supabase' / file).read_text()
with tempfile.TemporaryDirectory(prefix='mast-pg-') as temporary:
    folder = pathlib.Path(temporary)
    data = folder / 'data'
    subprocess.run(['initdb', '-D', str(data), '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['pg_ctl', '-D', str(data), '-l', str(folder / 'postgres.log'), '-o', f'-k {folder} -h "" -p 55437', 'start'], check=True, stdout=subprocess.DEVNULL)
    try:
        subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', str(folder), '-p', '55437', '-d', 'postgres'], input=sql, text=True, check=True)
    finally:
        subprocess.run(['pg_ctl', '-D', str(data), 'stop'], check=True, stdout=subprocess.DEVNULL)
print('PASS: bidirectional school sync, permission denial and rollback, exemption, valid submission, duplicate resubmit, path ownership')
