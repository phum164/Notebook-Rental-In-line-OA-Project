begin;

create function public._recent_mfa_epoch() returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare claims jsonb := auth.jwt(); entry jsonb; candidate numeric; latest numeric; expires numeric;
  now_epoch numeric := extract(epoch from statement_timestamp());
begin
  if coalesce(claims ->> 'exp','') !~ '^[0-9]{1,12}$' then return null; end if;
  expires := (claims ->> 'exp')::numeric;
  if expires <= now_epoch then return null; end if;
  if coalesce(claims ->> 'mfa_verified_at','') ~ '^[0-9]{1,12}$' then
    candidate := (claims ->> 'mfa_verified_at')::numeric;
    if candidate > 0 and candidate <= now_epoch + 30 and candidate < expires then latest := candidate; end if;
  end if;
  for entry in select value from jsonb_array_elements(case when jsonb_typeof(claims -> 'amr') = 'array' then claims -> 'amr' else '[]'::jsonb end) loop
    if entry ->> 'method' = 'totp' and coalesce(entry ->> 'timestamp','') ~ '^[0-9]{1,12}$' then
      candidate := (entry ->> 'timestamp')::numeric;
      if candidate > 0 and candidate <= now_epoch + 30 and candidate < expires then latest := greatest(latest,candidate); end if;
    end if;
  end loop;
  return latest;
exception when others then return null;
end;
$$;

create or replace function public._require_admin(required_roles public.admin_role[],require_recent_mfa boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public.current_admin_id(); verified_epoch numeric;
begin
  if actor is null or public.has_admin_role(required_roles) is not true
  then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if require_recent_mfa then
    verified_epoch := public._recent_mfa_epoch();
    if verified_epoch is null or verified_epoch < extract(epoch from statement_timestamp()) - 600
    then raise exception 'RECENT_MFA_REQUIRED' using errcode = '42501'; end if;
  end if;
  return actor;
end;
$$;

create or replace function public.get_admin_session() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER','OPERATIONS','REVIEWER','VIEWER']::public.admin_role[]);
  admin public.admin_users%rowtype; verified_epoch numeric := public._recent_mfa_epoch();
begin
  select * into admin from public.admin_users where id = actor and disabled_at is null;
  return jsonb_build_object('id',admin.id,'roles',jsonb_build_array(admin.role),'mfaVerified',true,
    'mfaVerifiedAt',case when verified_epoch is null then null else to_jsonb(to_timestamp(verified_epoch)) end);
end;
$$;

create table public.rental_financial_dispositions (
  rental_id uuid primary key references public.rentals(id) on delete restrict,
  inspection_id uuid not null unique references public.condition_logs(id) on delete restrict,
  kind text not null check (kind in ('NO_FEES','ITEMIZED')),
  deposit_satang public.money_satang not null,
  fee_total_satang public.money_satang not null,
  refundable_satang public.money_satang not null,
  fee_snapshot jsonb not null check (jsonb_typeof(fee_snapshot) = 'array'),
  refund_id uuid not null unique references public.refunds(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  finalized_by uuid not null references public.admin_users(id) on delete restrict,
  finalized_at timestamptz not null default statement_timestamp(),
  check (deposit_satang = fee_total_satang + refundable_satang),
  check ((kind = 'NO_FEES') = (fee_total_satang = 0))
);
alter table public.rental_financial_dispositions enable row level security;
alter table public.rental_financial_dispositions force row level security;
revoke all on public.rental_financial_dispositions from public,anon,authenticated,
  app_session_service,app_outbox_worker,app_upload_scanner,app_line_webhook_ingress,app_line_webhook_worker;
create trigger rental_financial_dispositions_immutable before update or delete on public.rental_financial_dispositions
  for each row execute function public.reject_immutable_change();
create trigger refund_attempts_immutable before update or delete on public.refund_attempts
  for each row execute function public.reject_immutable_change();
create trigger refunds_completed_immutable before update or delete on public.refunds
  for each row when (old.status = 'COMPLETED') execute function public.reject_immutable_change();
create unique index refunds_completed_provider_reference_key on public.refunds(lower(btrim(provider_reference)))
  where status = 'COMPLETED' and provider_reference is not null;

create function public.reject_disposed_fee_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate_rental_id uuid := case when tg_op = 'DELETE' then old.rental_id else new.rental_id end;
begin
  perform 1 from public.rentals where id = candidate_rental_id for update;
  if exists(select 1 from public.rental_financial_dispositions d where d.rental_id = candidate_rental_id)
    or (tg_op = 'UPDATE' and old.rental_id <> new.rental_id)
  then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger fee_obligations_disposition_freeze before insert or update or delete on public.fee_obligations
  for each row execute function public.reject_disposed_fee_change();

create function public.get_rental_financial_summary(p_rental_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare rental public.rentals%rowtype; disposition public.rental_financial_dispositions%rowtype;
begin
  perform public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]);
  select * into rental from public.rentals where id = p_rental_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into disposition from public.rental_financial_dispositions where rental_id = rental.id;
  return jsonb_build_object('rentalId',rental.id,'version',rental.version,'depositSatang',rental.deposit_satang,
    'fees',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'type',f.category,'amountSatang',f.amount_satang,'reason',f.reason) order by f.created_at,f.id)
      from public.fee_obligations f where f.rental_id = rental.id),'[]'::jsonb),
    'disposition',case when disposition.rental_id is null then null else jsonb_build_object('inspectionId',disposition.inspection_id,
      'kind',disposition.kind,'feeTotalSatang',disposition.fee_total_satang,'refundableSatang',disposition.refundable_satang,'reason',disposition.reason) end,
    'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'status',f.status,'amountSatang',f.amount_satang,
      'providerReference',f.provider_reference,'completedAt',f.completed_at) order by f.created_at,f.id)
      from public.refunds f where f.rental_id = rental.id),'[]'::jsonb));
