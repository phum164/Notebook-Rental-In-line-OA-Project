begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.admin_role as enum ('OWNER', 'OPERATIONS', 'REVIEWER', 'VIEWER');
create type public.laptop_status as enum ('AVAILABLE', 'RESERVED', 'RENTED', 'MAINTENANCE', 'RETIRED');
create type public.rental_status as enum ('DRAFT', 'PENDING_PAYMENT', 'PENDING_REVIEW', 'APPROVED', 'PREPARING', 'READY_FOR_HANDOVER', 'ACTIVE', 'RETURN_PENDING', 'INSPECTION_PENDING', 'REFUND_PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');
create type public.payment_status as enum ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'VOIDED');
create type public.payment_type as enum ('RENT_AND_DEPOSIT', 'LATE_FEE', 'DAMAGE_FEE', 'REFUND');
create type public.refund_status as enum ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
create type public.inspection_type as enum ('BEFORE_RENT', 'AFTER_RETURN');
create type public.fulfillment_method as enum ('PICKUP', 'DELIVERY');
create type public.evidence_purpose as enum ('KYC_ID', 'PAYMENT_SLIP', 'CONDITION_BEFORE', 'CONDITION_AFTER', 'LAPTOP_PRODUCT');
create type public.evidence_status as enum ('PENDING_UPLOAD', 'QUARANTINED', 'READY', 'REJECTED');
create type public.actor_type as enum ('CUSTOMER', 'ADMIN', 'SYSTEM', 'SERVICE_WORKER');
create type public.outbox_status as enum ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

create domain public.money_satang as bigint check (value between 0 and 99999999999);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', statement_timestamp());
  return new;
end;
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique check (length(line_user_id) between 1 and 255),
  display_name text,
  phone text,
  disabled_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.admin_users (
  id uuid primary key references auth.users(id) on delete restrict,
  role public.admin_role not null,
  disabled_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.laptops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  daily_rate_satang public.money_satang not null,
  deposit_satang public.money_satang not null,
  currency char(3) not null default 'THB' check (currency = 'THB'),
  status public.laptop_status not null default 'AVAILABLE',
  deleted_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp()),
  check ((status = 'RETIRED') = (deleted_at is not null))
);

create table public.laptop_images (
  id uuid primary key default gen_random_uuid(),
  laptop_id uuid not null references public.laptops(id) on delete restrict,
  object_key text not null unique,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  unique (laptop_id, sort_order)
);

create table public.rental_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  laptop_id uuid not null references public.laptops(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  rental_days integer generated always as ((end_date - start_date) + 1) stored,
  daily_rate_satang public.money_satang not null,
  rental_subtotal_satang public.money_satang not null,
  deposit_satang public.money_satang not null,
  total_due_satang public.money_satang not null,
  currency char(3) not null default 'THB' check (currency = 'THB'),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  check (end_date >= start_date),
  check (rental_subtotal_satang = daily_rate_satang * ((end_date - start_date) + 1)),
  check (total_due_satang = rental_subtotal_satang + deposit_satang)
);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  laptop_id uuid not null references public.laptops(id) on delete restrict,
  quote_id uuid references public.rental_quotes(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  daily_rate_satang public.money_satang not null,
  rental_subtotal_satang public.money_satang not null,
  deposit_satang public.money_satang not null,
  total_due_satang public.money_satang not null,
  currency char(3) not null default 'THB' check (currency = 'THB'),
  status public.rental_status not null default 'DRAFT',
  hold_expires_at timestamptz,
  fulfillment_method public.fulfillment_method not null default 'PICKUP',
  recipient_name text,
  contact_phone text,
  address_snapshot jsonb,
  outbound_tracking_reference text,
  inbound_tracking_reference text,
  handed_over_at timestamptz,
  return_requested_at timestamptz,
  returned_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp()),
  check (end_date >= start_date),
  check (rental_subtotal_satang = daily_rate_satang * ((end_date - start_date) + 1)),
  check (total_due_satang = rental_subtotal_satang + deposit_satang),
  check ((status = 'PENDING_PAYMENT') = (hold_expires_at is not null) or status <> 'PENDING_PAYMENT'),
  check (fulfillment_method = 'DELIVERY' or address_snapshot is null),
  check (address_snapshot is null or jsonb_typeof(address_snapshot) = 'object')
);

comment on column public.rentals.start_date is 'Inclusive Asia/Bangkok civil date; no timezone conversion.';
comment on column public.rentals.end_date is 'Inclusive Asia/Bangkok civil date; no timezone conversion.';

create table public.rental_inventory_reservations (
  rental_id uuid primary key references public.rentals(id) on delete cascade,
  laptop_id uuid not null references public.laptops(id) on delete restrict,
  rental_dates daterange not null,
  hold_expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  check (not isempty(rental_dates)),
  exclude using gist (laptop_id with =, rental_dates with &&)
);

comment on table public.rental_inventory_reservations is 'Normalized set of blocking rentals. PENDING_PAYMENT remains blocking until the durable expiry routine removes it; application availability checks are not authoritative.';

