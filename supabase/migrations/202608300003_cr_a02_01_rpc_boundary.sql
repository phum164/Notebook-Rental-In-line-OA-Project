begin;

create type public.kyc_review_status as enum ('PENDING', 'VERIFIED', 'REJECTED');

alter table public.rental_quotes add column consumed_at timestamptz;
alter table public.evidence_objects
  add column laptop_id uuid references public.laptops(id) on delete restrict,
  add column content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add column scan_result text check (scan_result is null or scan_result in ('CLEAN', 'QUARANTINED'));
alter table public.notification_outbox
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column last_error_category text;
alter table public.contract_versions
  add column version_number integer,
  add column title text not null default 'Rental contract' check (length(title) between 1 and 200),
  add column effective_at timestamptz not null default timezone('utc', statement_timestamp());
with numbered as (
  select id, row_number() over (order by published_at, id)::integer as version_number
  from public.contract_versions
)
update public.contract_versions c set version_number = n.version_number from numbered n where n.id = c.id;
alter table public.contract_versions alter column version_number set not null;
alter table public.contract_versions add constraint contract_versions_version_number_key unique (version_number);

create table public.line_bootstrap_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default timezone('utc', statement_timestamp()),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes')
);

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default timezone('utc', statement_timestamp()),
  last_used_at timestamptz not null default timezone('utc', statement_timestamp()),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  rotated_from_id uuid references public.app_sessions(id) on delete restrict,
  revoked_at timestamptz,
  check (idle_expires_at > issued_at and absolute_expires_at >= idle_expires_at)
);

create table public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.kyc_submission_evidence (
  submission_id uuid not null references public.kyc_submissions(id) on delete restrict,
  evidence_id uuid not null references public.evidence_objects(id) on delete restrict,
  primary key (submission_id, evidence_id)
);

create table public.kyc_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.kyc_submissions(id) on delete restrict,
  status public.kyc_review_status not null check (status in ('VERIFIED', 'REJECTED')),
  decided_by uuid not null references public.admin_users(id) on delete restrict,
  reason text,
  decided_at timestamptz not null default timezone('utc', statement_timestamp()),
  check (status <> 'REJECTED' or nullif(btrim(reason), '') is not null)
);

create index app_sessions_token_active_idx on public.app_sessions (token_hash)
  where revoked_at is null;
create index kyc_submissions_current_idx on public.kyc_submissions (rental_id, created_at desc);
create index outbox_lease_idx on public.notification_outbox (status, lease_expires_at, next_attempt_at);

create trigger line_bootstrap_nonces_immutable
before update or delete on public.line_bootstrap_nonces
for each row when (old.consumed_at is not null) execute function public.reject_immutable_change();
create trigger kyc_submissions_immutable before update or delete on public.kyc_submissions
for each row execute function public.reject_immutable_change();
create trigger kyc_submission_evidence_immutable before update or delete on public.kyc_submission_evidence
for each row execute function public.reject_immutable_change();
create trigger kyc_decisions_immutable before update or delete on public.kyc_decisions
for each row execute function public.reject_immutable_change();

