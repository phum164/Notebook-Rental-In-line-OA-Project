begin;

-- timestamptz already stores an instant; stripping its zone before assignment shifts it
-- by the caller's session TimeZone. Historical rows cannot be repaired without provenance.
do $$
declare target record;
begin
  for target in
    select c.relname,a.attname from pg_attrdef d
    join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.atttypid='timestamptz'::regtype
      and pg_get_expr(d.adbin,d.adrelid)='timezone(''utc''::text, statement_timestamp())'
  loop
    execute format('alter table public.%I alter column %I set default statement_timestamp()',target.relname,target.attname);
  end loop;
end;
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

-- Keep READY evidence and live upload reservations within the existing cap without
-- letting expired/negative-scan metadata permanently prevent a replacement upload.
create or replace function public.enforce_evidence_limits() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare allowed_count integer; existing_count integer;
begin
  if new.rental_id is null or new.purpose not in ('KYC_ID','PAYMENT_SLIP') then return new; end if;
  allowed_count:=case new.purpose when 'KYC_ID' then 2 else 3 end;
  perform 1 from public.rentals where id=new.rental_id for update;
  select count(*) into existing_count from public.evidence_objects e
  where e.rental_id=new.rental_id and e.purpose=new.purpose and e.id<>new.id
    and (e.status='READY' or (e.status='PENDING_UPLOAD' and exists(
      select 1 from public.upload_intents i where i.evidence_id=e.id and i.consumed_at is null and i.expires_at>statement_timestamp())))
    and ((new.purpose='KYC_ID' and not exists(
      select 1 from public.kyc_submission_evidence se join public.kyc_decisions d on d.submission_id=se.submission_id
      where se.evidence_id=e.id and d.status='REJECTED'))
      or (new.purpose='PAYMENT_SLIP' and not exists(
        select 1 from public.payments p where p.evidence_id=e.id and p.status in ('REJECTED','VOIDED'))));
  if existing_count>=allowed_count then raise exception 'evidence limit exceeded for %',new.purpose using errcode='23514'; end if;
  return new;
end;
$$;

commit;