create function public.sync_rental_inventory_reservation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  blocking boolean;
begin
  blocking := new.status in ('PENDING_PAYMENT', 'PENDING_REVIEW', 'APPROVED', 'PREPARING', 'READY_FOR_HANDOVER', 'ACTIVE', 'RETURN_PENDING', 'INSPECTION_PENDING', 'REFUND_PENDING');
  if blocking then
    insert into public.rental_inventory_reservations (rental_id, laptop_id, rental_dates, hold_expires_at)
    values (new.id, new.laptop_id, daterange(new.start_date, new.end_date, '[]'), case when new.status = 'PENDING_PAYMENT' then new.hold_expires_at end)
    on conflict (rental_id) do update set
      laptop_id = excluded.laptop_id,
      rental_dates = excluded.rental_dates,
      hold_expires_at = excluded.hold_expires_at;
  else
    delete from public.rental_inventory_reservations where rental_id = new.id;
  end if;
  return new;
end;
$$;

create trigger rentals_inventory_reservation
after insert or update of laptop_id, start_date, end_date, status, hold_expires_at on public.rentals
for each row execute function public.sync_rental_inventory_reservation();

create function public.expire_rental_holds(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare affected integer;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'p_limit must be between 1 and 1000'; end if;
  with candidates as (
    select id from public.rentals
    where status = 'PENDING_PAYMENT' and hold_expires_at <= statement_timestamp()
    order by hold_expires_at for update skip locked limit p_limit
  )
  update public.rentals r
  set status = 'EXPIRED', version = version + 1
  from candidates c where r.id = c.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.expire_rental_holds(integer) from public, anon, authenticated;

create table public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  content_snapshot text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_by uuid not null references public.admin_users(id) on delete restrict,
  published_at timestamptz not null default timezone('utc', statement_timestamp()),
  retired_at timestamptz
);

create table public.contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null unique references public.rentals(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contract_version_id uuid not null references public.contract_versions(id) on delete restrict,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default timezone('utc', statement_timestamp()),
  request_id text not null,
  ip_hash text,
  user_agent_hash text
);

