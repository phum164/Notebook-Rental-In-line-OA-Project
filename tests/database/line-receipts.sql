-- Run after migrations + seed. All synthetic writes roll back.
begin;
set local app.settings.customer_jwt_issuer = 'https://notebookrental.test';
set local app.settings.customer_jwt_audience = 'authenticated';

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%',message; end if; end;
$$;

create function pg_temp.claims(principal text, db_role text, scope text, lifetime integer) returns jsonb language sql as $$
  select jsonb_build_object('iss','https://notebookrental.test','aud','authenticated',
    'role',db_role,'principal_type',principal,'scope',scope,
    'sub','90000000-0000-4000-8000-000000000001','jti','90000000-0000-4000-8000-000000000002',
    'iat',floor(extract(epoch from statement_timestamp())),
    'nbf',floor(extract(epoch from statement_timestamp())),
    'exp',floor(extract(epoch from statement_timestamp())) + lifetime)
$$;

-- Every required service/customer claim must reject absent, JSON null and wrong type values.
do $$
declare claims jsonb := pg_temp.claims('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60);
  customer jsonb; field text; invalid jsonb; replacement jsonb;
begin
  perform set_config('request.jwt.claims',claims::text,true);
  perform pg_temp.assert_true(public._service_scope('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60),'valid ingress denied');
  foreach field in array array['principal_type','role','scope','iss','aud','sub','jti','iat','nbf','exp'] loop
    foreach replacement in array array['null'::jsonb,'{}'::jsonb] loop
      invalid := jsonb_set(claims,array[field],replacement);
      perform set_config('request.jwt.claims',invalid::text,true);
      perform pg_temp.assert_true(not public._service_scope('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60),'invalid service claim accepted: ' || field);
    end loop;
    perform set_config('request.jwt.claims',(claims - field)::text,true);
    perform pg_temp.assert_true(not public._service_scope('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60),'missing service claim accepted: ' || field);
  end loop;
  foreach invalid in array array[
    claims || '{"scope":"line:webhook:process"}'::jsonb,
    claims || jsonb_build_object('exp',floor(extract(epoch from statement_timestamp())) + 61),
    claims || jsonb_build_object('nbf',floor(extract(epoch from statement_timestamp())) + 31),
    claims || jsonb_build_object('exp',floor(extract(epoch from statement_timestamp())) - 1)
  ] loop
    perform set_config('request.jwt.claims',invalid::text,true);
    perform pg_temp.assert_true(not public._service_scope('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60),'invalid service time/scope accepted');
  end loop;
  customer := (claims - array['scope','jti']) || '{"principal_type":"customer","role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}'::jsonb;
  perform set_config('request.jwt.claims',customer::text,true);
  perform pg_temp.assert_true(public.current_customer_id() = '10000000-0000-4000-8000-000000000001'::uuid,'valid customer denied');
  foreach field in array array['principal_type','role','iss','aud','sub','iat','nbf','exp'] loop
    foreach replacement in array array['null'::jsonb,'{}'::jsonb] loop
      perform set_config('request.jwt.claims',jsonb_set(customer,array[field],replacement)::text,true);
      perform pg_temp.assert_true(public.current_customer_id() is null,'invalid customer claim accepted: ' || field);
    end loop;
    perform set_config('request.jwt.claims',(customer - field)::text,true);
    perform pg_temp.assert_true(public.current_customer_id() is null,'missing customer claim accepted: ' || field);
  end loop;
end;
$$;

insert into auth.users(id) values ('70000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.admin_users(id,role) values ('70000000-0000-4000-8000-000000000001','OWNER') on conflict do nothing;
do $$
declare claims jsonb := '{"role":"authenticated","sub":"70000000-0000-4000-8000-000000000001","aal":"aal2"}'; field text;
begin
  perform set_config('request.jwt.claims',claims::text,true);
  perform pg_temp.assert_true(public.current_admin_id() is not null,'valid provider admin denied');
  foreach field in array array['role','sub','aal'] loop
    perform set_config('request.jwt.claims',(claims - field)::text,true);
    perform pg_temp.assert_true(public.current_admin_id() is null,'missing admin claim accepted: ' || field);
    perform set_config('request.jwt.claims',jsonb_set(claims,array[field],'null')::text,true);
    perform pg_temp.assert_true(public.current_admin_id() is null,'null admin claim accepted: ' || field);
  end loop;
  perform set_config('request.jwt.claims',(claims || '{"principal_type":"customer"}'::jsonb)::text,true);
  perform pg_temp.assert_true(public.current_admin_id() is null,'customer substituted for admin');
  perform set_config('request.jwt.claims',(claims || '{"role":"app_line_webhook_worker"}'::jsonb)::text,true);
  perform pg_temp.assert_true(public.current_admin_id() is null,'worker substituted for admin');
end;
$$;

do $$
declare db_role text; table_name text;
begin
  foreach db_role in array array['app_line_webhook_ingress','app_line_webhook_worker'] loop
    perform pg_temp.assert_true(not (select rolcanlogin or rolsuper or rolbypassrls from pg_roles where rolname = db_role),'overprivileged LINE role');
    for table_name in select schemaname || '.' || tablename from pg_tables where schemaname in ('public','storage') loop
      perform pg_temp.assert_true(not has_table_privilege(db_role,table_name,'SELECT,INSERT,UPDATE,DELETE'),'direct table grant: ' || db_role || '/' || table_name);
    end loop;
  end loop;
  foreach db_role in array array['anon','authenticated','app_session_service','app_outbox_worker','app_upload_scanner','app_line_webhook_worker'] loop
    perform pg_temp.assert_true(not has_function_privilege(db_role,'public.persist_line_webhook_receipts(jsonb)','EXECUTE'),'wrong role can persist receipts: ' || db_role);
  end loop;
  foreach db_role in array array['anon','authenticated','app_session_service','app_outbox_worker','app_upload_scanner','app_line_webhook_ingress'] loop
    perform pg_temp.assert_true(not has_function_privilege(db_role,'public.claim_line_webhook_receipts(integer)','EXECUTE'),'wrong role can claim receipts: ' || db_role);
  end loop;
end;
$$;

select set_config('request.jwt.claims',pg_temp.claims('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60)::text,true);
set local role app_line_webhook_ingress;
do $$
declare events jsonb := '[{"providerEventId":"synthetic-event-1","eventType":"follow","occurredAt":"2026-10-26T00:00:00Z","payloadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'; result jsonb;
begin
  result := public.persist_line_webhook_receipts(events);
  if result <> '{"inserted":1,"duplicates":0}'::jsonb then raise exception 'insert count wrong'; end if;
  result := public.persist_line_webhook_receipts(events);
  if result <> '{"inserted":0,"duplicates":1}'::jsonb then raise exception 'duplicate count wrong'; end if;
  begin
    perform public.persist_line_webhook_receipts(jsonb_set(events,'{0,payloadHash}',to_jsonb(repeat('b',64))));
    raise exception 'hash conflict accepted';
  exception when unique_violation then null; end;
  begin
    perform public.persist_line_webhook_receipts(jsonb_set(events,'{0,message}',to_jsonb('forbidden raw message'::text)));
    raise exception 'unknown PII field accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.persist_line_webhook_receipts(events || jsonb_set(events,'{0,payloadHash}',to_jsonb(repeat('b',64))));
    raise exception 'mixed batch conflict accepted';
  exception when unique_violation then null; end;
end;
$$;
reset role;

select set_config('request.jwt.claims',pg_temp.claims('line_webhook_ingress','app_line_webhook_ingress','wrong-scope',60)::text,true);
set local role app_line_webhook_ingress;
do $$ begin
  begin perform public.persist_line_webhook_receipts('[]'); raise exception 'wrong scope accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Claimed metadata omits hash/payload; stale completion after reclaim is fenced.
select set_config('request.jwt.claims',pg_temp.claims('line_webhook_worker','app_line_webhook_worker','line:webhook:process',300)::text,true);
create temp table receipt_claims as select public.claim_line_webhook_receipts(20) as batch;
do $$
declare claimed jsonb := (select batch -> 0 from receipt_claims); newer jsonb;
begin
  perform pg_temp.assert_true((select jsonb_array_length(batch) = 1 from receipt_claims),'claim count wrong');
  perform pg_temp.assert_true(not (claimed ?| array['payload','payload_hash','recipient_line_user_id']),'receipt projection leaked');
  perform pg_temp.assert_true(public.claim_line_webhook_receipts(20) = '[]'::jsonb,'active lease claimed twice');
  update public.line_webhook_receipts set lease_expires_at = statement_timestamp() - interval '1 second' where id = (claimed ->> 'id')::uuid;
  newer := public.claim_line_webhook_receipts(20) -> 0;
  perform pg_temp.assert_true(newer ->> 'lease_token' <> claimed ->> 'lease_token','reclaim reused fencing token');
  perform pg_temp.assert_true(not public.complete_line_webhook_receipt((claimed ->> 'id')::uuid,(claimed ->> 'lease_token')::uuid,'PROCESSED'),'stale lease completed');
  perform pg_temp.assert_true(public.complete_line_webhook_receipt((newer ->> 'id')::uuid,(newer ->> 'lease_token')::uuid,'FAILED','TRANSIENT_ERROR',1),'failure completion denied');
  perform pg_temp.assert_true(public.claim_line_webhook_receipts(20) = '[]'::jsonb,'failed retry ignored backoff');
  update public.line_webhook_receipts set next_attempt_at = statement_timestamp() - interval '1 second',attempts = 4 where id = (newer ->> 'id')::uuid;
  newer := public.claim_line_webhook_receipts(20) -> 0;
  perform pg_temp.assert_true((newer ->> 'attempts')::integer = 5,'attempt ceiling mismatch');
  perform pg_temp.assert_true(public.complete_line_webhook_receipt((newer ->> 'id')::uuid,(newer ->> 'lease_token')::uuid,'FAILED','TRANSIENT_ERROR',1),'final failure completion denied');
  perform pg_temp.assert_true((select status = 'DEAD' and processed_at is not null from public.line_webhook_receipts where id = (newer ->> 'id')::uuid),'attempt ceiling did not dead-letter');
end;
$$;

insert into public.line_webhook_receipts(provider_event_id,event_type,payload_hash)
values ('synthetic-event-processed','follow',repeat('c',64)),('synthetic-event-ignored','unsupported',repeat('d',64));
do $$
declare entry jsonb; outcome text;
begin
  for entry in select value from jsonb_array_elements(public.claim_line_webhook_receipts(20)) loop
    outcome := case when entry ->> 'event_type' = 'unsupported' then 'IGNORED' else 'PROCESSED' end;
    perform pg_temp.assert_true(public.complete_line_webhook_receipt((entry ->> 'id')::uuid,(entry ->> 'lease_token')::uuid,outcome),'success completion denied');
    perform pg_temp.assert_true(not public.complete_line_webhook_receipt((entry ->> 'id')::uuid,(entry ->> 'lease_token')::uuid,outcome),'completed receipt processed twice');
  end loop;
  perform pg_temp.assert_true(public.claim_line_webhook_receipts(20) = '[]'::jsonb,'processed/ignored receipt reclaimed');
end;
$$;
insert into public.line_webhook_receipts(provider_event_id,event_type,payload_hash,status,attempts,lease_token,lease_expires_at)
values ('synthetic-final-crash','follow',repeat('e',64),'PROCESSING',5,gen_random_uuid(),statement_timestamp() - interval '1 second');
select pg_temp.assert_true(public.claim_line_webhook_receipts(20) = '[]'::jsonb,'exhausted lease reclaimed');
select pg_temp.assert_true((select status = 'DEAD' and last_error_category = 'LEASE_ATTEMPTS_EXHAUSTED'
  from public.line_webhook_receipts where provider_event_id = 'synthetic-final-crash'),'final crash remained stuck');

-- The actual worker role can execute its command but cannot read the ledger.
set local role app_line_webhook_worker;
do $$ begin
  if public.claim_line_webhook_receipts(20) <> '[]'::jsonb then raise exception 'terminal receipt was reclaimed'; end if;
  begin perform 1 from public.line_webhook_receipts; raise exception 'worker read ledger';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

insert into public.notification_outbox(id,aggregate_type,aggregate_id,event_type,recipient_customer_id,payload,idempotency_key)
values ('80000000-0000-4000-8000-000000000001','rental','40000000-0000-4000-8000-000000000001','SYNTHETIC_TEST',
  '10000000-0000-4000-8000-000000000001','{}','synthetic-receipt-test-outbox');
select set_config('request.jwt.claims',pg_temp.claims('service_worker','app_outbox_worker','notification:deliver',300)::text,true);
set local role app_outbox_worker;
do $$
declare claimed jsonb := public.claim_notification_outbox(20) -> 0;
begin
  if claimed ->> 'recipient_line_user_id' <> 'seed-line-subject-001' then raise exception 'outbox recipient mapping wrong'; end if;
  if claimed ?| array['display_name','phone','customer_profile'] then raise exception 'outbox profile leaked'; end if;
  begin perform 1 from public.customers; raise exception 'outbox worker read customers';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

rollback;