do $$
declare table_name text;
begin
  foreach table_name in array array['line_bootstrap_nonces','app_sessions','kyc_submissions','kyc_submission_evidence','kyc_decisions'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_session_service') then
    create role app_session_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_outbox_worker') then
    create role app_outbox_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_upload_scanner') then
    create role app_upload_scanner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant app_session_service, app_outbox_worker, app_upload_scanner to authenticator;
revoke all on all tables in schema public from app_session_service, app_outbox_worker, app_upload_scanner;
revoke all on all sequences in schema public from app_session_service, app_outbox_worker, app_upload_scanner;

create function public._jwt_has_audience(claims jsonb, expected text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select expected is not null and expected <> '' and (
    (jsonb_typeof(claims -> 'aud') = 'string' and claims ->> 'aud' = expected)
    or (jsonb_typeof(claims -> 'aud') = 'array' and claims -> 'aud' ? expected)
  )
$$;

create function public._service_scope(expected_principal text, expected_role text, expected_scope text, max_lifetime integer) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  claims jsonb := auth.jwt();
  now_epoch numeric := extract(epoch from statement_timestamp());
  issued numeric;
  not_before numeric;
  expires numeric;
begin
  if claims is null
    or claims ->> 'principal_type' <> expected_principal
    or claims ->> 'role' <> expected_role
    or claims ->> 'scope' <> expected_scope
    or claims ->> 'iss' <> current_setting('app.settings.customer_jwt_issuer', true)
    or not public._jwt_has_audience(claims, current_setting('app.settings.customer_jwt_audience', true))
    or coalesce(claims ->> 'sub', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(claims ->> 'jti', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  begin
    issued := (claims ->> 'iat')::numeric;
    not_before := (claims ->> 'nbf')::numeric;
    expires := (claims ->> 'exp')::numeric;
  exception when others then return false;
  end;
  if issued is null or not_before is null or expires is null or not_before < issued - 30 or expires <= issued then
    return false;
  end if;
  return coalesce(issued <= now_epoch + 30
    and not_before <= now_epoch + 30
    and expires > now_epoch
    and expires - issued <= max_lifetime, false);
exception when others then return false;
end;
$$;

create function public._require_customer() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public.current_customer_id();
begin
  if actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return actor;
end;
$$;

create function public._require_admin(required_roles public.admin_role[], require_recent_mfa boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public.current_admin_id();
  verified_epoch numeric;
begin
  if actor is null or not public.has_admin_role(required_roles) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if require_recent_mfa then
    begin verified_epoch := (auth.jwt() ->> 'mfa_verified_at')::numeric;
    exception when others then verified_epoch := null; end;
    if verified_epoch is null or verified_epoch < extract(epoch from statement_timestamp()) - 600
      or verified_epoch > extract(epoch from statement_timestamp()) + 30
    then raise exception 'RECENT_MFA_REQUIRED' using errcode = '42501'; end if;
  end if;
  return actor;
end;
$$;

create function public._idempotency_start(
  p_actor_type public.actor_type, p_actor_id uuid, p_operation text, p_target_id uuid,
  p_idempotency_key text, p_request_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.idempotency_records%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
    or p_request_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_type::text || p_actor_id::text || p_operation || coalesce(p_target_id::text, '') || p_idempotency_key, 0));
  select * into existing from public.idempotency_records
  where principal_type = p_actor_type and principal_id = p_actor_id and operation = p_operation
    and target_id is not distinct from p_target_id and idempotency_key = p_idempotency_key;
  if found and existing.request_hash <> p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  if found then return existing.response_body; end if;
  return null;
end;
$$;

create function public._idempotency_finish(
  p_actor_type public.actor_type, p_actor_id uuid, p_operation text, p_target_id uuid,
  p_idempotency_key text, p_request_hash text, p_response_status integer, p_response_body jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.idempotency_records (
    principal_type, principal_id, operation, target_id, idempotency_key, request_hash,
    response_status, response_body, expires_at
  ) values (
    p_actor_type, p_actor_id, p_operation, p_target_id, p_idempotency_key, p_request_hash,
    p_response_status, p_response_body, statement_timestamp() + interval '24 hours'
  );
  return p_response_body;
end;
$$;

create function public.app_issue_line_bootstrap_nonce(
  p_nonce_hash text, p_browser_binding_hash text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._service_scope('session_service', 'app_session_service', 'session:bootstrap', 60)
    or p_nonce_hash !~ '^[0-9a-f]{64}$' or p_browser_binding_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= statement_timestamp() or p_expires_at > statement_timestamp() + interval '5 minutes'
  then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.line_bootstrap_nonces (nonce_hash, browser_binding_hash, expires_at)
  values (p_nonce_hash, p_browser_binding_hash, p_expires_at);
  return jsonb_build_object('expiresAt', p_expires_at);
end;
$$;

create function public.app_create_line_session(
  p_nonce_hash text, p_browser_binding_hash text, p_line_subject text,
  p_session_token_hash text, p_csrf_hash text, p_display_name text,
  p_idle_expires_at timestamptz, p_absolute_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare nonce_row public.line_bootstrap_nonces%rowtype; customer public.customers%rowtype; session_id uuid;
begin
  if not public._service_scope('session_service', 'app_session_service', 'session:bootstrap', 60)
    or p_session_token_hash !~ '^[0-9a-f]{64}$' or p_csrf_hash !~ '^[0-9a-f]{64}$'
    or nullif(p_line_subject, '') is null or length(p_line_subject) > 255
    or p_idle_expires_at <= statement_timestamp()
    or p_idle_expires_at > statement_timestamp() + interval '30 minutes'
    or p_absolute_expires_at < p_idle_expires_at
    or p_absolute_expires_at > statement_timestamp() + interval '12 hours'
  then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into nonce_row from public.line_bootstrap_nonces where nonce_hash = p_nonce_hash for update;
  if not found or nonce_row.browser_binding_hash <> p_browser_binding_hash
    or nonce_row.consumed_at is not null or nonce_row.expires_at <= statement_timestamp()
  then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.line_bootstrap_nonces set consumed_at = statement_timestamp() where nonce_hash = p_nonce_hash;
  insert into public.customers (line_user_id, display_name)
  values (p_line_subject, nullif(btrim(p_display_name), ''))
  on conflict (line_user_id) do update set display_name = coalesce(excluded.display_name, public.customers.display_name)
  returning * into customer;
  if customer.disabled_at is not null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.app_sessions (customer_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at)
  values (customer.id, p_session_token_hash, p_csrf_hash, p_idle_expires_at, p_absolute_expires_at)
  returning id into session_id;
  return jsonb_build_object('sessionId', session_id, 'customerId', customer.id,
    'idleExpiresAt', p_idle_expires_at, 'absoluteExpiresAt', p_absolute_expires_at);
end;
$$;

create function public.app_resolve_session(p_session_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare found_session public.app_sessions%rowtype;
begin
  if not public._service_scope('session_service', 'app_session_service', 'session:resolve', 60)
    or p_session_token_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select s.* into found_session from public.app_sessions s join public.customers c on c.id = s.customer_id
  where s.token_hash = p_session_token_hash and s.revoked_at is null and c.disabled_at is null
    and s.idle_expires_at > statement_timestamp() and s.absolute_expires_at > statement_timestamp()
  for update of s;
  if not found then return jsonb_build_object('valid', false); end if;
  update public.app_sessions set last_used_at = statement_timestamp(),
    idle_expires_at = least(absolute_expires_at, greatest(idle_expires_at, statement_timestamp() + interval '30 minutes'))
  where id = found_session.id;
  return jsonb_build_object('valid', true, 'sessionId', found_session.id, 'customerId', found_session.customer_id,
    'csrfHash', found_session.csrf_hash, 'idleExpiresAt', least(found_session.absolute_expires_at, greatest(found_session.idle_expires_at, statement_timestamp() + interval '30 minutes')),
    'absoluteExpiresAt', found_session.absolute_expires_at);
end;
$$;

create function public.app_revoke_session(p_session_token_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._service_scope('session_service', 'app_session_service', 'session:revoke', 60)
    or p_session_token_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.app_sessions set revoked_at = coalesce(revoked_at, statement_timestamp())
  where token_hash = p_session_token_hash;
  return true;
end;
$$;

revoke all on function public._jwt_has_audience(jsonb,text), public._service_scope(text,text,text,integer),
  public._require_customer(), public._require_admin(public.admin_role[],boolean),
  public._idempotency_start(public.actor_type,uuid,text,uuid,text,text),
  public._idempotency_finish(public.actor_type,uuid,text,uuid,text,text,integer,jsonb)
from public, anon, authenticated, app_session_service, app_outbox_worker;
revoke all on function public.app_issue_line_bootstrap_nonce(text,text,timestamptz),
  public.app_create_line_session(text,text,text,text,text,text,timestamptz,timestamptz),
  public.app_resolve_session(text), public.app_revoke_session(text)
from public, anon, authenticated, app_outbox_worker;
grant execute on function public.app_issue_line_bootstrap_nonce(text,text,timestamptz),
  public.app_create_line_session(text,text,text,text,text,text,timestamptz,timestamptz),
  public.app_resolve_session(text), public.app_revoke_session(text)
to app_session_service;

create function public._rental_projection(r public.rentals) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'laptopId', r.laptop_id, 'startDate', r.start_date, 'endDate', r.end_date,
    'status', r.status, 'rentalSubtotal', jsonb_build_object('amountSatang', r.rental_subtotal_satang, 'currency', r.currency),
    'deposit', jsonb_build_object('amountSatang', r.deposit_satang, 'currency', r.currency),
    'totalDue', jsonb_build_object('amountSatang', r.total_due_satang, 'currency', r.currency),
    'holdExpiresAt', r.hold_expires_at, 'version', r.version, 'createdAt', r.created_at, 'updatedAt', r.updated_at
  )
$$;

create function public._quote_projection(q public.rental_quotes) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'quoteId', q.id, 'laptopId', q.laptop_id, 'startDate', q.start_date, 'endDate', q.end_date,
    'rentalDays', q.rental_days,
    'dailyRate', jsonb_build_object('amountSatang', q.daily_rate_satang, 'currency', q.currency),
    'rentalSubtotal', jsonb_build_object('amountSatang', q.rental_subtotal_satang, 'currency', q.currency),
    'deposit', jsonb_build_object('amountSatang', q.deposit_satang, 'currency', q.currency),
    'totalDue', jsonb_build_object('amountSatang', q.total_due_satang, 'currency', q.currency),
    'expiresAt', q.expires_at
  )
$$;

create function public._audit(
  p_actor_type public.actor_type, p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
  p_request_id text, p_idempotency_key text, p_prior_status text, p_new_status text, p_metadata jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_events (
    actor_type, actor_id, action, target_type, target_id, request_id, idempotency_key,
    prior_status, new_status, outcome, metadata
  ) values (
    p_actor_type, p_actor_id, p_action, p_target_type, p_target_id, p_request_id, p_idempotency_key,
    p_prior_status, p_new_status, 'SUCCEEDED', coalesce(p_metadata, '{}'::jsonb)
  )
$$;

create function public._allowed_rental_commands(r public.rentals) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case r.status
    when 'PENDING_REVIEW' then '["approve","reject"]'::jsonb
    when 'APPROVED' then '["start-preparation"]'::jsonb
    when 'PREPARING' then '["mark-ready"]'::jsonb
    when 'READY_FOR_HANDOVER' then '["handover"]'::jsonb
    when 'RETURN_PENDING' then '["receive-return"]'::jsonb
    when 'INSPECTION_PENDING' then '["finalize-inspection"]'::jsonb
    when 'REFUND_PENDING' then '["complete-settlement"]'::jsonb
    else '[]'::jsonb
  end
$$;

create function public._admin_rental_projection(r public.rentals) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  customer public.customers%rowtype;
  submission public.kyc_submissions%rowtype;
  decision public.kyc_decisions%rowtype;
  payment public.payments%rowtype;
  evidence_ids jsonb := '[]'::jsonb;
  kyc_status text := 'NOT_SUBMITTED';
  payment_status text := 'NOT_SUBMITTED';
begin
  select * into customer from public.customers where id = r.customer_id;
  select * into submission from public.kyc_submissions where rental_id = r.id order by created_at desc, id desc limit 1;
  if found then
    select * into decision from public.kyc_decisions where submission_id = submission.id;
    kyc_status := case when found then decision.status::text else 'PENDING' end;
    if decision.id is null then
      select coalesce(jsonb_agg(evidence_id order by evidence_id), '[]'::jsonb) into evidence_ids
      from public.kyc_submission_evidence where submission_id = submission.id;
    end if;
  end if;
  select * into payment from public.payments where rental_id = r.id order by attempt_number desc limit 1;
  if found then payment_status := payment.status::text; end if;
  return jsonb_build_object(
    'rental', public._rental_projection(r),
    'customerSummary', jsonb_build_object(
      'displayName', coalesce(customer.display_name, ''),
      'phoneMasked', case when customer.phone is null then '' when length(customer.phone) <= 4 then repeat('*', length(customer.phone)) else repeat('*', length(customer.phone) - 4) || right(customer.phone, 4) end
    ),
    'reviewSummary', jsonb_strip_nulls(jsonb_build_object(
      'kycStatus', kyc_status,
      'kycEvidenceIds', case when kyc_status = 'PENDING' then evidence_ids else null end,
      'paymentStatus', payment_status,
      'paymentAttemptId', case when payment_status = 'SUBMITTED' then payment.id else null end,
      'paymentEvidenceId', case when payment_status = 'SUBMITTED' then payment.evidence_id else null end,
      'beforeInspectionComplete', exists(select 1 from public.condition_logs where rental_id = r.id and inspection_type = 'BEFORE_RENT' and finalized_at is not null),
      'afterInspectionComplete', exists(select 1 from public.condition_logs where rental_id = r.id and inspection_type = 'AFTER_RETURN' and finalized_at is not null)
    )),
    'allowedCommands', public._allowed_rental_commands(r)
  );
end;
$$;

create function public.list_public_laptops(p_start_date date default null, p_end_date date default null, p_limit integer default 20, p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 100 or (p_start_date is null) <> (p_end_date is null) or p_end_date < p_start_date
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name,
    'dailyRate', jsonb_build_object('amountSatang', l.daily_rate_satang, 'currency', l.currency),
    'deposit', jsonb_build_object('amountSatang', l.deposit_satang, 'currency', l.currency),
    'thumbnailUrl', coalesce((select '/storage/v1/object/public/laptop-public/' || i.object_key from public.laptop_images i where i.laptop_id = l.id order by i.sort_order limit 1), '')
  ) order by l.id) from public.laptops l
  where l.deleted_at is null and l.status <> 'RETIRED' and (p_cursor is null or l.id > p_cursor)
    and (p_start_date is null or not exists (
      select 1 from public.rental_inventory_reservations x
      where x.laptop_id = l.id and x.rental_dates && daterange(p_start_date, p_end_date, '[]')
    )) limit p_limit), '[]'::jsonb);
end;
$$;

create function public.get_public_laptop(p_laptop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.laptops%rowtype;
begin
  select * into l from public.laptops where id = p_laptop_id and deleted_at is null and status <> 'RETIRED';
  if not found then return null; end if;
  return jsonb_build_object(
    'id', l.id, 'name', l.name, 'specs', l.specs,
    'dailyRate', jsonb_build_object('amountSatang', l.daily_rate_satang, 'currency', l.currency),
    'deposit', jsonb_build_object('amountSatang', l.deposit_satang, 'currency', l.currency),
    'thumbnailUrl', coalesce((select '/storage/v1/object/public/laptop-public/' || i.object_key from public.laptop_images i where i.laptop_id = l.id order by i.sort_order limit 1), ''),
    'imageUrls', coalesce((select jsonb_agg('/storage/v1/object/public/laptop-public/' || i.object_key order by i.sort_order) from public.laptop_images i where i.laptop_id = l.id), '[]'::jsonb)
  );
end;
$$;

create function public.get_current_contract() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.contract_versions%rowtype;
begin
  perform public._require_customer();
  select * into c from public.contract_versions
  where effective_at <= statement_timestamp() and published_at <= statement_timestamp() and retired_at is null
  order by version_number desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'version', c.version_number, 'title', c.title,
    'content', c.content_snapshot, 'contentHash', c.content_sha256, 'effectiveAt', c.effective_at);
end;
$$;

create function public.get_payment_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.system_settings%rowtype;
begin
  perform public._require_customer();
  select * into s from public.system_settings where key = 'PAYMENT_INSTRUCTIONS';
  if not found then return null; end if;
  return jsonb_build_object('value', s.value, 'updatedAt', s.updated_at);
end;
$$;

create function public.list_own_rentals(p_limit integer default 20, p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_customer();
begin
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(public._rental_projection(r) order by r.created_at desc, r.id desc)
    from public.rentals r where r.customer_id = actor and (p_cursor is null or r.id < p_cursor)
    limit p_limit), '[]'::jsonb);
end;
$$;

create function public.get_own_rental(p_rental_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_customer(); rental public.rentals%rowtype;
begin
  select * into rental from public.rentals where id = p_rental_id and customer_id = actor;
  if not found then return null; end if;
  return public._rental_projection(rental);
end;
$$;

create function public.create_rental_quote(p_laptop_id uuid, p_start_date date, p_end_date date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_customer(); laptop public.laptops%rowtype; quote public.rental_quotes%rowtype; days integer;
begin
  if p_end_date < p_start_date or p_start_date < (statement_timestamp() at time zone 'Asia/Bangkok')::date
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into laptop from public.laptops where id = p_laptop_id and deleted_at is null and status not in ('RETIRED','MAINTENANCE');
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.rental_inventory_reservations where laptop_id = p_laptop_id and rental_dates && daterange(p_start_date, p_end_date, '[]'))
  then raise exception 'CONFLICT' using errcode = '23P01'; end if;
  days := p_end_date - p_start_date + 1;
  insert into public.rental_quotes (
    customer_id, laptop_id, start_date, end_date, daily_rate_satang, rental_subtotal_satang,
    deposit_satang, total_due_satang, expires_at
  ) values (
    actor, laptop.id, p_start_date, p_end_date, laptop.daily_rate_satang, laptop.daily_rate_satang * days,
    laptop.deposit_satang, laptop.daily_rate_satang * days + laptop.deposit_satang,
    statement_timestamp() + interval '10 minutes'
  ) returning * into quote;
  return public._quote_projection(quote);
end;
$$;

create function public.create_rental_from_quote(
  p_quote_id uuid, p_customer_name text, p_customer_phone text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public._require_customer(); replay jsonb; quote public.rental_quotes%rowtype;
  laptop public.laptops%rowtype; rental public.rentals%rowtype; response jsonb;
begin
  replay := public._idempotency_start('CUSTOMER', actor, 'createRental', p_quote_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if nullif(btrim(p_customer_name), '') is null or length(p_customer_name) > 120
    or p_customer_phone !~ '^\+?[0-9]{9,15}$'
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into quote from public.rental_quotes where id = p_quote_id for update;
  if not found or quote.customer_id <> actor then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if quote.consumed_at is not null or quote.expires_at <= statement_timestamp()
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  select * into laptop from public.laptops where id = quote.laptop_id and deleted_at is null for update;
  if not found or laptop.status in ('RETIRED','MAINTENANCE')
    or laptop.daily_rate_satang <> quote.daily_rate_satang or laptop.deposit_satang <> quote.deposit_satang
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  update public.customers set display_name = btrim(p_customer_name), phone = p_customer_phone where id = actor;
  begin
    insert into public.rentals (
      customer_id, laptop_id, quote_id, start_date, end_date, daily_rate_satang,
      rental_subtotal_satang, deposit_satang, total_due_satang, status, hold_expires_at,
      recipient_name, contact_phone
    ) values (
      actor, quote.laptop_id, quote.id, quote.start_date, quote.end_date, quote.daily_rate_satang,
      quote.rental_subtotal_satang, quote.deposit_satang, quote.total_due_satang, 'PENDING_PAYMENT',
      statement_timestamp() + interval '30 minutes', btrim(p_customer_name), p_customer_phone
    ) returning * into rental;
  exception when exclusion_violation then raise exception 'CONFLICT' using errcode = '23P01';
  end;
  update public.rental_quotes set consumed_at = statement_timestamp() where id = quote.id;
  insert into public.rental_status_history (rental_id, new_status, actor_type, actor_id, request_id)
  values (rental.id, 'PENDING_PAYMENT', 'CUSTOMER', actor, p_request_id);
  perform public._audit('CUSTOMER', actor, 'createRental', 'rental', rental.id, p_request_id, p_idempotency_key, null, 'PENDING_PAYMENT');
  response := public._rental_projection(rental);
  return public._idempotency_finish('CUSTOMER', actor, 'createRental', p_quote_id, p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.accept_rental_contract(
  p_rental_id uuid, p_contract_version_id uuid, p_content_hash text,
  p_idempotency_key text, p_request_hash text, p_request_id text,
  p_ip_hash text default null, p_user_agent_hash text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_customer(); replay jsonb; rental public.rentals%rowtype; contract public.contract_versions%rowtype; response jsonb;
begin
  replay := public._idempotency_start('CUSTOMER', actor, 'acceptRentalContract', p_rental_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into rental from public.rentals where id = p_rental_id and customer_id = actor for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.status not in ('PENDING_PAYMENT','PENDING_REVIEW') then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  select * into contract from public.contract_versions where id = p_contract_version_id
    and content_sha256 = p_content_hash and effective_at <= statement_timestamp() and retired_at is null;
  if not found or contract.id <> (select id from public.contract_versions where effective_at <= statement_timestamp() and retired_at is null order by version_number desc limit 1)
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  insert into public.contract_acceptances (
    rental_id, customer_id, contract_version_id, content_sha256, request_id, ip_hash, user_agent_hash
  ) values (rental.id, actor, contract.id, contract.content_sha256, p_request_id, p_ip_hash, p_user_agent_hash);
  perform public._audit('CUSTOMER', actor, 'acceptRentalContract', 'rental', rental.id, p_request_id, p_idempotency_key, null, null,
    jsonb_build_object('contractVersionId', contract.id, 'contentHash', contract.content_sha256));
  response := jsonb_build_object('rentalId', rental.id, 'contractVersionId', contract.id, 'acceptedAt', statement_timestamp());
  return public._idempotency_finish('CUSTOMER', actor, 'acceptRentalContract', p_rental_id, p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.create_upload_intent_record(
  p_purpose public.evidence_purpose, p_target_id uuid, p_filename text,
  p_mime_type text, p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  customer_actor uuid := public.current_customer_id();
  admin_actor uuid := public.current_admin_id();
  rental public.rentals%rowtype;
  laptop public.laptops%rowtype;
  upload_id uuid := gen_random_uuid();
  evidence_id uuid := gen_random_uuid();
  bucket text;
  prefix text;
  extension text;
  object_key text;
  expires timestamptz := statement_timestamp() + interval '5 minutes';
begin
  if length(p_filename) not between 1 and 255 or p_mime_type not in ('image/jpeg','image/png','image/webp')
    or p_size_bytes not between 1 and 10485760
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  if p_purpose in ('KYC_ID','PAYMENT_SLIP') then
    if customer_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
    select * into rental from public.rentals where id = p_target_id and customer_id = customer_actor;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if rental.status not in ('PENDING_PAYMENT','PENDING_REVIEW') then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
    bucket := case p_purpose when 'KYC_ID' then 'kyc-private' else 'payments-private' end;
    prefix := case p_purpose when 'KYC_ID' then 'kyc' else 'slips' end || '/' || rental.id || '/' || upload_id;
  elsif p_purpose in ('CONDITION_BEFORE','CONDITION_AFTER') then
    perform public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
    select * into rental from public.rentals where id = p_target_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if (p_purpose = 'CONDITION_BEFORE' and rental.status <> 'PREPARING')
      or (p_purpose = 'CONDITION_AFTER' and rental.status <> 'INSPECTION_PENDING')
    then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
    bucket := 'conditions-private';
    prefix := 'conditions/' || rental.id || '/' || case p_purpose when 'CONDITION_BEFORE' then 'before' else 'after' end || '/' || upload_id;
  elsif p_purpose = 'LAPTOP_PRODUCT' then
    perform public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
    select * into laptop from public.laptops where id = p_target_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    bucket := 'laptop-public';
    prefix := 'laptops/' || laptop.id || '/' || upload_id;
  else raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  object_key := prefix || '/' || gen_random_uuid() || '.' || extension;
  insert into public.evidence_objects (
    id, purpose, customer_id, rental_id, laptop_id, bucket_id, object_key,
    declared_mime_type, size_bytes
  ) values (
    evidence_id, p_purpose, customer_actor, rental.id, laptop.id, bucket, object_key,
    p_mime_type, p_size_bytes
  );
  insert into public.upload_intents (id, evidence_id, owner_customer_id, expires_at)
  values (upload_id, evidence_id, customer_actor, expires);
  return jsonb_build_object('uploadId', upload_id, 'evidenceId', evidence_id, 'bucketId', bucket,
    'objectKey', object_key, 'expiresAt', expires);
end;
$$;

create function public.can_scan_storage_object(candidate_bucket text, candidate_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._service_scope('upload_scanner','app_upload_scanner','upload:scan',300)
    and exists (
      select 1 from public.upload_intents i
      join public.evidence_objects e on e.id = i.evidence_id
      where e.bucket_id = candidate_bucket and e.object_key = candidate_name
        and e.status = 'PENDING_UPLOAD' and i.consumed_at is null
        and i.expires_at > statement_timestamp()
    )
$$;

create function public.authorize_upload_scan(p_upload_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare customer_actor uuid := public.current_customer_id(); admin_actor uuid := public.current_admin_id();
  intent public.upload_intents%rowtype; evidence public.evidence_objects%rowtype;
begin
  select * into intent from public.upload_intents where id = p_upload_id;
  if not found or intent.consumed_at is not null or intent.expires_at <= statement_timestamp()
  then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into evidence from public.evidence_objects where id = intent.evidence_id and status = 'PENDING_UPLOAD';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if customer_actor is not null then
    if intent.owner_customer_id <> customer_actor or evidence.customer_id <> customer_actor
      or evidence.purpose not in ('KYC_ID','PAYMENT_SLIP')
    then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  elsif admin_actor is not null then
    if evidence.purpose in ('KYC_ID','PAYMENT_SLIP')
      or not public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[])
    then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  else raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('uploadId', intent.id, 'evidenceId', evidence.id,
    'bucketId', evidence.bucket_id, 'objectKey', evidence.object_key,
    'declaredMimeType', evidence.declared_mime_type, 'sizeBytes', evidence.size_bytes);
end;
$$;

create or replace function public.enforce_evidence_limits() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare allowed_count integer;
declare existing_count integer;
begin
  if new.rental_id is null or new.purpose not in ('KYC_ID', 'PAYMENT_SLIP') then return new; end if;
  allowed_count := case new.purpose when 'KYC_ID' then 2 else 3 end;
  perform 1 from public.rentals where id = new.rental_id for update;
  select count(*) into existing_count from public.evidence_objects e
  where e.rental_id = new.rental_id and e.purpose = new.purpose and e.id <> new.id
    and (
      (new.purpose = 'KYC_ID' and not exists (
        select 1 from public.kyc_submission_evidence se
        join public.kyc_decisions d on d.submission_id = se.submission_id and d.status = 'REJECTED'
        where se.evidence_id = e.id
      ))
      or (new.purpose = 'PAYMENT_SLIP' and not exists (
        select 1 from public.payments p where p.evidence_id = e.id and p.status in ('REJECTED','VOIDED')
      ))
    );
  if existing_count >= allowed_count then
    raise exception 'evidence limit exceeded for %', new.purpose using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.finalize_upload_intent_record(
  p_upload_id uuid, p_detected_mime_type text, p_detected_size_bytes bigint,
  p_content_sha256 text, p_scan_result text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  principal_type public.actor_type := 'SERVICE_WORKER';
  principal_id uuid; intent public.upload_intents%rowtype;
  evidence public.evidence_objects%rowtype; replay jsonb; result_status public.evidence_status;
  submission_id uuid; candidate uuid; response jsonb;
begin
  if not public._service_scope('upload_scanner','app_upload_scanner','upload:scan',300)
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  principal_id := (auth.jwt() ->> 'sub')::uuid;
  replay := public._idempotency_start(principal_type, principal_id, 'finalizeUpload', p_upload_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into intent from public.upload_intents where id = p_upload_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into evidence from public.evidence_objects where id = intent.evidence_id for update;
  if intent.consumed_at is not null or intent.expires_at <= statement_timestamp() or evidence.status <> 'PENDING_UPLOAD'
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if p_detected_mime_type not in ('image/jpeg','image/png','image/webp') or p_detected_mime_type <> evidence.declared_mime_type
    or p_detected_size_bytes <> evidence.size_bytes or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_scan_result not in ('CLEAN','QUARANTINED')
  then raise exception 'UPLOAD_REJECTED' using errcode = '22023'; end if;
  result_status := case p_scan_result when 'CLEAN' then 'READY'::public.evidence_status else 'QUARANTINED'::public.evidence_status end;
  update public.upload_intents set consumed_at = statement_timestamp() where id = intent.id;
  update public.evidence_objects set detected_mime_type = p_detected_mime_type,
    content_sha256 = p_content_sha256, scan_result = p_scan_result, status = result_status,
    finalized_at = statement_timestamp() where id = evidence.id;
  if evidence.purpose = 'KYC_ID' and result_status = 'READY' then
    insert into public.kyc_submissions (rental_id, customer_id) values (evidence.rental_id, evidence.customer_id)
    returning id into submission_id;
    for candidate in
      select e.id from public.evidence_objects e
      where e.rental_id = evidence.rental_id and e.customer_id = evidence.customer_id
        and e.purpose = 'KYC_ID' and e.status = 'READY'
        and not exists (
          select 1 from public.kyc_submission_evidence se
          join public.kyc_decisions d on d.submission_id = se.submission_id and d.status = 'REJECTED'
          where se.evidence_id = e.id
        )
      order by e.finalized_at desc, e.id limit 2
    loop
      insert into public.kyc_submission_evidence (submission_id, evidence_id) values (submission_id, candidate);
    end loop;
  end if;
  perform public._audit(principal_type, principal_id, 'finalizeUpload', 'evidence', evidence.id,
    p_request_id, p_idempotency_key, 'PENDING_UPLOAD', result_status::text,
    jsonb_build_object('purpose', evidence.purpose));
  response := jsonb_build_object('evidenceId', evidence.id, 'status', result_status);
  return public._idempotency_finish(principal_type, principal_id, 'finalizeUpload', p_upload_id,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.submit_rental_payment(
  p_rental_id uuid, p_evidence_id uuid, p_payment_type public.payment_type,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public._require_customer(); replay jsonb; rental public.rentals%rowtype;
  evidence public.evidence_objects%rowtype; attempt integer; payment public.payments%rowtype; response jsonb;
begin
  replay := public._idempotency_start('CUSTOMER', actor, 'submitRentalPayment', p_rental_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if p_payment_type <> 'RENT_AND_DEPOSIT' then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into rental from public.rentals where id = p_rental_id and customer_id = actor for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.status not in ('PENDING_PAYMENT','PENDING_REVIEW') or rental.hold_expires_at <= statement_timestamp()
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  if not exists (select 1 from public.contract_acceptances where rental_id = rental.id and customer_id = actor)
    or not exists (select 1 from public.kyc_submissions s where s.rental_id = rental.id)
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  select * into evidence from public.evidence_objects where id = p_evidence_id and rental_id = rental.id
    and customer_id = actor and purpose = 'PAYMENT_SLIP' and status = 'READY' for update;
  if not found then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where evidence_id = evidence.id)
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  select coalesce(max(attempt_number), 0) + 1 into attempt from public.payments
  where rental_id = rental.id and type = p_payment_type;
  insert into public.payments (rental_id, type, status, amount_satang, evidence_id, attempt_number, submitted_at)
  values (rental.id, p_payment_type, 'SUBMITTED', rental.total_due_satang, evidence.id, attempt, statement_timestamp())
  returning * into payment;
  if rental.status = 'PENDING_PAYMENT' then
    update public.rentals set status = 'PENDING_REVIEW', hold_expires_at = null, version = version + 1 where id = rental.id
    returning * into rental;
    insert into public.rental_status_history (rental_id, prior_status, new_status, actor_type, actor_id, request_id)
    values (rental.id, 'PENDING_PAYMENT', 'PENDING_REVIEW', 'CUSTOMER', actor, p_request_id);
  else
    update public.rentals set version = version + 1 where id = rental.id returning * into rental;
  end if;
  insert into public.notification_outbox (aggregate_type, aggregate_id, event_type, recipient_customer_id, payload, idempotency_key)
  values ('rental', rental.id, 'PAYMENT_SUBMITTED', actor, jsonb_build_object('rentalId', rental.id), 'payment-submitted:' || payment.id);
  perform public._audit('CUSTOMER', actor, 'submitRentalPayment', 'payment', payment.id,
    p_request_id, p_idempotency_key, 'PENDING', 'SUBMITTED');
  response := jsonb_build_object('paymentId', payment.id, 'status', payment.status, 'rental', public._rental_projection(rental));
  return public._idempotency_finish('CUSTOMER', actor, 'submitRentalPayment', p_rental_id,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.list_admin_rentals(p_status public.rental_status default null, p_limit integer default 20, p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(public._admin_rental_projection(r) order by r.created_at desc, r.id desc)
    from public.rentals r where (p_status is null or r.status = p_status) and (p_cursor is null or r.id < p_cursor)
    limit p_limit), '[]'::jsonb);
end;
$$;

create function public.get_admin_session() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  admin public.admin_users%rowtype; verified_epoch numeric;
begin
  select * into admin from public.admin_users where id = actor and disabled_at is null;
  begin verified_epoch := (auth.jwt() ->> 'mfa_verified_at')::numeric;
  exception when others then verified_epoch := null; end;
  return jsonb_build_object('id', admin.id, 'roles', jsonb_build_array(admin.role),
    'mfaVerified', auth.jwt() ->> 'aal' = 'aal2',
    'mfaVerifiedAt', case when verified_epoch is null then null else to_jsonb(to_timestamp(verified_epoch)) end);
end;
$$;

create function public.get_admin_rental(p_rental_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare rental public.rentals%rowtype;
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  select * into rental from public.rentals where id = p_rental_id;
  if not found then return null; end if;
  return public._admin_rental_projection(rental);
end;
$$;

create function public.list_admin_laptops(p_include_retired boolean default false, p_limit integer default 20, p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'specs', l.specs, 'dailyRateSatang', l.daily_rate_satang,
    'depositSatang', l.deposit_satang, 'status', l.status, 'version', l.version,
    'retiredAt', l.deleted_at, 'createdAt', l.created_at, 'updatedAt', l.updated_at
  ) order by l.id) from public.laptops l
  where (p_include_retired or l.deleted_at is null) and (p_cursor is null or l.id > p_cursor)
  limit p_limit), '[]'::jsonb);
end;
$$;

create function public._review_rental_kyc(
  p_rental_id uuid, p_evidence_ids uuid[], p_status public.kyc_review_status, p_reason text,
  p_expected_version integer, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public._require_admin(array['OWNER','REVIEWER']::public.admin_role[]);
  replay jsonb; rental public.rentals%rowtype; submission public.kyc_submissions%rowtype;
  current_ids uuid[]; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalKyc' else 'rejectRentalKyc' end,
    p_rental_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if p_status not in ('VERIFIED','REJECTED') or cardinality(p_evidence_ids) not between 1 and 2
    or (select count(distinct x) from unnest(p_evidence_ids) x) <> cardinality(p_evidence_ids)
    or (p_status = 'REJECTED' and nullif(btrim(p_reason), '') is null)
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if rental.status <> 'PENDING_REVIEW' then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  select * into submission from public.kyc_submissions where rental_id = rental.id order by created_at desc, id desc limit 1;
  if not found then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  if exists (select 1 from public.kyc_decisions where submission_id = submission.id)
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  select array_agg(evidence_id order by evidence_id) into current_ids from public.kyc_submission_evidence where submission_id = submission.id;
  if current_ids <> (select array_agg(x order by x) from unnest(p_evidence_ids) x)
    or exists (select 1 from public.kyc_submission_evidence se join public.evidence_objects e on e.id = se.evidence_id
      where se.submission_id = submission.id and (e.rental_id <> rental.id or e.purpose <> 'KYC_ID' or e.status <> 'READY'))
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  insert into public.kyc_decisions (submission_id, status, decided_by, reason)
  values (submission.id, p_status, actor, nullif(btrim(p_reason), ''));
  update public.rentals set version = version + 1 where id = rental.id returning * into rental;
  perform public._audit('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalKyc' else 'rejectRentalKyc' end,
    'rental', rental.id, p_request_id, p_idempotency_key, 'PENDING', p_status::text,
    jsonb_build_object('submissionId', submission.id, 'evidenceIds', to_jsonb(current_ids)));
  response := public._admin_rental_projection(rental);
  return public._idempotency_finish('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalKyc' else 'rejectRentalKyc' end,
    p_rental_id, p_idempotency_key, p_request_hash, 200, response);
end;
$$;

create function public.verify_rental_kyc(
  p_rental_id uuid, p_evidence_ids uuid[], p_reason text, p_expected_version integer,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public._review_rental_kyc(p_rental_id, p_evidence_ids, 'VERIFIED', p_reason, p_expected_version, p_idempotency_key, p_request_hash, p_request_id)
$$;

create function public.reject_rental_kyc(
  p_rental_id uuid, p_evidence_ids uuid[], p_reason text, p_expected_version integer,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public._review_rental_kyc(p_rental_id, p_evidence_ids, 'REJECTED', p_reason, p_expected_version, p_idempotency_key, p_request_hash, p_request_id)
$$;

create function public._review_rental_payment(
  p_rental_id uuid, p_payment_id uuid, p_status public.payment_status, p_reason text, p_provider_reference text,
  p_expected_version integer, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public._require_admin(array['OWNER','REVIEWER']::public.admin_role[]);
  replay jsonb; rental public.rentals%rowtype; payment public.payments%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalPayment' else 'rejectRentalPayment' end,
    p_payment_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if p_status not in ('VERIFIED','REJECTED') or nullif(btrim(p_reason), '') is null
    or (p_status = 'VERIFIED' and nullif(btrim(p_provider_reference), '') is null)
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if rental.status <> 'PENDING_REVIEW' then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  select * into payment from public.payments where id = p_payment_id and rental_id = rental.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if payment.status <> 'SUBMITTED' then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if payment.type <> 'RENT_AND_DEPOSIT' or payment.amount_satang <> rental.total_due_satang
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  update public.payments set status = p_status, verified_by = case when p_status = 'VERIFIED' then actor else null end,
    verified_at = case when p_status = 'VERIFIED' then statement_timestamp() else null end,
    decision_reason = btrim(p_reason), provider_reference = case when p_status = 'VERIFIED' then btrim(p_provider_reference) else null end
  where id = payment.id;
  update public.rentals set version = version + 1 where id = rental.id returning * into rental;
  perform public._audit('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalPayment' else 'rejectRentalPayment' end,
    'payment', payment.id, p_request_id, p_idempotency_key, 'SUBMITTED', p_status::text);
  response := public._admin_rental_projection(rental);
  return public._idempotency_finish('ADMIN', actor, case p_status when 'VERIFIED' then 'verifyRentalPayment' else 'rejectRentalPayment' end,
    p_payment_id, p_idempotency_key, p_request_hash, 200, response);
end;
$$;

create function public.verify_rental_payment(
  p_rental_id uuid, p_payment_id uuid, p_provider_reference text, p_reason text, p_expected_version integer,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public._review_rental_payment(p_rental_id, p_payment_id, 'VERIFIED', p_reason, p_provider_reference,
    p_expected_version, p_idempotency_key, p_request_hash, p_request_id)
$$;

create function public.reject_rental_payment(
  p_rental_id uuid, p_payment_id uuid, p_reason text, p_expected_version integer,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public._review_rental_payment(p_rental_id, p_payment_id, 'REJECTED', p_reason, null,
    p_expected_version, p_idempotency_key, p_request_hash, p_request_id)
$$;

create function public.create_admin_laptop(
  p_name text, p_specs jsonb, p_daily_rate_satang public.money_satang,
  p_deposit_satang public.money_satang, p_idempotency_key text,
  p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
  replay jsonb; laptop public.laptops%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'createAdminLaptop', null,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 200 or jsonb_typeof(p_specs) <> 'object'
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  insert into public.laptops (name, specs, daily_rate_satang, deposit_satang)
  values (btrim(p_name), p_specs, p_daily_rate_satang, p_deposit_satang)
  returning * into laptop;
  perform public._audit('ADMIN', actor, 'createAdminLaptop', 'laptop', laptop.id,
    p_request_id, p_idempotency_key, null, laptop.status::text);
  response := jsonb_build_object('id', laptop.id, 'name', laptop.name, 'specs', laptop.specs,
    'dailyRateSatang', laptop.daily_rate_satang, 'depositSatang', laptop.deposit_satang,
    'status', laptop.status, 'version', laptop.version);
  return public._idempotency_finish('ADMIN', actor, 'createAdminLaptop', null,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.update_admin_laptop(
  p_laptop_id uuid, p_name text, p_specs jsonb, p_daily_rate_satang public.money_satang,
  p_deposit_satang public.money_satang, p_expected_version integer,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
  replay jsonb; laptop public.laptops%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'updateAdminLaptop', p_laptop_id,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into laptop from public.laptops where id = p_laptop_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if laptop.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 200 or jsonb_typeof(p_specs) <> 'object'
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  update public.laptops set name = btrim(p_name), specs = p_specs,
    daily_rate_satang = p_daily_rate_satang, deposit_satang = p_deposit_satang,
    version = version + 1 where id = laptop.id returning * into laptop;
  perform public._audit('ADMIN', actor, 'updateAdminLaptop', 'laptop', laptop.id,
    p_request_id, p_idempotency_key, null, laptop.status::text);
  response := jsonb_build_object('id', laptop.id, 'name', laptop.name, 'specs', laptop.specs,
    'dailyRateSatang', laptop.daily_rate_satang, 'depositSatang', laptop.deposit_satang,
    'status', laptop.status, 'version', laptop.version);
  return public._idempotency_finish('ADMIN', actor, 'updateAdminLaptop', laptop.id,
    p_idempotency_key, p_request_hash, 200, response);
end;
$$;

create function public.retire_admin_laptop(
  p_laptop_id uuid, p_expected_version integer, p_idempotency_key text,
  p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER']::public.admin_role[]);
  replay jsonb; laptop public.laptops%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'retireAdminLaptop', p_laptop_id,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into laptop from public.laptops where id = p_laptop_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if laptop.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
  if exists (select 1 from public.rental_inventory_reservations where laptop_id = laptop.id)
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  update public.laptops set status = 'RETIRED', deleted_at = statement_timestamp(),
    version = version + 1 where id = laptop.id returning * into laptop;
  perform public._audit('ADMIN', actor, 'retireAdminLaptop', 'laptop', laptop.id,
    p_request_id, p_idempotency_key, null, 'RETIRED');
  response := jsonb_build_object('id', laptop.id, 'status', laptop.status, 'version', laptop.version);
  return public._idempotency_finish('ADMIN', actor, 'retireAdminLaptop', laptop.id,
    p_idempotency_key, p_request_hash, 204, response);
end;
$$;

create function public.execute_rental_command(
  p_rental_id uuid, p_command text, p_reason text, p_inspection_id uuid,
  p_expected_version integer, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; replay jsonb; rental public.rentals%rowtype; old_status public.rental_status;
  new_status public.rental_status; response jsonb;
begin
  if p_command in ('approve','reject') then
    actor := public._require_admin(array['OWNER','REVIEWER']::public.admin_role[]);
  else
    actor := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[], p_command = 'complete-settlement');
  end if;
  replay := public._idempotency_start('ADMIN', actor, 'executeRentalCommand:' || p_command,
    p_rental_id, p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
  old_status := rental.status;
  case p_command
    when 'approve' then
      if old_status <> 'PENDING_REVIEW'
        or not exists (
          select 1 from public.kyc_submissions s join public.kyc_decisions d on d.submission_id = s.id
          where s.rental_id = rental.id and d.status = 'VERIFIED'
            and s.id = (select s2.id from public.kyc_submissions s2 where s2.rental_id = rental.id order by s2.created_at desc, s2.id desc limit 1)
        )
        or not exists (select 1 from public.payments p where p.rental_id = rental.id and p.type = 'RENT_AND_DEPOSIT' and p.status = 'VERIFIED')
      then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'APPROVED';
    when 'reject' then
      if old_status <> 'PENDING_REVIEW' or nullif(btrim(p_reason), '') is null
      then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'REJECTED';
    when 'start-preparation' then
      if old_status <> 'APPROVED' then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'PREPARING';
    when 'mark-ready' then
      if old_status <> 'PREPARING' or not exists (
        select 1 from public.condition_logs where rental_id = rental.id and inspection_type = 'BEFORE_RENT' and finalized_at is not null
      ) then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'READY_FOR_HANDOVER';
    when 'handover' then
      if old_status <> 'READY_FOR_HANDOVER' or not exists (
        select 1 from public.condition_logs where rental_id = rental.id and inspection_type = 'BEFORE_RENT' and finalized_at is not null
      ) then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'ACTIVE';
      update public.laptops set status = 'RENTED', version = version + 1 where id = rental.laptop_id and status in ('AVAILABLE','RESERVED');
      if not found then raise exception 'CONFLICT' using errcode = '23505'; end if;
    when 'receive-return' then
      if old_status <> 'RETURN_PENDING' then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'INSPECTION_PENDING';
    when 'finalize-inspection' then
      if old_status <> 'INSPECTION_PENDING' or p_inspection_id is null or not exists (
        select 1 from public.condition_logs where id = p_inspection_id and rental_id = rental.id
          and inspection_type = 'AFTER_RETURN' and finalized_at is not null
      ) then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'REFUND_PENDING';
    when 'complete-settlement' then
      if old_status <> 'REFUND_PENDING' or exists (
        select 1 from public.refunds where rental_id = rental.id and status not in ('COMPLETED','CANCELLED','NOT_REQUIRED')
      ) then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
      new_status := 'COMPLETED';
      update public.laptops set status = 'AVAILABLE', version = version + 1
        where id = rental.laptop_id and status = 'RENTED';
    else raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end case;
  update public.rentals set status = new_status, hold_expires_at = null,
    handed_over_at = case when new_status = 'ACTIVE' then statement_timestamp() else handed_over_at end,
    returned_at = case when new_status = 'INSPECTION_PENDING' then statement_timestamp() else returned_at end,
    version = version + 1 where id = rental.id returning * into rental;
  insert into public.rental_status_history (rental_id, prior_status, new_status, actor_type, actor_id, reason, request_id)
  values (rental.id, old_status, new_status, 'ADMIN', actor, nullif(btrim(p_reason), ''), p_request_id);
  perform public._audit('ADMIN', actor, 'executeRentalCommand:' || p_command, 'rental', rental.id,
    p_request_id, p_idempotency_key, old_status::text, new_status::text);
  insert into public.notification_outbox (aggregate_type, aggregate_id, event_type, recipient_customer_id, payload, idempotency_key)
  values ('rental', rental.id, 'RENTAL_' || new_status::text, rental.customer_id,
    jsonb_build_object('rentalId', rental.id, 'status', new_status),
    'rental-state:' || rental.id || ':' || rental.version)
  on conflict (idempotency_key) do nothing;
  response := public._admin_rental_projection(rental);
  return public._idempotency_finish('ADMIN', actor, 'executeRentalCommand:' || p_command,
    rental.id, p_idempotency_key, p_request_hash, 200, response);
end;
$$;

create function public.list_rental_inspections(p_rental_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
  if not exists (select 1 from public.rentals where id = p_rental_id)
  then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.inspection_type,
    'notes', c.notes, 'finalizedAt', c.finalized_at, 'evidenceIds', coalesce((
      select jsonb_agg(e.evidence_id order by e.sort_order) from public.condition_log_evidence e where e.condition_log_id = c.id
    ), '[]'::jsonb)) order by c.created_at desc)
    from public.condition_logs c where c.rental_id = p_rental_id and c.finalized_at is not null), '[]'::jsonb);
end;
$$;

create function public.create_rental_inspection(
  p_rental_id uuid, p_type public.inspection_type, p_evidence_ids uuid[], p_notes text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
  replay jsonb; rental public.rentals%rowtype; log public.condition_logs%rowtype;
  evidence_id uuid; position integer := 0; expected_purpose public.evidence_purpose; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'createRentalInspection', p_rental_id,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if cardinality(p_evidence_ids) not between 1 and 12 or nullif(btrim(p_notes), '') is null
    or (select count(distinct x) from unnest(p_evidence_ids) x) <> cardinality(p_evidence_ids)
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if (p_type = 'BEFORE_RENT' and rental.status <> 'PREPARING')
    or (p_type = 'AFTER_RETURN' and rental.status <> 'INSPECTION_PENDING')
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  if exists (select 1 from public.condition_logs where rental_id = rental.id and inspection_type = p_type and finalized_at is not null)
  then raise exception 'CONFLICT' using errcode = '23505'; end if;
  expected_purpose := case p_type when 'BEFORE_RENT' then 'CONDITION_BEFORE' else 'CONDITION_AFTER' end;
  if (select count(*) from public.evidence_objects where id = any(p_evidence_ids)
      and rental_id = rental.id and purpose = expected_purpose and status = 'READY') <> cardinality(p_evidence_ids)
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  insert into public.condition_logs (rental_id, inspection_type, notes, finalized_at, finalized_by, created_by)
  values (rental.id, p_type, btrim(p_notes), statement_timestamp(), actor, actor) returning * into log;
  foreach evidence_id in array p_evidence_ids loop
    insert into public.condition_log_evidence (condition_log_id, evidence_id, sort_order)
    values (log.id, evidence_id, position);
    position := position + 1;
  end loop;
  perform public._audit('ADMIN', actor, 'createRentalInspection', 'condition_log', log.id,
    p_request_id, p_idempotency_key, null, p_type::text);
  response := jsonb_build_object('id', log.id, 'type', log.inspection_type,
    'notes', log.notes, 'finalizedAt', log.finalized_at, 'evidenceIds', to_jsonb(p_evidence_ids));
  return public._idempotency_finish('ADMIN', actor, 'createRentalInspection', rental.id,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.create_rental_fee_obligation(
  p_rental_id uuid, p_type public.payment_type, p_amount_satang public.money_satang,
  p_reason text, p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[], true);
  replay jsonb; rental public.rentals%rowtype; fee public.fee_obligations%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'createRentalFeeObligation', p_rental_id,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if p_type not in ('LATE_FEE','DAMAGE_FEE') or p_amount_satang <= 0 or nullif(btrim(p_reason), '') is null
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.status not in ('INSPECTION_PENDING','REFUND_PENDING')
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  insert into public.fee_obligations (rental_id, category, amount_satang, reason, assessed_by)
  values (rental.id, p_type::text, p_amount_satang, btrim(p_reason), actor) returning * into fee;
  perform public._audit('ADMIN', actor, 'createRentalFeeObligation', 'fee_obligation', fee.id,
    p_request_id, p_idempotency_key, null, p_type::text);
  response := jsonb_build_object('id', fee.id, 'type', fee.category, 'amountSatang', fee.amount_satang,
    'reason', fee.reason, 'createdAt', fee.created_at);
  return public._idempotency_finish('ADMIN', actor, 'createRentalFeeObligation', rental.id,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.request_rental_refund(
  p_rental_id uuid, p_amount_satang public.money_satang, p_reason text,
  p_idempotency_key text, p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[], true);
  replay jsonb; rental public.rentals%rowtype; refund public.refunds%rowtype;
  refundable public.money_satang; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'requestRentalRefund', p_rental_id,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  select * into rental from public.rentals where id = p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if rental.status <> 'REFUND_PENDING' or nullif(btrim(p_reason), '') is null
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  refundable := greatest(rental.deposit_satang - coalesce((select sum(amount_satang) from public.fee_obligations where rental_id = rental.id), 0), 0);
  if p_amount_satang <= 0 or p_amount_satang > refundable
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  insert into public.refunds (rental_id, status, amount_satang, reason, requested_by, idempotency_key)
  values (rental.id, 'PENDING', p_amount_satang, btrim(p_reason), actor, p_idempotency_key)
  returning * into refund;
  perform public._audit('ADMIN', actor, 'requestRentalRefund', 'refund', refund.id,
    p_request_id, p_idempotency_key, 'NOT_REQUIRED', 'PENDING');
  response := jsonb_build_object('id', refund.id, 'status', refund.status,
    'amountSatang', refund.amount_satang, 'rentalId', refund.rental_id);
  return public._idempotency_finish('ADMIN', actor, 'requestRentalRefund', rental.id,
    p_idempotency_key, p_request_hash, 202, response);
end;
$$;

create function public.list_admin_rental_history(p_rental_id uuid, p_limit integer default 20, p_cursor bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  if not exists (select 1 from public.rentals where id = p_rental_id)
  then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'priorStatus', h.prior_status,
    'newStatus', h.new_status, 'actorType', h.actor_type, 'reason', h.reason,
    'createdAt', h.created_at) order by h.id desc)
    from public.rental_status_history h where h.rental_id = p_rental_id
      and (p_cursor is null or h.id < p_cursor) limit p_limit), '[]'::jsonb);
end;
$$;

create function public.authorize_evidence_read(p_evidence_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS','REVIEWER']::public.admin_role[]);
  evidence public.evidence_objects%rowtype;
begin
  select * into evidence from public.evidence_objects where id = p_evidence_id and status = 'READY';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if evidence.purpose in ('KYC_ID','PAYMENT_SLIP')
    and not public.has_admin_role(array['OWNER','REVIEWER']::public.admin_role[])
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public._audit('ADMIN', actor, 'authorizeEvidenceRead', 'evidence', evidence.id,
    null, null, null, null, jsonb_build_object('purpose', evidence.purpose));
  return jsonb_build_object('evidenceId', evidence.id, 'bucketId', evidence.bucket_id,
    'objectKey', evidence.object_key, 'purpose', evidence.purpose);
end;
$$;

create function public.list_admin_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value,
    'version', s.version, 'updatedAt', s.updated_at) order by s.key)
    from public.system_settings s where s.key in ('PAYMENT_INSTRUCTIONS','CONTACT_LINE_URL','AUTO_REPLY_TEXT')), '[]'::jsonb);
end;
$$;

create function public.update_admin_setting(
  p_key text, p_value text, p_expected_version integer, p_idempotency_key text,
  p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER']::public.admin_role[], true);
  replay jsonb; setting public.system_settings%rowtype; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'updateAdminSettings', null,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if p_key not in ('PAYMENT_INSTRUCTIONS','CONTACT_LINE_URL','AUTO_REPLY_TEXT') or length(p_value) > 5000
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select * into setting from public.system_settings where key = p_key for update;
  if not found then
    if p_expected_version <> 0 then raise exception 'CONFLICT' using errcode = '23505'; end if;
    insert into public.system_settings (key, value, updated_by) values (p_key, to_jsonb(p_value), actor)
    returning * into setting;
  else
    if setting.version <> p_expected_version then raise exception 'CONFLICT' using errcode = '23505'; end if;
    update public.system_settings set value = to_jsonb(p_value), version = version + 1,
      updated_by = actor, updated_at = statement_timestamp() where key = p_key returning * into setting;
  end if;
  perform public._audit('ADMIN', actor, 'updateAdminSettings', 'setting', null,
    p_request_id, p_idempotency_key, null, null, jsonb_build_object('key', p_key));
  response := jsonb_build_object('key', setting.key, 'value', setting.value,
    'version', setting.version, 'updatedAt', setting.updated_at);
  return public._idempotency_finish('ADMIN', actor, 'updateAdminSettings', null,
    p_idempotency_key, p_request_hash, 200, response);
end;
$$;

create function public.publish_admin_contract(
  p_title text, p_content text, p_effective_at timestamptz, p_idempotency_key text,
  p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER']::public.admin_role[], true);
  replay jsonb; contract public.contract_versions%rowtype; next_version integer; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'publishAdminContract', null,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if nullif(btrim(p_title), '') is null or length(p_title) > 200 or length(p_content) not between 1 and 100000
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('contract-version'));
  select coalesce(max(version_number), 0) + 1 into next_version from public.contract_versions;
  insert into public.contract_versions (version, version_number, title, content_snapshot,
    content_sha256, effective_at, published_by)
  values (next_version::text, next_version, btrim(p_title), p_content,
    encode(digest(convert_to(p_content, 'UTF8'), 'sha256'), 'hex'), p_effective_at, actor)
  returning * into contract;
  perform public._audit('ADMIN', actor, 'publishAdminContract', 'contract_version', contract.id,
    p_request_id, p_idempotency_key, null, contract.version);
  response := jsonb_build_object('id', contract.id, 'version', contract.version,
    'title', contract.title, 'content', contract.content_snapshot,
    'contentHash', contract.content_sha256, 'effectiveAt', contract.effective_at);
  return public._idempotency_finish('ADMIN', actor, 'publishAdminContract', null,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

create function public.list_admin_audit_events(
  p_target_type text default null, p_target_id uuid default null,
  p_limit integer default 20, p_cursor bigint default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'actorType', a.actor_type,
    'action', a.action, 'targetType', a.target_type, 'targetId', a.target_id,
    'priorStatus', a.prior_status, 'newStatus', a.new_status, 'outcome', a.outcome,
    'occurredAt', a.occurred_at) order by a.id desc)
    from public.audit_events a where (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id)
      and (p_cursor is null or a.id < p_cursor) limit p_limit), '[]'::jsonb);
end;
$$;

create function public.claim_notification_outbox(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare token uuid := gen_random_uuid();
begin
  if not public._service_scope('service_worker','app_outbox_worker','notification:deliver',300)
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  return coalesce((with claimed as (
    select id from public.notification_outbox where status in ('PENDING','FAILED')
      and next_attempt_at <= statement_timestamp()
      and (lease_expires_at is null or lease_expires_at <= statement_timestamp())
    order by created_at for update skip locked limit p_limit
  ), updated as (
    update public.notification_outbox o set status = 'PROCESSING', lease_token = token,
      lease_expires_at = statement_timestamp() + interval '2 minutes', attempts = attempts + 1
    from claimed c where o.id = c.id
    returning o.id, o.event_type, o.aggregate_type, o.aggregate_id,
      o.recipient_customer_id, o.payload, o.attempts, o.lease_token
  ) select jsonb_agg(to_jsonb(updated)) from updated), '[]'::jsonb);
end;
$$;

create function public.complete_notification_outbox(
  p_event_id uuid, p_lease_token uuid, p_delivered boolean,
  p_error_category text default null, p_retry_after_seconds integer default 60
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._service_scope('service_worker','app_outbox_worker','notification:deliver',300)
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_retry_after_seconds not between 1 and 86400 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  update public.notification_outbox set status = case when p_delivered then 'DELIVERED' else 'FAILED' end,
    delivered_at = case when p_delivered then statement_timestamp() else null end,
    next_attempt_at = case when p_delivered then next_attempt_at else statement_timestamp() + make_interval(secs => p_retry_after_seconds) end,
    last_error_category = case when p_delivered then null else left(coalesce(p_error_category, 'UNKNOWN'), 80) end,
    lease_token = null, lease_expires_at = null
  where id = p_event_id and status = 'PROCESSING' and lease_token = p_lease_token
    and lease_expires_at > statement_timestamp();
  return found;
end;
$$;

create policy storage_scanner_exact_pending_read on storage.objects for select to app_upload_scanner
using (public.can_scan_storage_object(storage.objects.bucket_id, storage.objects.name));
grant select on storage.objects to app_upload_scanner;

revoke execute on all functions in schema public from public, anon, authenticated, app_session_service, app_outbox_worker, app_upload_scanner;
grant usage on schema public to anon, authenticated, app_session_service, app_outbox_worker, app_upload_scanner;

grant execute on function public.list_public_laptops(date,date,integer,uuid),
  public.get_public_laptop(uuid) to anon, authenticated;
grant execute on function public.current_customer_id(), public.current_admin_id(),
  public.has_admin_role(public.admin_role[]), public.owns_rental(uuid),
  public.can_insert_storage_object(text,text) to authenticated;
grant execute on function public.get_current_contract(), public.get_payment_settings(),
  public.list_own_rentals(integer,uuid), public.get_own_rental(uuid),
  public.create_rental_quote(uuid,date,date),
  public.create_rental_from_quote(uuid,text,text,text,text,text),
  public.accept_rental_contract(uuid,uuid,text,text,text,text,text,text),
  public.create_upload_intent_record(public.evidence_purpose,uuid,text,text,bigint),
  public.authorize_upload_scan(uuid),
  public.submit_rental_payment(uuid,uuid,public.payment_type,text,text,text),
  public.get_admin_session(), public.list_admin_rentals(public.rental_status,integer,uuid), public.get_admin_rental(uuid),
  public.list_admin_laptops(boolean,integer,uuid),
  public.verify_rental_kyc(uuid,uuid[],text,integer,text,text,text),
  public.reject_rental_kyc(uuid,uuid[],text,integer,text,text,text),
  public.verify_rental_payment(uuid,uuid,text,text,integer,text,text,text),
  public.reject_rental_payment(uuid,uuid,text,integer,text,text,text),
  public.create_admin_laptop(text,jsonb,public.money_satang,public.money_satang,text,text,text),
  public.update_admin_laptop(uuid,text,jsonb,public.money_satang,public.money_satang,integer,text,text,text),
  public.retire_admin_laptop(uuid,integer,text,text,text),
  public.execute_rental_command(uuid,text,text,uuid,integer,text,text,text),
  public.list_rental_inspections(uuid),
  public.create_rental_inspection(uuid,public.inspection_type,uuid[],text,text,text,text),
  public.create_rental_fee_obligation(uuid,public.payment_type,public.money_satang,text,text,text,text),
  public.request_rental_refund(uuid,public.money_satang,text,text,text,text),
  public.list_admin_rental_history(uuid,integer,bigint), public.authorize_evidence_read(uuid),
  public.list_admin_settings(), public.update_admin_setting(text,text,integer,text,text,text),
  public.publish_admin_contract(text,text,timestamptz,text,text,text),
  public.list_admin_audit_events(text,uuid,integer,bigint) to authenticated;

grant execute on function public.app_issue_line_bootstrap_nonce(text,text,timestamptz),
  public.app_create_line_session(text,text,text,text,text,text,timestamptz,timestamptz),
  public.app_resolve_session(text), public.app_revoke_session(text) to app_session_service;
grant execute on function public.claim_notification_outbox(integer),
  public.complete_notification_outbox(uuid,uuid,boolean,text,integer) to app_outbox_worker;
grant execute on function public.can_scan_storage_object(text,text),
  public.finalize_upload_intent_record(uuid,text,bigint,text,text,text,text,text) to app_upload_scanner;

commit;
