begin;

do $$
declare customer_one uuid := gen_random_uuid();
declare laptop_one uuid := gen_random_uuid();
begin
  insert into public.customers (id, line_user_id) values (customer_one, 'constraint-' || customer_one::text);
  begin
    insert into public.customers (line_user_id) values ('constraint-' || customer_one::text);
    raise exception 'expected duplicate line_user_id rejection';
  exception when unique_violation then null;
  end;

  begin
    insert into public.laptops (name, daily_rate_satang, deposit_satang) values ('invalid money', -1, 0);
    raise exception 'expected negative money rejection';
  exception when check_violation then null;
  end;

  insert into public.laptops (id, name, daily_rate_satang, deposit_satang)
  values (laptop_one, 'constraint laptop', 10000, 50000);

  begin
    insert into public.rentals (
      customer_id, laptop_id, start_date, end_date, daily_rate_satang,
      rental_subtotal_satang, deposit_satang, total_due_satang, status
    ) values (customer_one, laptop_one, date '2026-08-02', date '2026-08-01', 10000, 0, 50000, 50000, 'DRAFT');
    raise exception 'expected invalid inclusive date range rejection';
  exception when check_violation then null;
  end;

  update public.laptops set status = 'RETIRED', deleted_at = statement_timestamp() where id = laptop_one;
  if not exists (select 1 from public.laptops where id = laptop_one and deleted_at is not null) then
    raise exception 'soft-deleted laptop history was lost';
  end if;
end $$;

rollback;

