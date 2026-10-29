-- Isolated PostgreSQL compile/runtime harness only. This does not emulate Supabase's gateway,
-- JWT signature verification, Auth server or Storage HTTP API. Never run against a real project.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin noinherit; end if;
end $$;
grant anon,authenticated to authenticator;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub','')::uuid
$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.jwt(),auth.uid() to anon,authenticated;
create schema storage;
create table storage.buckets (
  id text primary key,name text not null,public boolean not null default false,
  file_size_limit bigint,allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
  name text not null,owner_id text,metadata jsonb default '{}'::jsonb,
  unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