end;
$$;

create or replace function public._allowed_rental_commands(r public.rentals) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when r.status = 'PENDING_REVIEW' and public.has_admin_role(array['OWNER','REVIEWER']::public.admin_role[]) then
      case when exists(select 1 from public.payments where rental_id=r.id and status='VERIFIED') then '["approve"]'::jsonb else '["approve","reject"]'::jsonb end
    when not public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]) then '[]'::jsonb
    else case r.status
      when 'APPROVED' then '["start-preparation"]'::jsonb
      when 'PREPARING' then '["mark-ready"]'::jsonb
      when 'READY_FOR_HANDOVER' then '["handover"]'::jsonb
      when 'ACTIVE' then '["request-return"]'::jsonb
      when 'RETURN_PENDING' then '["receive-return"]'::jsonb
      when 'INSPECTION_PENDING' then '["finalize-inspection"]'::jsonb
      when 'REFUND_PENDING' then case when exists(select 1 from public.rental_financial_dispositions d join public.refunds f on f.id=d.refund_id
        where d.rental_id=r.id and f.status in ('COMPLETED','NOT_REQUIRED') and f.amount_satang=d.refundable_satang)
        then '["complete-settlement"]'::jsonb else '[]'::jsonb end
      else '[]'::jsonb end
  end
$$;

