do $$
begin
  if (select count(*) from public.rentals where laptop_id='29000000-0000-4000-8000-000000000001')<>1 then raise exception 'expected exactly one committed booking'; end if;
  if (select count(*) from public.rental_inventory_reservations where laptop_id='29000000-0000-4000-8000-000000000001')<>1 then raise exception 'reservation count wrong'; end if;
  if (select count(*) from public.idempotency_records where idempotency_key in ('booking-concurrent-key-a','booking-concurrent-key-b'))<>1 then raise exception 'orphan/duplicate idempotency record'; end if;
  if exists(select 1 from public.idempotency_records where idempotency_key='booking-concurrent-key-b') then raise exception 'failed booking persisted idempotency'; end if;
  if (select count(*) from public.audit_events where request_id in ('race-a','race-b'))<>1 then raise exception 'failed booking left audit'; end if;
  if (select count(*) from public.rental_status_history where request_id in ('race-a','race-b'))<>1 then raise exception 'failed booking left history'; end if;
  if (select count(*) from public.rental_quotes where laptop_id='29000000-0000-4000-8000-000000000001' and consumed_at is not null)<>1 then raise exception 'failed booking consumed quote'; end if;
  if exists(select 1 from public.notification_outbox o where o.aggregate_type='rental' and not exists(select 1 from public.rentals r where r.id=o.aggregate_id)) then raise exception 'orphan outbox'; end if;
end;
$$;
