-- Run after001–007 on either public-pgcrypto or extensions-pgcrypto; synthetic transaction rolls back.
begin;
set local timezone='UTC';

insert into auth.users(id) values
  ('77000000-0000-4000-8000-000000000001'),('77000000-0000-4000-8000-000000000002');
insert into public.admin_users(id,role) values
  ('77000000-0000-4000-8000-000000000001','OWNER'),('77000000-0000-4000-8000-000000000002','OPERATIONS');

do $$
declare implementation pg_proc%rowtype;
begin
  select * into implementation from pg_proc
    where oid='public.publish_admin_contract(text,text,timestamptz,text,text,text)'::regprocedure;
  if not implementation.prosecdef
    or array_position(implementation.proconfig,'search_path=public, pg_temp') is null
    or position('pg_catalog.sha256' in implementation.prosrc)=0
    or position('digest(' in implementation.prosrc)>0
  then raise exception 'contract hash implementation or strict boundary changed'; end if;
  if has_function_privilege('anon',implementation.oid,'EXECUTE')
    or has_function_privilege('app_outbox_worker',implementation.oid,'EXECUTE')
    or not has_function_privilege('authenticated',implementation.oid,'EXECUTE')
  then raise exception 'contract execute boundary changed'; end if;
end;
$$;

set local role authenticated;
do $$
declare instant bigint:=floor(extract(epoch from statement_timestamp())); claims jsonb;
  published jsonb; replay jsonb; second_contract jsonb;
begin
  claims:=jsonb_build_object('role','authenticated','sub','77000000-0000-4000-8000-000000000001',
    'aal','aal2','exp',instant+300,'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',instant)));
  perform set_config('request.jwt.claims',claims::text,true);
  published:=public.publish_admin_contract('Synthetic ASCII contract','abc',statement_timestamp(),
    'hash-portability-ascii',repeat('a',64),'hash-portability');
  if published ->> 'contentHash'<>'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    or published ->> 'content'<>'abc'
  then raise exception 'ASCII contract hash/content mismatch'; end if;
  replay:=public.publish_admin_contract('Synthetic ASCII contract','abc',statement_timestamp(),
    'hash-portability-ascii',repeat('a',64),'hash-portability');
  if replay is distinct from published then raise exception 'contract replay changed'; end if;
  second_contract:=public.publish_admin_contract('Synthetic UTF8 contract','สัญญาทดสอบ',statement_timestamp(),
    'hash-portability-utf8',repeat('b',64),'hash-portability');
  -- Expected UTF-8 vector independently computed with Node.js createHash('sha256').
  if second_contract ->> 'contentHash'<>'0eec887090d9caf92ea51904515d41b21a8dfc341feebf068070154b51405f8a'
    or second_contract ->> 'content'<>'สัญญาทดสอบ'
  then raise exception 'UTF8 contract hash/content mismatch'; end if;
  perform set_config('request.jwt.claims',jsonb_set(claims,'{sub}','"77000000-0000-4000-8000-000000000002"')::text,true);
  begin
    perform public.publish_admin_contract('Denied operations','abc',statement_timestamp(),
      'hash-portability-denied',repeat('c',64),'hash-portability');
    raise exception 'operations published an owner-only contract';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_set(claims,'{amr}',
    jsonb_build_array(jsonb_build_object('method','totp','timestamp',instant-601)))::text,true);
  begin
    perform public.publish_admin_contract('Denied stale MFA','abc',statement_timestamp(),
      'hash-portability-stale',repeat('d',64),'hash-portability');
    raise exception 'stale MFA published a contract';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.contract_versions where published_by='77000000-0000-4000-8000-000000000001')<>2
    or (select count(*) from public.audit_events where request_id='hash-portability')<>2
    or (select count(*) from public.idempotency_records where idempotency_key like 'hash-portability-%')<>2
  then raise exception 'contract retry/denial left unexpected side effects'; end if;
end;
$$;
rollback;