create or replace function public.execute_rental_command(
  p_rental_id uuid,p_command text,p_reason text,p_inspection_id uuid,p_expected_version integer,
  p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; replay jsonb; rental public.rentals%rowtype; old_status public.rental_status;
  new_status public.rental_status; response jsonb; fees bigint; refund_id uuid; fee_snapshot jsonb;
begin
  actor := case when p_command in ('approve','reject') then public._require_admin(array['OWNER','REVIEWER']::public.admin_role[])
    else public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[],p_command in ('finalize-inspection','complete-settlement')) end;
  replay := public._idempotency_start('ADMIN',actor,'executeRentalCommand:' || p_command,p_rental_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  select * into rental from public.rentals where id=p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is null or rental.version<>p_expected_version then raise exception 'CONFLICT' using errcode='23505'; end if;
  old_status:=rental.status;
  case p_command
    when 'approve' then
      if old_status<>'PENDING_REVIEW' or not exists(select 1 from public.kyc_submissions s join public.kyc_decisions d on d.submission_id=s.id
        where s.rental_id=rental.id and d.status='VERIFIED' and s.id=(select s2.id from public.kyc_submissions s2 where s2.rental_id=rental.id order by s2.created_at desc,s2.id desc limit 1))
        or not exists(select 1 from public.payments where rental_id=rental.id and type='RENT_AND_DEPOSIT' and status='VERIFIED' and amount_satang=rental.total_due_satang)
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='APPROVED';
    when 'reject' then
      if old_status<>'PENDING_REVIEW' or nullif(btrim(p_reason),'') is null
        or exists(select 1 from public.payments where rental_id=rental.id and status='VERIFIED')
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='REJECTED';
    when 'start-preparation' then
      if old_status<>'APPROVED' then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='PREPARING';
    when 'mark-ready' then
      if old_status<>'PREPARING' or not exists(select 1 from public.condition_logs where rental_id=rental.id and inspection_type='BEFORE_RENT' and finalized_at is not null)
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='READY_FOR_HANDOVER';
    when 'handover' then
      if old_status<>'READY_FOR_HANDOVER' or not exists(select 1 from public.condition_logs where rental_id=rental.id and inspection_type='BEFORE_RENT' and finalized_at is not null)
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='ACTIVE';
      update public.laptops set status='RENTED',version=version+1 where id=rental.laptop_id and status in ('AVAILABLE','RESERVED');
      if not found then raise exception 'CONFLICT' using errcode='23505'; end if;
    when 'request-return' then
      if old_status<>'ACTIVE' or nullif(btrim(p_reason),'') is null then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='RETURN_PENDING';
    when 'receive-return' then
      if old_status<>'RETURN_PENDING' then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='INSPECTION_PENDING';
    when 'finalize-inspection' then
      if old_status<>'INSPECTION_PENDING' or p_inspection_id is null or nullif(btrim(p_reason),'') is null or length(p_reason)>500
        or not exists(select 1 from public.condition_logs where id=p_inspection_id and rental_id=rental.id and inspection_type='AFTER_RETURN' and finalized_at is not null)
        or not exists(select 1 from public.payments where rental_id=rental.id and type='RENT_AND_DEPOSIT' and status='VERIFIED' and amount_satang=rental.total_due_satang)
        or exists(select 1 from public.rental_financial_dispositions where rental_id=rental.id)
        or exists(select 1 from public.refunds where rental_id=rental.id and status<>'CANCELLED')
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      perform 1 from public.fee_obligations where rental_id=rental.id for update;
      select coalesce(sum(amount_satang),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'type',category,'amountSatang',amount_satang,'reason',reason) order by created_at,id),'[]'::jsonb)
        into fees,fee_snapshot from public.fee_obligations where rental_id=rental.id;
      if fees>rental.deposit_satang then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
      insert into public.refunds(rental_id,status,amount_satang,reason,requested_by,idempotency_key)
      values(rental.id,case when rental.deposit_satang=fees then 'NOT_REQUIRED'::public.refund_status else 'PENDING'::public.refund_status end,
        rental.deposit_satang-fees,btrim(p_reason),actor,'disposition:' || rental.id) returning id into refund_id;
      insert into public.rental_financial_dispositions(rental_id,inspection_id,kind,deposit_satang,fee_total_satang,refundable_satang,fee_snapshot,refund_id,reason,finalized_by)
      values(rental.id,p_inspection_id,case when fees=0 then 'NO_FEES' else 'ITEMIZED' end,rental.deposit_satang,fees,rental.deposit_satang-fees,fee_snapshot,refund_id,btrim(p_reason),actor);
      new_status:='REFUND_PENDING';
    when 'complete-settlement' then
      if old_status<>'REFUND_PENDING' or not exists(select 1 from public.rental_financial_dispositions d join public.refunds f on f.id=d.refund_id
        where d.rental_id=rental.id and f.rental_id=rental.id and f.amount_satang=d.refundable_satang and f.status in ('COMPLETED','NOT_REQUIRED'))
        or exists(select 1 from public.refunds f where f.rental_id=rental.id and f.status not in ('COMPLETED','NOT_REQUIRED','CANCELLED'))
        or (select coalesce(sum(f.amount_satang),0) from public.refunds f where f.rental_id=rental.id and f.status<>'CANCELLED')
          is distinct from (select d.refundable_satang from public.rental_financial_dispositions d where d.rental_id=rental.id)
      then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
      new_status:='COMPLETED';
      update public.laptops set status='AVAILABLE',version=version+1 where id=rental.laptop_id and status='RENTED';
    else raise exception 'VALIDATION_ERROR' using errcode='22023';
  end case;
  update public.rentals set status=new_status,hold_expires_at=null,
    handed_over_at=case when new_status='ACTIVE' then statement_timestamp() else handed_over_at end,
    return_requested_at=case when new_status='RETURN_PENDING' then statement_timestamp() else return_requested_at end,
    returned_at=case when new_status='INSPECTION_PENDING' then statement_timestamp() else returned_at end,
    version=version+1 where id=rental.id returning * into rental;
  insert into public.rental_status_history(rental_id,prior_status,new_status,actor_type,actor_id,reason,request_id)
  values(rental.id,old_status,new_status,'ADMIN',actor,nullif(btrim(p_reason),''),p_request_id);
  perform public._audit('ADMIN',actor,'executeRentalCommand:' || p_command,'rental',rental.id,p_request_id,p_idempotency_key,old_status::text,new_status::text);
  insert into public.notification_outbox(aggregate_type,aggregate_id,event_type,recipient_customer_id,payload,idempotency_key)
  values('rental',rental.id,'RENTAL_' || new_status::text,rental.customer_id,jsonb_build_object('rentalId',rental.id,'status',new_status),'rental-state:' || rental.id || ':' || rental.version)
  on conflict(idempotency_key) do nothing;
  response:=public._admin_rental_projection(rental);
  return public._idempotency_finish('ADMIN',actor,'executeRentalCommand:' || p_command,rental.id,p_idempotency_key,p_request_hash,200,response);
