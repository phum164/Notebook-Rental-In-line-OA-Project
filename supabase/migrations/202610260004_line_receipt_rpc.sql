begin;

-- Required claim comparisons must reject NULL, including absent JSON keys.
create or replace function public._service_scope(expected_principal text, expected_role text, expected_scope text, max_lifetime integer) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  claims jsonb := auth.jwt();
  now_epoch numeric := extract(epoch from statement_timestamp());
  issued numeric;
  not_before numeric;
  expires numeric;
begin
  if claims is null or jsonb_typeof(claims) is distinct from 'object'
    or claims ->> 'principal_type' is distinct from expected_principal
    or claims ->> 'role' is distinct from expected_role
    or claims ->> 'scope' is distinct from expected_scope
    or nullif(current_setting('app.settings.customer_jwt_issuer', true), '') is null
    or claims ->> 'iss' is distinct from current_setting('app.settings.customer_jwt_issuer', true)
    or public._jwt_has_audience(claims, current_setting('app.settings.customer_jwt_audience', true)) is not true
    or coalesce(claims ->> 'sub', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(claims ->> 'jti', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(claims -> 'iat') is distinct from 'number'
    or jsonb_typeof(claims -> 'nbf') is distinct from 'number'
    or jsonb_typeof(claims -> 'exp') is distinct from 'number'
    or coalesce(claims ->> 'iat', '') !~ '^[0-9]{1,12}$'
    or coalesce(claims ->> 'nbf', '') !~ '^[0-9]{1,12}$'
    or coalesce(claims ->> 'exp', '') !~ '^[0-9]{1,12}$'
  then return false; end if;
  issued := (claims ->> 'iat')::numeric;
  not_before := (claims ->> 'nbf')::numeric;
  expires := (claims ->> 'exp')::numeric;
  return coalesce(issued <= now_epoch + 30 and not_before >= issued - 30
    and not_before <= now_epoch + 30 and not_before < expires and expires > now_epoch
    and expires > issued and expires - issued <= max_lifetime, false);
exception when others then return false;
end;
$$;

create or replace function public.current_customer_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  claims jsonb := auth.jwt();
  actor uuid;
  issued numeric;
  not_before numeric;
  expires numeric;
  now_epoch numeric := extract(epoch from statement_timestamp());
begin
  if claims is null or jsonb_typeof(claims) is distinct from 'object'
    or claims ->> 'principal_type' is distinct from 'customer'
    or claims ->> 'role' is distinct from 'authenticated'
    or nullif(current_setting('app.settings.customer_jwt_issuer', true), '') is null
    or claims ->> 'iss' is distinct from current_setting('app.settings.customer_jwt_issuer', true)
    or public._jwt_has_audience(claims, current_setting('app.settings.customer_jwt_audience', true)) is not true
    or coalesce(claims ->> 'sub', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(claims -> 'iat') is distinct from 'number'
    or jsonb_typeof(claims -> 'nbf') is distinct from 'number'
    or jsonb_typeof(claims -> 'exp') is distinct from 'number'
    or coalesce(claims ->> 'iat', '') !~ '^[0-9]{1,12}$'
    or coalesce(claims ->> 'nbf', '') !~ '^[0-9]{1,12}$'
    or coalesce(claims ->> 'exp', '') !~ '^[0-9]{1,12}$'
  then return null; end if;
  issued := (claims ->> 'iat')::numeric;
  not_before := (claims ->> 'nbf')::numeric;
  expires := (claims ->> 'exp')::numeric;
  if issued > now_epoch + 30 or not_before < issued - 30 or not_before > now_epoch + 30
    or not_before >= expires or expires <= now_epoch or expires <= issued or expires - issued > 300
  then return null; end if;
  actor := (claims ->> 'sub')::uuid;
  if not exists (select 1 from public.customers where id = actor and disabled_at is null)
  then return null; end if;
  return actor;
exception when others then return null;
end;
$$;

create or replace function public.current_admin_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare claims jsonb := auth.jwt(); actor uuid;
begin
  if jsonb_typeof(claims) is distinct from 'object'
    or claims ->> 'role' is distinct from 'authenticated'
    or claims ->> 'aal' is distinct from 'aal2'
    or (claims ? 'principal_type' and claims ->> 'principal_type' is distinct from 'admin')
    or coalesce(claims ->> 'sub','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return null; end if;
  actor := (claims ->> 'sub')::uuid;
  if not exists (select 1 from public.admin_users where id = actor and disabled_at is null)
  then return null; end if;
  return actor;
exception when others then return null;
end;
$$;

create table public.line_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (length(provider_event_id) between 1 and 255
    and btrim(provider_event_id) = provider_event_id and provider_event_id !~ '[[:cntrl:]]'),
  event_type text not null check (event_type ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'),
  occurred_at timestamptz,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'RECEIVED' check (status in ('RECEIVED','PROCESSING','PROCESSED','IGNORED','FAILED','DEAD')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_category text check (last_error_category is null or last_error_category ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  created_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  check ((lease_token is null) = (lease_expires_at is null)),
  check ((status = 'PROCESSING') = (lease_token is not null)),
  check ((status in ('PROCESSED','IGNORED','DEAD')) = (processed_at is not null))
);
create index line_webhook_receipts_pending_idx on public.line_webhook_receipts (next_attempt_at, created_at)
  where status in ('RECEIVED','FAILED','PROCESSING');
alter table public.line_webhook_receipts enable row level security;
alter table public.line_webhook_receipts force row level security;
revoke all on table public.line_webhook_receipts from public, anon, authenticated,
  app_session_service, app_outbox_worker, app_upload_scanner;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_line_webhook_ingress') then
    create role app_line_webhook_ingress nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_line_webhook_worker') then
    create role app_line_webhook_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant app_line_webhook_ingress, app_line_webhook_worker to authenticator;
grant usage on schema public to app_line_webhook_ingress, app_line_webhook_worker;
revoke all on all tables in schema public from app_line_webhook_ingress, app_line_webhook_worker;
revoke all on all sequences in schema public from app_line_webhook_ingress, app_line_webhook_worker;
revoke execute on all functions in schema public from app_line_webhook_ingress, app_line_webhook_worker;

create function public.persist_line_webhook_receipts(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare event jsonb; stored public.line_webhook_receipts%rowtype; event_time timestamptz;
  inserted integer := 0; duplicates integer := 0;
begin
  if public._service_scope('line_webhook_ingress','app_line_webhook_ingress','line:webhook:persist',60) is not true
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 100
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  for event in select value from jsonb_array_elements(p_events) order by value ->> 'providerEventId' loop
    if jsonb_typeof(event) is distinct from 'object'
      or (event - array['providerEventId','eventType','occurredAt','payloadHash']) <> '{}'::jsonb
      or jsonb_typeof(event -> 'providerEventId') is distinct from 'string'
      or length(event ->> 'providerEventId') not between 1 and 255
      or btrim(event ->> 'providerEventId') <> event ->> 'providerEventId'
      or event ->> 'providerEventId' ~ '[[:cntrl:]]'
      or jsonb_typeof(event -> 'eventType') is distinct from 'string'
      or event ->> 'eventType' !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
      or jsonb_typeof(event -> 'payloadHash') is distinct from 'string'
      or event ->> 'payloadHash' !~ '^[0-9a-f]{64}$'
    then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
    event_time := null;
    if event ? 'occurredAt' then
      if jsonb_typeof(event -> 'occurredAt') is distinct from 'string'
        or event ->> 'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+]00:00)$'
      then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
      begin event_time := (event ->> 'occurredAt')::timestamptz;
      exception when others then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end;
    end if;
    insert into public.line_webhook_receipts (provider_event_id,event_type,occurred_at,payload_hash)
    values (event ->> 'providerEventId',event ->> 'eventType',event_time,event ->> 'payloadHash')
    on conflict (provider_event_id) do nothing returning * into stored;
    if found then inserted := inserted + 1;
    else
      select * into stored from public.line_webhook_receipts where provider_event_id = event ->> 'providerEventId';
      if stored.payload_hash is distinct from event ->> 'payloadHash'
        or stored.event_type is distinct from event ->> 'eventType'
        or stored.occurred_at is distinct from event_time
      then raise exception 'CONFLICT' using errcode = '23505'; end if;
      duplicates := duplicates + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'duplicates',duplicates);
end;
$$;

create function public.claim_line_webhook_receipts(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if public._service_scope('line_webhook_worker','app_line_webhook_worker','line:webhook:process',300) is not true
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 100
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  -- A crashed final attempt must reach DEAD instead of remaining leased forever.
  update public.line_webhook_receipts set status = 'DEAD', processed_at = statement_timestamp(),
    lease_token = null, lease_expires_at = null, last_error_category = 'LEASE_ATTEMPTS_EXHAUSTED'
  where status = 'PROCESSING' and lease_expires_at <= statement_timestamp() and attempts >= 5;
  with candidates as (
    select id from public.line_webhook_receipts
    where attempts < 5 and ((status in ('RECEIVED','FAILED') and next_attempt_at <= statement_timestamp())
      or (status = 'PROCESSING' and lease_expires_at <= statement_timestamp()))
    order by created_at, id for update skip locked limit p_limit
  ), claimed as (
    update public.line_webhook_receipts r set status = 'PROCESSING', attempts = r.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = statement_timestamp() + interval '2 minutes', processed_at = null
    from candidates c where r.id = c.id
    returning r.id,r.provider_event_id,r.event_type,r.occurred_at,r.attempts,r.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into result from claimed;
  return result;
end;
$$;

create function public.complete_line_webhook_receipt(
  p_receipt_id uuid,p_lease_token uuid,p_outcome text,p_error_category text default null,p_retry_after_seconds integer default 60
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._service_scope('line_webhook_worker','app_line_webhook_worker','line:webhook:process',300) is not true
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_receipt_id is null or p_lease_token is null or p_outcome is null or p_outcome not in ('PROCESSED','IGNORED','FAILED')
    or p_retry_after_seconds is null or p_retry_after_seconds not between 1 and 86400
    or (p_error_category is not null and p_error_category !~ '^[A-Z][A-Z0-9_]{0,79}$')
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  update public.line_webhook_receipts set
    status = case when p_outcome = 'FAILED' and attempts >= 5 then 'DEAD' else p_outcome end,
    processed_at = case when p_outcome <> 'FAILED' or attempts >= 5 then statement_timestamp() else null end,
    next_attempt_at = case when p_outcome = 'FAILED' then statement_timestamp() + make_interval(secs => p_retry_after_seconds) else next_attempt_at end,
    last_error_category = case when p_outcome = 'FAILED' then coalesce(p_error_category,'UNKNOWN') else null end,
    lease_token = null,lease_expires_at = null
  where id = p_receipt_id and status = 'PROCESSING' and lease_token = p_lease_token
    and lease_expires_at > statement_timestamp();
  return found;
end;
$$;

create or replace function public.claim_notification_outbox(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare token uuid := gen_random_uuid(); result jsonb;
begin
  if public._service_scope('service_worker','app_outbox_worker','notification:deliver',300) is not true
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  with claimed as (
    select id from public.notification_outbox where status in ('PENDING','FAILED')
      and next_attempt_at <= statement_timestamp()
      and (lease_expires_at is null or lease_expires_at <= statement_timestamp())
    order by created_at for update skip locked limit p_limit
  ), updated as (
    update public.notification_outbox o set status = 'PROCESSING',lease_token = token,
      lease_expires_at = statement_timestamp() + interval '2 minutes',attempts = o.attempts + 1
    from claimed c where o.id = c.id
    returning o.id,o.event_type,o.aggregate_type,o.aggregate_id,o.recipient_customer_id,o.payload,o.attempts,o.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(updated) || jsonb_build_object('recipient_line_user_id',c.line_user_id)), '[]'::jsonb)
    into result from updated left join public.customers c on c.id = updated.recipient_customer_id and c.disabled_at is null;
  return result;
end;
$$;

revoke all on function public.persist_line_webhook_receipts(jsonb),public.claim_line_webhook_receipts(integer),
  public.complete_line_webhook_receipt(uuid,uuid,text,text,integer) from public,anon,authenticated,
  app_session_service,app_outbox_worker,app_upload_scanner,app_line_webhook_ingress,app_line_webhook_worker;
grant execute on function public.persist_line_webhook_receipts(jsonb) to app_line_webhook_ingress;
grant execute on function public.claim_line_webhook_receipts(integer),
  public.complete_line_webhook_receipt(uuid,uuid,text,text,integer) to app_line_webhook_worker;

commit;
