-- Read-only aggregate/security checks after an isolated restore; no provider acceptance implied.
\set ON_ERROR_STOP on
begin read only;
do $$
begin
  if exists(select 1 from public.rentals where total_due_satang<>rental_subtotal_satang+deposit_satang)
    then raise exception 'restored rental money snapshot mismatch'; end if;
  if exists(select 1 from public.rental_inventory_reservations a join public.rental_inventory_reservations b
    on a.laptop_id=b.laptop_id and a.rental_id<b.rental_id and a.rental_dates && b.rental_dates)
    then raise exception 'restored overlapping reservations'; end if;
  if exists(select 1 from public.rental_financial_dispositions d left join public.refunds r on r.id=d.refund_id
    where r.id is null or r.rental_id<>d.rental_id or r.amount_satang<>d.refundable_satang
      or d.deposit_satang<>d.fee_total_satang+d.refundable_satang)
    then raise exception 'restored disposition obligation mismatch'; end if;
  if exists(select 1 from public.rentals r where r.status='COMPLETED' and not exists(
    select 1 from public.rental_financial_dispositions d join public.refunds f on f.id=d.refund_id
    where d.rental_id=r.id and f.status in ('COMPLETED','NOT_REQUIRED') and f.amount_satang=d.refundable_satang))
    then raise exception 'completed rental lacks settled exact disposition'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('rentals','evidence_objects','rental_financial_dispositions')
      and (not c.relrowsecurity or not c.relforcerowsecurity))
    then raise exception 'restored RLS boundary missing'; end if;
  if has_table_privilege('app_outbox_worker','public.customers','SELECT')
    or has_table_privilege('authenticated','public.rental_financial_dispositions','INSERT')
    or has_function_privilege('anon','public.confirm_rental_refund(uuid,uuid,public.money_satang,text,text,integer,text,text,text)','EXECUTE')
    then raise exception 'restored privileged grants broadened'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.rental_financial_dispositions'::regclass
    and tgname='rental_financial_dispositions_immutable' and tgenabled='O')
    then raise exception 'restored financial immutability trigger missing'; end if;
end;
$$;
select 'customers' as entity,count(*) as row_count from public.customers
union all select 'laptops',count(*) from public.laptops
union all select 'rentals',count(*) from public.rentals
union all select 'reservations',count(*) from public.rental_inventory_reservations
union all select 'quotes',count(*) from public.rental_quotes
union all select 'idempotency',count(*) from public.idempotency_records
union all select 'audit',count(*) from public.audit_events
union all select 'rental_history',count(*) from public.rental_status_history
union all select 'outbox',count(*) from public.notification_outbox
order by entity;
commit;