end;
$$;

create or replace function public.create_rental_fee_obligation(
  p_rental_id uuid,p_type public.payment_type,p_amount_satang public.money_satang,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[],true); replay jsonb;
  rental public.rentals%rowtype; fee public.fee_obligations%rowtype; response jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'createRentalFeeObligation',p_rental_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  if p_type is null or p_type not in ('LATE_FEE','DAMAGE_FEE') or p_amount_satang is null or p_amount_satang<=0 or nullif(btrim(p_reason),'') is null or length(p_reason)>500
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  select * into rental from public.rentals where id=p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if rental.status<>'INSPECTION_PENDING' or exists(select 1 from public.rental_financial_dispositions where rental_id=rental.id)
  then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
  if p_amount_satang+coalesce((select sum(amount_satang) from public.fee_obligations where rental_id=rental.id),0)>rental.deposit_satang
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  insert into public.fee_obligations(rental_id,category,amount_satang,reason,assessed_by)
  values(rental.id,p_type::text,p_amount_satang,btrim(p_reason),actor) returning * into fee;
  perform public._audit('ADMIN',actor,'createRentalFeeObligation','fee_obligation',fee.id,p_request_id,p_idempotency_key,null,p_type::text);
  response:=jsonb_build_object('id',fee.id,'type',fee.category,'amountSatang',fee.amount_satang,'reason',fee.reason,'createdAt',fee.created_at);
  return public._idempotency_finish('ADMIN',actor,'createRentalFeeObligation',rental.id,p_idempotency_key,p_request_hash,201,response);
end;
$$;