create table public.evidence_objects (
  id uuid primary key default gen_random_uuid(),
  purpose public.evidence_purpose not null,
  customer_id uuid references public.customers(id) on delete restrict,
  rental_id uuid references public.rentals(id) on delete restrict,
  bucket_id text not null,
  object_key text not null,
  declared_mime_type text not null check (declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  detected_mime_type text check (detected_mime_type is null or detected_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  status public.evidence_status not null default 'PENDING_UPLOAD',
  finalized_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  unique (bucket_id, object_key),
  check (bucket_id in ('kyc-private', 'payments-private', 'conditions-private', 'laptop-public')),
  check (
    (purpose = 'LAPTOP_PRODUCT' and bucket_id = 'laptop-public')
    or (purpose = 'KYC_ID' and bucket_id = 'kyc-private')
    or (purpose = 'PAYMENT_SLIP' and bucket_id = 'payments-private')
    or (purpose in ('CONDITION_BEFORE', 'CONDITION_AFTER') and bucket_id = 'conditions-private')
  )
);

create function public.enforce_evidence_limits() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare allowed_count integer;
declare existing_count integer;
begin
  if new.rental_id is null or new.purpose not in ('KYC_ID', 'PAYMENT_SLIP') then return new; end if;
  allowed_count := case new.purpose when 'KYC_ID' then 2 else 3 end;
  perform 1 from public.rentals where id = new.rental_id for update;
  select count(*) into existing_count
  from public.evidence_objects e
  where e.rental_id = new.rental_id and e.purpose = new.purpose and e.id <> new.id;
  if existing_count >= allowed_count then
    raise exception 'evidence limit exceeded for %', new.purpose using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger evidence_object_limits before insert or update of rental_id, purpose on public.evidence_objects
for each row execute function public.enforce_evidence_limits();

create table public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null unique references public.evidence_objects(id) on delete cascade,
  owner_customer_id uuid references public.customers(id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  check (expires_at > created_at)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete restrict,
  type public.payment_type not null,
  status public.payment_status not null default 'PENDING',
  amount_satang public.money_satang not null,
  currency char(3) not null default 'THB' check (currency = 'THB'),
  evidence_id uuid references public.evidence_objects(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  submitted_at timestamptz,
  verified_by uuid references public.admin_users(id) on delete restrict,
  verified_at timestamptz,
  decision_reason text,
  provider_reference text,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp()),
  unique (rental_id, type, attempt_number),
  check ((status in ('SUBMITTED', 'VERIFIED', 'REJECTED')) = (evidence_id is not null)),
  check ((status = 'VERIFIED') = (verified_by is not null and verified_at is not null) or status <> 'VERIFIED'),
  check ((status in ('VERIFIED', 'REJECTED')) = (decision_reason is not null) or status not in ('VERIFIED', 'REJECTED'))
);

create table public.condition_logs (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete restrict,
  inspection_type public.inspection_type not null,
  notes text,
  finalized_at timestamptz,
  finalized_by uuid references public.admin_users(id) on delete restrict,
  supersedes_id uuid references public.condition_logs(id) on delete restrict,
  created_by uuid not null references public.admin_users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  check ((finalized_at is null) = (finalized_by is null)),
  unique (rental_id, inspection_type, supersedes_id)
);

create table public.condition_log_evidence (
  condition_log_id uuid not null references public.condition_logs(id) on delete restrict,
  evidence_id uuid not null unique references public.evidence_objects(id) on delete restrict,
  sort_order integer not null check (sort_order between 0 and 11),
  primary key (condition_log_id, sort_order)
);

create table public.fee_obligations (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete restrict,
  category text not null,
  amount_satang public.money_satang not null,
  reason text not null,
  assessed_by uuid not null references public.admin_users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete restrict,
  status public.refund_status not null default 'NOT_REQUIRED',
  amount_satang public.money_satang not null,
  currency char(3) not null default 'THB' check (currency = 'THB'),
  reason text not null,
  requested_by uuid references public.admin_users(id) on delete restrict,
  approved_by uuid references public.admin_users(id) on delete restrict,
  idempotency_key text not null,
  provider_reference text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  updated_at timestamptz not null default timezone('utc', statement_timestamp()),
  unique (rental_id, idempotency_key),
  check ((status = 'COMPLETED') = (completed_at is not null) or status <> 'COMPLETED')
);

create table public.refund_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  outcome text not null,
  provider_reference text,
  error_category text,
  attempted_at timestamptz not null default timezone('utc', statement_timestamp()),
  unique (refund_id, attempt_number)
);

create table public.rental_status_history (
  id bigint generated always as identity primary key,
  rental_id uuid not null references public.rentals(id) on delete restrict,
  prior_status public.rental_status,
  new_status public.rental_status not null,
  actor_type public.actor_type not null,
  actor_id uuid,
  reason text,
  request_id text,
  created_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_type public.actor_type not null,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  request_id text,
  idempotency_key text,
  prior_status text,
  new_status text,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  principal_type public.actor_type not null,
  principal_id uuid not null,
  operation text not null,
  target_id uuid,
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  created_at timestamptz not null default timezone('utc', statement_timestamp()),
  expires_at timestamptz,
  unique nulls not distinct (principal_type, principal_id, operation, target_id, idempotency_key)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  recipient_customer_id uuid references public.customers(id) on delete restrict,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null unique,
  status public.outbox_status not null default 'PENDING',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default timezone('utc', statement_timestamp()),
  delivered_at timestamptz,
  created_at timestamptz not null default timezone('utc', statement_timestamp())
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_by uuid not null references public.admin_users(id) on delete restrict,
  updated_at timestamptz not null default timezone('utc', statement_timestamp())
);

create function public.reject_immutable_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '55000'; end;
$$;
create function public.reject_finalized_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.finalized_at is not null then
    raise exception 'finalized % row is append-only', tg_table_name using errcode = '55000';
  end if;
  return new;
end;
$$;
create function public.reject_verified_payment_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'VERIFIED' then
    raise exception 'verified payment is append-only' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function public.reject_immutable_change();
create trigger contract_versions_immutable before update or delete on public.contract_versions for each row execute function public.reject_immutable_change();
create trigger contract_acceptances_immutable before update or delete on public.contract_acceptances for each row execute function public.reject_immutable_change();
create trigger rental_status_history_immutable before update or delete on public.rental_status_history for each row execute function public.reject_immutable_change();
create trigger evidence_objects_finalized_immutable before update or delete on public.evidence_objects for each row execute function public.reject_finalized_change();
create trigger condition_logs_finalized_immutable before update or delete on public.condition_logs for each row execute function public.reject_finalized_change();
create trigger payments_verified_immutable before update or delete on public.payments for each row execute function public.reject_verified_payment_change();

create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger admin_users_updated_at before update on public.admin_users for each row execute function public.set_updated_at();
create trigger laptops_updated_at before update on public.laptops for each row execute function public.set_updated_at();
create trigger rentals_updated_at before update on public.rentals for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger refunds_updated_at before update on public.refunds for each row execute function public.set_updated_at();

create index laptops_catalog_idx on public.laptops (status, created_at desc) where deleted_at is null;
create index rentals_customer_created_idx on public.rentals (customer_id, created_at desc);
create index rentals_laptop_dates_idx on public.rentals (laptop_id, start_date, end_date);
create index rentals_status_hold_idx on public.rentals (status, hold_expires_at) where status = 'PENDING_PAYMENT';
create index payments_rental_idx on public.payments (rental_id, created_at desc);
create index condition_logs_rental_idx on public.condition_logs (rental_id, inspection_type, created_at desc);
create index evidence_rental_purpose_idx on public.evidence_objects (rental_id, purpose, created_at desc);
create index audit_target_idx on public.audit_events (target_type, target_id, occurred_at desc);
create index outbox_claim_idx on public.notification_outbox (status, next_attempt_at) where status in ('PENDING', 'FAILED');

commit;
