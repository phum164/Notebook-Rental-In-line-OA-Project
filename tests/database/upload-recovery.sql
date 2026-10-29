-- Synthetic expired/negative-scanner fixtures. No objects are deleted or made public.
begin;
set local timezone='UTC';
set local app.settings.customer_jwt_issuer='https://notebookrental.test';
set local app.settings.customer_jwt_audience='authenticated';
create function pg_temp.recovery_actor(scanner boolean default false) returns void language plpgsql as $$
declare instant bigint:=floor(extract(epoch from statement_timestamp()));
begin
  perform set_config('request.jwt.claims',jsonb_build_object('iss','https://notebookrental.test','aud','authenticated',
    'role',case when scanner then 'app_upload_scanner' else 'authenticated' end,
    'principal_type',case when scanner then 'upload_scanner' else 'customer' end,
    'scope',case when scanner then 'upload:scan' else '' end,
    'sub',case when scanner then '91000000-0000-4000-8000-000000000001' else '10000000-0000-4000-8000-000000000001' end,
    'jti',gen_random_uuid(),'iat',instant,'nbf',instant,'exp',instant+300)::text,true);
end;
$$;
do $$
declare target_purpose public.evidence_purpose; rental uuid; intent jsonb; maximum integer; step integer;
begin
  foreach target_purpose in array array['KYC_ID','PAYMENT_SLIP']::public.evidence_purpose[] loop
    rental:=gen_random_uuid(); maximum:=case target_purpose when 'KYC_ID' then 2 else 3 end;
    insert into public.rentals(id,customer_id,laptop_id,start_date,end_date,daily_rate_satang,rental_subtotal_satang,deposit_satang,total_due_satang,status,hold_expires_at)
    values(rental,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',current_date+maximum+230,current_date+maximum+230,10000,10000,50000,60000,'PENDING_PAYMENT',statement_timestamp()+interval '30 minutes');
    perform pg_temp.recovery_actor();
    for step in 1..maximum loop
      intent:=public.create_upload_intent_record(target_purpose,rental,'synthetic.png','image/png',8);
      -- Simulate elapsed intent time, preserving expires_at > created_at.
      update public.upload_intents set created_at=statement_timestamp()-interval '10 minutes',expires_at=statement_timestamp()-interval '1 second'
        where id=(intent ->> 'uploadId')::uuid;
      if public.can_insert_storage_object(intent ->> 'bucketId',intent ->> 'objectKey') then raise exception 'expired intent permits storage upload'; end if;
    end loop;
    -- Legacy terminal REJECTED metadata is also inactive; no new scanner enum is introduced.
    insert into public.evidence_objects(purpose,customer_id,rental_id,bucket_id,object_key,declared_mime_type,size_bytes,status,finalized_at)
    values(target_purpose,'10000000-0000-4000-8000-000000000001',rental,
      case target_purpose when 'KYC_ID' then 'kyc-private' else 'payments-private' end,
      'synthetic/rejected/' || gen_random_uuid(),'image/png',8,'REJECTED',statement_timestamp());
    -- Before migration006 this raises a cap violation despite no usable upload remaining.
    intent:=public.create_upload_intent_record(target_purpose,rental,'synthetic.png','image/png',8);
    perform pg_temp.recovery_actor(true);
    perform public.finalize_upload_intent_record((intent ->> 'uploadId')::uuid,'image/png',8,repeat('b',64),'QUARANTINED',gen_random_uuid()::text,repeat('a',64),'synthetic-negative-scan');
    perform pg_temp.recovery_actor();
    for step in 1..maximum loop
      intent:=public.create_upload_intent_record(target_purpose,rental,'synthetic.png','image/png',8);
    end loop;
    begin
      perform public.create_upload_intent_record(target_purpose,rental,'synthetic.png','image/png',8);
      raise exception 'active pending upload cap bypassed for %',target_purpose;
    exception when check_violation then null; end;
    -- Ready evidence/current non-rejected KYC must still consume the unchanged cap.
    for intent in select jsonb_build_object('uploadId',i.id) from public.upload_intents i join public.evidence_objects e on e.id=i.evidence_id
      where e.rental_id=rental and e.purpose=target_purpose and e.status='PENDING_UPLOAD' and i.expires_at>statement_timestamp() loop
      perform pg_temp.recovery_actor(true);
      perform public.finalize_upload_intent_record((intent ->> 'uploadId')::uuid,'image/png',8,repeat('c',64),'CLEAN',gen_random_uuid()::text,repeat('a',64),'synthetic-clean-scan');
    end loop;
    perform pg_temp.recovery_actor();
    begin
      perform public.create_upload_intent_record(target_purpose,rental,'synthetic.png','image/png',8);
      raise exception 'READY evidence cap bypassed for %',target_purpose;
    exception when check_violation then null; end;
    if (select count(*) from public.evidence_objects e where e.rental_id=rental and e.purpose=target_purpose and e.status='READY')<>maximum
      then raise exception 'READY evidence lost for %',target_purpose; end if;
    if (select count(*) from public.evidence_objects e where e.rental_id=rental and e.purpose=target_purpose and e.status='QUARANTINED')<>1
      then raise exception 'negative scanner fixture was removed'; end if;
    if (select count(*) from public.upload_intents i join public.evidence_objects e on e.id=i.evidence_id where e.rental_id=rental and e.purpose=target_purpose and i.expires_at<=statement_timestamp())<>maximum
      then raise exception 'expired upload metadata was removed'; end if;
  end loop;
end;
$$;
rollback;