create or replace function public.request_rental_refund(
  p_rental_id uuid,p_amount_satang public.money_satang,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[],true); replay jsonb;
  rental public.rentals%rowtype; disposition public.rental_financial_dispositions%rowtype; refund public.refunds%rowtype; committed bigint; response jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'requestRentalRefund',p_rental_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  select * into rental from public.rentals where id=p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if rental.status<>'REFUND_PENDING' or nullif(btrim(p_reason),'') is null then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
  select * into disposition from public.rental_financial_dispositions where rental_id=rental.id;
  if not found then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
  select coalesce(sum(amount_satang),0) into committed from public.refunds where rental_id=rental.id and status<>'CANCELLED';
  if p_amount_satang is null or p_amount_satang<>disposition.refundable_satang or committed<>disposition.refundable_satang
  then raise exception 'CONFLICT' using errcode='23505'; end if;
  select * into refund from public.refunds where id=disposition.refund_id;
  response:=jsonb_build_object('id',refund.id,'status',refund.status,'amountSatang',refund.amount_satang,'rentalId',refund.rental_id);
  return public._idempotency_finish('ADMIN',actor,'requestRentalRefund',rental.id,p_idempotency_key,p_request_hash,202,response);
end;
$$;

create function public.confirm_rental_refund(
  p_rental_id uuid,p_refund_id uuid,p_amount_satang public.money_satang,p_provider_reference text,p_reason text,
  p_expected_version integer,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[],true); replay jsonb;
  rental public.rentals%rowtype; refund public.refunds%rowtype; response jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'confirmRentalRefund',p_refund_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  if p_amount_satang is null or p_amount_satang<=0 or nullif(btrim(p_provider_reference),'') is null or length(p_provider_reference)>200
    or nullif(btrim(p_reason),'') is null or length(p_reason)>500
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  select * into rental from public.rentals where id=p_rental_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is null or rental.version<>p_expected_version then raise exception 'CONFLICT' using errcode='23505'; end if;
  select * into refund from public.refunds where id=p_refund_id and rental_id=rental.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if rental.status<>'REFUND_PENDING' or not exists(select 1 from public.rental_financial_dispositions
    where rental_id=rental.id and refund_id=refund.id and refundable_satang=p_amount_satang)
    or refund.amount_satang<>p_amount_satang then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
  if refund.status='COMPLETED' then
    if refund.provider_reference is distinct from btrim(p_provider_reference) or refund.reason is distinct from btrim(p_reason)
    then raise exception 'CONFLICT' using errcode='23505'; end if;
  else
    if refund.status not in ('PENDING','PROCESSING','FAILED') then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
    update public.refunds set status='COMPLETED',approved_by=actor,provider_reference=btrim(p_provider_reference),
      reason=btrim(p_reason),completed_at=statement_timestamp() where id=refund.id;
    insert into public.refund_attempts(refund_id,attempt_number,outcome,provider_reference)
    values(refund.id,coalesce((select max(attempt_number) from public.refund_attempts where refund_id=refund.id),0)+1,'MANUAL_CONFIRMED',btrim(p_provider_reference));
    update public.rentals set version=version+1 where id=rental.id;
    perform public._audit('ADMIN',actor,'confirmRentalRefund','refund',refund.id,p_request_id,p_idempotency_key,refund.status::text,'COMPLETED');
  end if;
  response:=public.get_rental_financial_summary(rental.id);
  return public._idempotency_finish('ADMIN',actor,'confirmRentalRefund',refund.id,p_idempotency_key,p_request_hash,200,response);
end;
$$;

create function public._admin_laptop_projection(l public.laptops) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',l.id,'name',l.name,'specs',l.specs,'dailyRateSatang',l.daily_rate_satang,
    'depositSatang',l.deposit_satang,'status',l.status,'version',l.version,'retiredAt',l.deleted_at,'createdAt',l.created_at,'updatedAt',l.updated_at)
$$;

create function public.set_admin_laptop_status(
  p_laptop_id uuid,p_status text,p_reason text,p_expected_version integer,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]); replay jsonb; laptop public.laptops%rowtype; response jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'setAdminLaptopStatus',p_laptop_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  if p_status is null or p_status not in ('AVAILABLE','MAINTENANCE') or nullif(btrim(p_reason),'') is null or length(p_reason)>500
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  select * into laptop from public.laptops where id=p_laptop_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is null or laptop.version<>p_expected_version then raise exception 'CONFLICT' using errcode='23505'; end if;
  if laptop.status not in ('AVAILABLE','MAINTENANCE') or laptop.status::text=p_status
    or exists(select 1 from public.rental_inventory_reservations where laptop_id=laptop.id)
  then raise exception 'CONFLICT' using errcode='23505'; end if;
  update public.laptops set status=p_status::public.laptop_status,version=version+1 where id=laptop.id returning * into laptop;
  perform public._audit('ADMIN',actor,'setAdminLaptopStatus','laptop',laptop.id,p_request_id,p_idempotency_key,null,p_status);
  response:=public._admin_laptop_projection(laptop);
  return public._idempotency_finish('ADMIN',actor,'setAdminLaptopStatus',laptop.id,p_idempotency_key,p_request_hash,200,response);
