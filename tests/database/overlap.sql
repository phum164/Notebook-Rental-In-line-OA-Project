begin;

do $$
declare customer_one uuid := gen_random_uuid();
declare laptop_one uuid := gen_random_uuid();
begin
  insert into public.customers (id, line_user_id) values (customer_one, 'overlap-' || customer_one::text);
  insert into public.laptops (id, name, daily_rate_satang, deposit_satang)
  values (laptop_one, 'overlap laptop', 10000, 50000);

  insert into public.rentals (
    customer_id, laptop_id, start_date, end_date, daily_rate_satang,
    rental_subtotal_satang, deposit_satang, total_due_satang, status, hold_expires_at
  ) values (customer_one, laptop_one, date '2026-08-01', date '2026-08-03', 10000, 30000, 50000, 80000, 'PENDING_PAYMENT', statement_timestamp() + interval '30 minutes');

  begin
    insert into public.rentals (
      customer_id, laptop_id, start_date, end_date, daily_rate_satang,
      rental_subtotal_satang, deposit_satang, total_due_satang, status, hold_expires_at
    ) values (customer_one, laptop_one, date '2026-08-03', date '2026-08-04', 10000, 20000, 50000, 70000, 'PENDING_PAYMENT', statement_timestamp() + interval '30 minutes');
    raise exception 'expected inclusive overlap rejection';
  exception when exclusion_violation then null;
  end;

  insert into public.rentals (
    customer_id, laptop_id, start_date, end_date, daily_rate_satang,
    rental_subtotal_satang, deposit_satang, total_due_satang, status, hold_expires_at
  ) values (customer_one, laptop_one, date '2026-08-04', date '2026-08-04', 10000, 10000, 50000, 60000, 'PENDING_PAYMENT', statement_timestamp() - interval '1 minute');

  if public.expire_rental_holds() < 1 then raise exception 'expected an expired hold'; end if;
  if exists (
    select 1 from public.rental_inventory_reservations i
    join public.rentals r on r.id = i.rental_id
    where r.hold_expires_at <= statement_timestamp()
  ) then raise exception 'expired reservation still blocks inventory'; end if;
end $$;

rollback;

