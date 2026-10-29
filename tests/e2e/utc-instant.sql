-- A06 independent SRD-P02 regression. Run on the isolated migrated synthetic database; all rows roll back.
begin;

do $$
declare zone text; customer uuid; laptop uuid; created timestamptz; updated timestamptz;
begin
  foreach zone in array array['UTC','Asia/Bangkok','America/New_York'] loop
    perform set_config('TimeZone',zone,true);
    insert into public.customers(line_user_id) values('a06-synthetic-time-' || gen_random_uuid())
      returning id,created_at,updated_at into customer,created,updated;
    if created<>statement_timestamp() or updated<>statement_timestamp() then
      raise exception 'TIME-UTC-01: customer defaults shifted under % (created delta %, updated delta %)',zone,created-statement_timestamp(),updated-statement_timestamp();
    end if;
    update public.customers set display_name='Synthetic timezone regression' where id=customer returning updated_at into updated;
    if updated<>statement_timestamp() then raise exception 'TIME-UTC-02: customer update trigger shifted under % by %',zone,updated-statement_timestamp(); end if;
    insert into public.laptops(name,daily_rate_satang,deposit_satang) values('Synthetic timezone notebook',10000,50000)
      returning id,created_at,updated_at into laptop,created,updated;
    if created<>statement_timestamp() or updated<>statement_timestamp() then
      raise exception 'TIME-UTC-03: laptop defaults shifted under % (created delta %, updated delta %)',zone,created-statement_timestamp(),updated-statement_timestamp();
    end if;
    update public.laptops set name='Synthetic timezone notebook updated' where id=laptop returning updated_at into updated;
    if updated<>statement_timestamp() then raise exception 'TIME-UTC-04: laptop update trigger shifted under % by %',zone,updated-statement_timestamp(); end if;
  end loop;
  if exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.atttypid='timestamptz'::regtype and pg_get_expr(d.adbin,d.adrelid) ~* 'timezone\(') then
    raise exception 'TIME-UTC-05: a public timestamptz default still converts an instant through timestamp-without-time-zone';
  end if;
end;
$$;

rollback;
