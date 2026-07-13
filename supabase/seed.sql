begin;

insert into public.customers (id, line_user_id, display_name)
values
  ('10000000-0000-4000-8000-000000000001', 'seed-line-subject-001', 'Seed Customer One'),
  ('10000000-0000-4000-8000-000000000002', 'seed-line-subject-002', 'Seed Customer Two')
on conflict (id) do nothing;

insert into public.laptops (id, name, specs, daily_rate_satang, deposit_satang, status)
values
  ('20000000-0000-4000-8000-000000000001', 'Seed Notebook A', '{"cpu":"Synthetic CPU","ramGb":16}'::jsonb, 45000, 300000, 'AVAILABLE'),
  ('20000000-0000-4000-8000-000000000002', 'Seed Notebook B', '{"cpu":"Synthetic CPU","ramGb":8}'::jsonb, 30000, 200000, 'AVAILABLE')
on conflict (id) do nothing;

insert into public.rental_quotes (
  id, customer_id, laptop_id, start_date, end_date,
  daily_rate_satang, rental_subtotal_satang, deposit_satang, total_due_satang, expires_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  current_date + 30, current_date + 32,
  45000, 135000, 300000, 435000,
  statement_timestamp() + interval '15 minutes'
)
on conflict (id) do nothing;

insert into public.rentals (
  id, customer_id, laptop_id, quote_id, start_date, end_date,
  daily_rate_satang, rental_subtotal_satang, deposit_satang, total_due_satang, status
)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  current_date + 30, current_date + 32,
  45000, 135000, 300000, 435000, 'DRAFT'
)
on conflict (id) do nothing;

commit;

