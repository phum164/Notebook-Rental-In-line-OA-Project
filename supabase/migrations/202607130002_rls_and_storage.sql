begin;

create function public.current_customer_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  claims jsonb := auth.jwt();
  subject text := claims ->> 'sub';
  expected_issuer text := current_setting('app.settings.customer_jwt_issuer', true);
  expected_audience text := current_setting('app.settings.customer_jwt_audience', true);
  issued_at numeric;
  not_before numeric;
  expires_at numeric;
  token_audience jsonb;
  customer_id uuid;
begin
  if claims is null
    or claims ->> 'principal_type' <> 'customer'
    or claims ->> 'role' <> 'authenticated'
    or expected_issuer is null or expected_issuer = ''
    or expected_audience is null or expected_audience = ''
    or claims ->> 'iss' <> expected_issuer
    or subject is null
    or subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return null; end if;

  token_audience := claims -> 'aud';
  if not (
    (jsonb_typeof(token_audience) = 'string' and token_audience #>> '{}' = expected_audience)
    or (jsonb_typeof(token_audience) = 'array' and token_audience ? expected_audience)
  ) then return null; end if;

  begin
    issued_at := (claims ->> 'iat')::numeric;
    not_before := (claims ->> 'nbf')::numeric;
    expires_at := (claims ->> 'exp')::numeric;
  exception when others then return null;
  end;
  if issued_at is null or not_before is null or expires_at is null
    or issued_at > extract(epoch from statement_timestamp()) + 30
    or not_before > extract(epoch from statement_timestamp()) + 30
    or expires_at <= extract(epoch from statement_timestamp())
    or expires_at - issued_at > 300
  then return null; end if;

  customer_id := subject::uuid;
  if not exists (select 1 from public.customers c where c.id = customer_id and c.disabled_at is null)
  then return null; end if;
  return customer_id;
exception when others then
  return null;
end;
$$;

create function public.current_admin_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id
  from public.admin_users a
  where a.id = auth.uid()
    and a.disabled_at is null
    and coalesce(auth.jwt() ->> 'principal_type', '') <> 'customer'
    and auth.jwt() ->> 'aal' = 'aal2'
$$;

create function public.has_admin_role(required_roles public.admin_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = public.current_admin_id()
      and a.disabled_at is null
      and a.role = any(required_roles)
  )
$$;

create function public.owns_rental(candidate_rental_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.rentals r
    where r.id = candidate_rental_id
      and r.customer_id = public.current_customer_id()
  )
$$;

create function public.can_insert_storage_object(candidate_bucket text, candidate_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.evidence_objects e
    join public.upload_intents i on i.evidence_id = e.id
    where e.bucket_id = candidate_bucket
      and e.object_key = candidate_name
      and e.status = 'PENDING_UPLOAD'
      and i.consumed_at is null
      and i.expires_at > statement_timestamp()
      and (
        (e.purpose = 'KYC_ID' and e.bucket_id = 'kyc-private')
        or (e.purpose = 'PAYMENT_SLIP' and e.bucket_id = 'payments-private')
        or (e.purpose in ('CONDITION_BEFORE','CONDITION_AFTER') and e.bucket_id = 'conditions-private')
      )
      and (
        (i.owner_customer_id = public.current_customer_id() and e.purpose in ('KYC_ID','PAYMENT_SLIP'))
        or (e.purpose in ('CONDITION_BEFORE','CONDITION_AFTER') and public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]))
      )
  )
$$;

revoke all on function public.current_customer_id() from public;
revoke all on function public.current_admin_id() from public;
revoke all on function public.has_admin_role(public.admin_role[]) from public;
revoke all on function public.owns_rental(uuid) from public;
revoke all on function public.can_insert_storage_object(text, text) from public;
grant execute on function public.current_customer_id(), public.current_admin_id(), public.has_admin_role(public.admin_role[]), public.owns_rental(uuid), public.can_insert_storage_object(text, text) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customers','admin_users','laptops','laptop_images','rental_quotes','rentals',
    'rental_inventory_reservations','contract_versions','contract_acceptances',
    'evidence_objects','upload_intents','payments','condition_logs','condition_log_evidence',
    'fee_obligations','refunds','refund_attempts','rental_status_history','audit_events',
    'idempotency_records','notification_outbox','system_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;

grant select (id, name, specs, daily_rate_satang, deposit_satang, currency, status, created_at, updated_at) on public.laptops to anon, authenticated;
create policy laptops_public_read on public.laptops for select to anon, authenticated
using (deleted_at is null and status <> 'RETIRED');
grant insert, update on public.laptops to authenticated;
create policy laptops_operations_insert on public.laptops for insert to authenticated
with check (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));
create policy laptops_operations_update on public.laptops for update to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]))
with check (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));

grant select on public.laptop_images to anon, authenticated;
create policy laptop_images_public_read on public.laptop_images for select to anon, authenticated
using (exists (select 1 from public.laptops l where l.id = laptop_id and l.deleted_at is null and l.status <> 'RETIRED'));

