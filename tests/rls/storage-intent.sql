begin;

select set_config('app.settings.customer_jwt_issuer', 'https://db-jwt.test.local', true);
select set_config('app.settings.customer_jwt_audience', 'notebook-rental-db', true);

insert into public.customers (id, line_user_id) values
  ('51000000-0000-4000-8000-000000000001', 'intent-customer-1'),
  ('51000000-0000-4000-8000-000000000002', 'intent-customer-2');
insert into public.laptops (id, name, daily_rate_satang, deposit_satang)
values ('52000000-0000-4000-8000-000000000001', 'intent laptop', 10000, 50000);
insert into public.rentals (
  id, customer_id, laptop_id, start_date, end_date, daily_rate_satang,
  rental_subtotal_satang, deposit_satang, total_due_satang, status
) values (
  '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001', date '2026-08-01', date '2026-08-01',
  10000, 10000, 50000, 60000, 'DRAFT'
);
insert into public.evidence_objects (
  id, purpose, customer_id, rental_id, bucket_id, object_key, declared_mime_type, size_bytes
) values (
  '54000000-0000-4000-8000-000000000001', 'KYC_ID', '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001', 'kyc-private',
  'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object',
  'image/jpeg', 1024
);
insert into public.upload_intents (id, evidence_id, owner_customer_id, expires_at)
values (
  '55000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', statement_timestamp() + interval '5 minutes'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated', 'principal_type', 'customer',
    'sub', '51000000-0000-4000-8000-000000000001',
    'iss', 'https://db-jwt.test.local', 'aud', 'notebook-rental-db',
    'iat', extract(epoch from statement_timestamp())::bigint,
    'nbf', extract(epoch from statement_timestamp())::bigint - 1,
    'exp', extract(epoch from statement_timestamp())::bigint + 299
  )::text,
  true
);
set local role authenticated;
do $$ begin
  if not public.can_insert_storage_object('kyc-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object') then
    raise exception 'valid customer-bound intent was denied';
  end if;
  if public.can_insert_storage_object('payments-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object') then
    raise exception 'wrong bucket was allowed';
  end if;
  if public.can_insert_storage_object('kyc-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/other') then
    raise exception 'wrong key was allowed';
  end if;
end $$;

reset role;
update public.upload_intents set consumed_at = statement_timestamp() where id = '55000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  if public.can_insert_storage_object('kyc-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object') then
    raise exception 'consumed intent was allowed';
  end if;
end $$;

reset role;
update public.upload_intents set consumed_at = null, created_at = statement_timestamp() - interval '10 minutes', expires_at = statement_timestamp() - interval '1 second' where id = '55000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  if public.can_insert_storage_object('kyc-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object') then
    raise exception 'expired intent was allowed';
  end if;
end $$;

reset role;
update public.upload_intents set expires_at = statement_timestamp() + interval '5 minutes' where id = '55000000-0000-4000-8000-000000000001';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated', 'principal_type', 'customer',
    'sub', '51000000-0000-4000-8000-000000000002',
    'iss', 'https://db-jwt.test.local', 'aud', 'notebook-rental-db',
    'iat', extract(epoch from statement_timestamp())::bigint,
    'nbf', extract(epoch from statement_timestamp())::bigint - 1,
    'exp', extract(epoch from statement_timestamp())::bigint + 299
  )::text,
  true
);
set local role authenticated;
do $$ begin
  if public.can_insert_storage_object('kyc-private', 'kyc/53000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/object') then
    raise exception 'cross-customer intent was allowed';
  end if;
end $$;

rollback;