end;
$$;

create function public.attach_admin_laptop_image(
  p_laptop_id uuid,p_evidence_id uuid,p_alt_text text,p_expected_version integer,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER','OPERATIONS']::public.admin_role[]); replay jsonb;
  laptop public.laptops%rowtype; evidence public.evidence_objects%rowtype; response jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'attachAdminLaptopImage',p_laptop_id,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  if p_alt_text is not null and length(p_alt_text)>500 then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  select * into laptop from public.laptops where id=p_laptop_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is null or laptop.version<>p_expected_version then raise exception 'CONFLICT' using errcode='23505'; end if;
  select * into evidence from public.evidence_objects where id=p_evidence_id and laptop_id=laptop.id and purpose='LAPTOP_PRODUCT'
    and status='READY' and finalized_at is not null and bucket_id='laptop-public';
  if not found then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  if exists(select 1 from public.laptop_images where object_key=evidence.object_key) then raise exception 'CONFLICT' using errcode='23505'; end if;
  insert into public.laptop_images(laptop_id,object_key,alt_text,sort_order)
  values(laptop.id,evidence.object_key,nullif(btrim(p_alt_text),''),coalesce((select max(sort_order)+1 from public.laptop_images where laptop_id=laptop.id),0));
  update public.laptops set version=version+1 where id=laptop.id returning * into laptop;
  perform public._audit('ADMIN',actor,'attachAdminLaptopImage','laptop',laptop.id,p_request_id,p_idempotency_key,null,null,jsonb_build_object('evidenceId',evidence.id));
  response:=public._admin_laptop_projection(laptop);
  return public._idempotency_finish('ADMIN',actor,'attachAdminLaptopImage',laptop.id,p_idempotency_key,p_request_hash,200,response);
end;
$$;

create or replace function public.can_insert_storage_object(candidate_bucket text,candidate_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.evidence_objects e join public.upload_intents i on i.evidence_id=e.id
    where e.bucket_id=candidate_bucket and e.object_key=candidate_name and e.status='PENDING_UPLOAD' and i.consumed_at is null and i.expires_at>statement_timestamp()
      and ((e.purpose='KYC_ID' and e.bucket_id='kyc-private' and i.owner_customer_id=public.current_customer_id())
        or (e.purpose='PAYMENT_SLIP' and e.bucket_id='payments-private' and i.owner_customer_id=public.current_customer_id())
        or (e.purpose in ('CONDITION_BEFORE','CONDITION_AFTER') and e.bucket_id='conditions-private' and public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]))
        or (e.purpose='LAPTOP_PRODUCT' and e.bucket_id='laptop-public' and e.laptop_id is not null and public.has_admin_role(array['OWNER','OPERATIONS']::public.admin_role[]))))
$$;
drop policy storage_product_admin_insert on storage.objects;
create policy storage_product_admin_insert on storage.objects for insert to authenticated
  with check(bucket_id='laptop-public' and public.can_insert_storage_object(bucket_id,name));

create function public._valid_contact_line_url(candidate text) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $$
  select coalesce(length(candidate) between 1 and 2048 and candidate ~* '^https://(line\.me|lin\.ee)([/?#][^[:space:]]*)?$',false)
$$;