grant select on public.customers to authenticated;
create policy customers_own_read on public.customers for select to authenticated
using (id = public.current_customer_id());
create policy customers_privileged_read on public.customers for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER']::public.admin_role[]));

grant select on public.rental_quotes to authenticated;
create policy rental_quotes_own_read on public.rental_quotes for select to authenticated
using (customer_id = public.current_customer_id());
create policy rental_quotes_admin_read on public.rental_quotes for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER']::public.admin_role[]));

grant select on public.rentals to authenticated;
create policy rentals_own_read on public.rentals for select to authenticated
using (customer_id = public.current_customer_id());
create policy rentals_admin_read on public.rentals for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]));

grant select on public.payments to authenticated;
create policy payments_own_read on public.payments for select to authenticated
using (public.owns_rental(rental_id));
create policy payments_review_read on public.payments for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER']::public.admin_role[]));

grant select on public.refunds, public.fee_obligations to authenticated;
create policy refunds_own_read on public.refunds for select to authenticated using (public.owns_rental(rental_id));
create policy refunds_operations_read on public.refunds for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));
create policy fees_own_read on public.fee_obligations for select to authenticated using (public.owns_rental(rental_id));
create policy fees_operations_read on public.fee_obligations for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));

grant select (id, rental_id, inspection_type, finalized_at, finalized_by, supersedes_id, created_by, created_at) on public.condition_logs to authenticated;
grant insert on public.condition_logs, public.condition_log_evidence to authenticated;
create policy condition_logs_customer_timeline on public.condition_logs for select to authenticated
using (public.owns_rental(rental_id));
create policy condition_logs_operations_read on public.condition_logs for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));
create policy condition_logs_operations_insert on public.condition_logs for insert to authenticated
with check (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]) and created_by = public.current_admin_id());
create policy condition_evidence_operations_insert on public.condition_log_evidence for insert to authenticated
with check (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]));

grant select on public.evidence_objects to authenticated;
create policy evidence_reviewer_read on public.evidence_objects for select to authenticated
using (public.has_admin_role(array['OWNER','REVIEWER']::public.admin_role[]) and purpose in ('KYC_ID','PAYMENT_SLIP'));
create policy evidence_operations_read on public.evidence_objects for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]) and purpose in ('CONDITION_BEFORE','CONDITION_AFTER'));

grant select on public.contract_versions to anon, authenticated;
create policy contract_versions_public_read on public.contract_versions for select to anon, authenticated using (published_at <= statement_timestamp());
grant select on public.contract_acceptances, public.rental_status_history to authenticated;
create policy contract_acceptances_own_read on public.contract_acceptances for select to authenticated
using (customer_id = public.current_customer_id());
create policy contract_acceptances_admin_read on public.contract_acceptances for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER']::public.admin_role[]));
create policy rental_history_own_read on public.rental_status_history for select to authenticated
using (public.owns_rental(rental_id));
create policy rental_history_admin_read on public.rental_status_history for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]));

grant select on public.admin_users to authenticated;
create policy admin_users_self_read on public.admin_users for select to authenticated using (id = public.current_admin_id());
create policy admin_users_owner_read on public.admin_users for select to authenticated
using (public.has_admin_role(array['OWNER']::public.admin_role[]));

grant select (id, actor_type, actor_id, action, target_type, target_id, request_id, idempotency_key, prior_status, new_status, outcome, occurred_at) on public.audit_events to authenticated;
create policy audit_admin_read on public.audit_events for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]));

grant select (key, version, updated_by, updated_at) on public.system_settings to authenticated;
create policy settings_admin_read on public.system_settings for select to authenticated
using (public.has_admin_role(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('laptop-public', 'laptop-public', true, 10485760, array['image/jpeg','image/png','image/webp']),
  ('kyc-private', 'kyc-private', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('payments-private', 'payments-private', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('conditions-private', 'conditions-private', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('quarantine-private', 'quarantine-private', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy storage_product_admin_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'laptop-public'
  and public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[])
  and name ~ '^laptops/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp)$'
);

create policy storage_intent_bound_insert on storage.objects for insert to authenticated
with check (
  bucket_id in ('kyc-private','payments-private','conditions-private')
  and public.can_insert_storage_object(storage.objects.bucket_id, storage.objects.name)
);

create policy storage_authorized_case_read on storage.objects for select to authenticated
using (
  bucket_id in ('kyc-private','payments-private','conditions-private')
  and exists (
    select 1
    from public.evidence_objects e
    where e.bucket_id = storage.objects.bucket_id
      and e.object_key = storage.objects.name
      and e.status = 'READY'
      and (
        (e.purpose in ('KYC_ID','PAYMENT_SLIP') and public.has_admin_role(array['OWNER','REVIEWER']::public.admin_role[]))
        or (e.purpose in ('CONDITION_BEFORE','CONDITION_AFTER') and public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]))
      )
  )
);

commit;