create function public.get_customer_public_settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('contactLineUrl',(select value #>> '{}' from public.system_settings
    where key='CONTACT_LINE_URL' and jsonb_typeof(value)='string' and public._valid_contact_line_url(value #>> '{}')))
$$;

create or replace function public.get_own_rental(p_rental_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_customer(); rental public.rentals%rowtype; accepted jsonb; payment_status text;
begin
  select * into rental from public.rentals where id=p_rental_id and customer_id=actor;
  if not found then return null; end if;
  select jsonb_build_object('id',c.id,'version',c.version_number,'title',c.title,'content',c.content_snapshot,
    'contentHash',c.content_sha256,'effectiveAt',c.effective_at) into accepted
    from public.contract_acceptances a join public.contract_versions c on c.id=a.contract_version_id
    where a.rental_id=rental.id and a.customer_id=actor;
  select status::text into payment_status from public.payments where rental_id=rental.id and type='RENT_AND_DEPOSIT' order by attempt_number desc limit 1;
  return public._rental_projection(rental) || jsonb_build_object('completionSummary',jsonb_build_object(
    'kycReady',exists(select 1 from public.kyc_submissions s
      where s.id=(select current_submission.id from public.kyc_submissions current_submission
        where current_submission.rental_id=rental.id and current_submission.customer_id=actor
        order by current_submission.created_at desc,current_submission.id desc limit 1)
      and not exists(select 1 from public.kyc_decisions d where d.submission_id=s.id and d.status='REJECTED')
      and exists(select 1 from public.kyc_submission_evidence se join public.evidence_objects e on e.id=se.evidence_id
        where se.submission_id=s.id and e.rental_id=rental.id and e.customer_id=actor and e.purpose='KYC_ID' and e.status='READY')),
    'paymentStatus',coalesce(payment_status,'NOT_SUBMITTED'),
    'paymentEvidenceId',(select e.id from public.evidence_objects e where e.rental_id=rental.id and e.customer_id=actor and e.purpose='PAYMENT_SLIP' and e.status='READY'
      and not exists(select 1 from public.payments p where p.evidence_id=e.id) order by e.created_at desc,e.id desc limit 1),
    'acceptedContract',accepted));
end;
$$;

create or replace function public.update_admin_setting(
  p_key text,p_value text,p_expected_version integer,p_idempotency_key text,p_request_hash text,p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=public._require_admin(array['OWNER']::public.admin_role[],true); replay jsonb;
  setting public.system_settings%rowtype; response jsonb; payment jsonb;
begin
  replay:=public._idempotency_start('ADMIN',actor,'updateAdminSettings',null,p_idempotency_key,p_request_hash);
  if replay is not null then return replay; end if;
  if p_key is null or p_key not in ('PAYMENT_INSTRUCTIONS','CONTACT_LINE_URL','AUTO_REPLY_TEXT') or p_value is null or length(p_value)>5000
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  if p_key='CONTACT_LINE_URL' and public._valid_contact_line_url(p_value) is not true then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  if p_key='PAYMENT_INSTRUCTIONS' then
    begin payment:=p_value::jsonb; exception when others then raise exception 'VALIDATION_ERROR' using errcode='22023'; end;
    if jsonb_typeof(payment) is distinct from 'object' or (payment - array['qrImageUrl','accountDisplayName'])<>'{}'::jsonb
      or jsonb_typeof(payment -> 'qrImageUrl') is distinct from 'string'
      or length(payment ->> 'qrImageUrl') not between 1 and 2048
      or payment ->> 'qrImageUrl' !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
      or jsonb_typeof(payment -> 'accountDisplayName') is distinct from 'string'
      or length(btrim(payment ->> 'accountDisplayName')) not between 1 and 200
    then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('system-setting:' || p_key,0));
  select * into setting from public.system_settings where key=p_key for update;
  if not found then
    if p_expected_version is distinct from 0 then raise exception 'CONFLICT' using errcode='23505'; end if;
    insert into public.system_settings(key,value,updated_by) values(p_key,to_jsonb(p_value),actor) returning * into setting;
  else
    if p_expected_version is null or setting.version<>p_expected_version then raise exception 'CONFLICT' using errcode='23505'; end if;
    update public.system_settings set value=to_jsonb(p_value),version=version+1,updated_by=actor,updated_at=statement_timestamp() where key=p_key returning * into setting;
  end if;
  perform public._audit('ADMIN',actor,'updateAdminSettings','setting',null,p_request_id,p_idempotency_key,null,null,jsonb_build_object('key',p_key));
  response:=jsonb_build_object('key',setting.key,'value',setting.value,'version',setting.version,'updatedAt',setting.updated_at);
  return public._idempotency_finish('ADMIN',actor,'updateAdminSettings',null,p_idempotency_key,p_request_hash,200,response);
end;
$$;

create or replace function public.claim_notification_outbox(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if public._service_scope('service_worker','app_outbox_worker','notification:deliver',300) is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  update public.notification_outbox set status='FAILED',lease_token=null,lease_expires_at=null,last_error_category='ATTEMPTS_EXHAUSTED'
    where status='PROCESSING' and lease_expires_at<=statement_timestamp() and attempts>=5;
  with candidates as (
    select id from public.notification_outbox where attempts<5
      and ((status in ('PENDING','FAILED') and next_attempt_at<=statement_timestamp()) or (status='PROCESSING' and lease_expires_at<=statement_timestamp()))
    order by created_at,id for update skip locked limit p_limit
  ), claimed as (
    update public.notification_outbox o set status='PROCESSING',lease_token=gen_random_uuid(),
      lease_expires_at=statement_timestamp()+interval '2 minutes',attempts=o.attempts+1
    from candidates c where o.id=c.id returning o.id,o.event_type,o.aggregate_type,o.aggregate_id,o.recipient_customer_id,o.payload,o.attempts,o.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(claimed) || jsonb_build_object('recipient_line_user_id',c.line_user_id)),'[]'::jsonb)
    into result from claimed left join public.customers c on c.id=claimed.recipient_customer_id and c.disabled_at is null;
  return result;
end;
$$;

create or replace function public.complete_notification_outbox(
  p_event_id uuid,p_lease_token uuid,p_delivered boolean,p_error_category text default null,p_retry_after_seconds integer default 60
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._service_scope('service_worker','app_outbox_worker','notification:deliver',300) is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_event_id is null or p_lease_token is null or p_delivered is null or p_retry_after_seconds is null or p_retry_after_seconds not between 1 and 86400
    or (p_error_category is not null and p_error_category !~ '^[A-Z][A-Z0-9_]{0,79}$')
  then raise exception 'VALIDATION_ERROR' using errcode='22023'; end if;
  update public.notification_outbox set status=case when p_delivered then 'DELIVERED'::public.outbox_status else 'FAILED'::public.outbox_status end,
    delivered_at=case when p_delivered then statement_timestamp() else null end,
    next_attempt_at=case when p_delivered then next_attempt_at else statement_timestamp()+make_interval(secs=>p_retry_after_seconds) end,
    last_error_category=case when p_delivered then null when attempts>=5 then 'ATTEMPTS_EXHAUSTED' else coalesce(p_error_category,'UNKNOWN') end,
    lease_token=null,lease_expires_at=null
  where id=p_event_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>statement_timestamp();
  return found;
end;
$$;

revoke all on function public._recent_mfa_epoch(),public.reject_disposed_fee_change(),public._admin_laptop_projection(public.laptops),public._valid_contact_line_url(text),
  public.get_rental_financial_summary(uuid),public.confirm_rental_refund(uuid,uuid,public.money_satang,text,text,integer,text,text,text),
  public.set_admin_laptop_status(uuid,text,text,integer,text,text,text),public.attach_admin_laptop_image(uuid,uuid,text,integer,text,text,text),public.get_customer_public_settings()
  from public,anon,authenticated,app_session_service,app_outbox_worker,app_upload_scanner,app_line_webhook_ingress,app_line_webhook_worker;
grant execute on function public.get_rental_financial_summary(uuid),public.confirm_rental_refund(uuid,uuid,public.money_satang,text,text,integer,text,text,text),
  public.set_admin_laptop_status(uuid,text,text,integer,text,text,text),public.attach_admin_laptop_image(uuid,uuid,text,integer,text,text,text) to authenticated;
grant execute on function public.get_customer_public_settings() to anon,authenticated;

commit;
