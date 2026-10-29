-- Real PostgreSQL workflow proof after migrations/seed; synthetic transaction rolls back.
begin;
set local timezone='UTC';
set local app.settings.customer_jwt_issuer='https://notebookrental.test';
set local app.settings.customer_jwt_audience='authenticated';

insert into auth.users(id) values('71000000-0000-4000-8000-000000000001'),('71000000-0000-4000-8000-000000000002'),('71000000-0000-4000-8000-000000000003');
insert into public.admin_users(id,role) values('71000000-0000-4000-8000-000000000001','OWNER'),('71000000-0000-4000-8000-000000000002','OPERATIONS'),('71000000-0000-4000-8000-000000000003','REVIEWER');

create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%',message; end if; end;
$$;
create function pg_temp.actor(kind text) returns jsonb language plpgsql as $$
declare claims jsonb; instant bigint:=floor(extract(epoch from statement_timestamp()));
begin
  claims:=jsonb_build_object('iss','https://notebookrental.test','aud','authenticated','role','authenticated',
    'sub',case kind when 'customer' then '10000000-0000-4000-8000-000000000001' when 'other-customer' then '10000000-0000-4000-8000-000000000002'
      when 'owner' then '71000000-0000-4000-8000-000000000001' when 'operations' then '71000000-0000-4000-8000-000000000002'
      else '71000000-0000-4000-8000-000000000003' end,'jti',gen_random_uuid(),'iat',instant,'nbf',instant,'exp',instant+300);
  if kind in ('customer','other-customer') then claims:=claims || '{"principal_type":"customer"}'::jsonb;
  elsif kind in ('scanner','outbox') then
    claims:=claims || jsonb_build_object('sub','91000000-0000-4000-8000-000000000001',
      'role',case kind when 'scanner' then 'app_upload_scanner' else 'app_outbox_worker' end,
      'principal_type',case kind when 'scanner' then 'upload_scanner' else 'service_worker' end,
      'scope',case kind when 'scanner' then 'upload:scan' else 'notification:deliver' end);
  else claims:=claims || jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',instant))); end if;
  perform set_config('request.jwt.claims',claims::text,true);
  return claims;
end;
$$;
create function pg_temp.command(rental uuid,command text,version integer,reason text default 'Synthetic operator reason',inspection uuid default null) returns jsonb language sql as $$
  select public.execute_rental_command(rental,command,reason,inspection,version,gen_random_uuid()::text,repeat('a',64),'synthetic-workflow')
$$;
create function pg_temp.ready_upload(purpose public.evidence_purpose,target uuid,actor_kind text) returns uuid language plpgsql as $$
declare intent jsonb; result jsonb;
begin
  perform pg_temp.actor(actor_kind);
  intent:=public.create_upload_intent_record(purpose,target,'synthetic.png','image/png',8);
  perform pg_temp.assert_true(public.can_insert_storage_object(intent ->> 'bucketId',intent ->> 'objectKey'),'exact upload intent denied');
  perform pg_temp.assert_true(not public.can_insert_storage_object(intent ->> 'bucketId',(intent ->> 'objectKey') || '-other'),'unbound object allowed');
  -- Synthetic scanner fixture: no real image/PII or Storage HTTP transport in a SQL test.
  perform pg_temp.actor('scanner');
  result:=public.finalize_upload_intent_record((intent ->> 'uploadId')::uuid,'image/png',8,repeat('b',64),'CLEAN',gen_random_uuid()::text,repeat('a',64),'synthetic-scan');
  perform pg_temp.actor(actor_kind);
  return (result ->> 'evidenceId')::uuid;
end;
$$;

do $$
declare claims jsonb; invalid jsonb;
begin
  claims:=pg_temp.actor('owner');
  perform pg_temp.assert_true(public._recent_mfa_epoch() is not null,'valid TOTP amr denied');
  perform pg_temp.assert_true(public.get_admin_session() ->> 'mfaVerifiedAt' is not null,'session did not expose TOTP evidence');
  invalid:=jsonb_set(claims,'{amr}',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',claims -> 'iat')));
  perform set_config('request.jwt.claims',invalid::text,true);
  begin perform public._require_admin(array['OWNER']::public.admin_role[],true); raise exception 'OAuth treated as recent MFA'; exception when insufficient_privilege then null; end;
  invalid:=jsonb_set(claims,'{amr}',jsonb_build_array(jsonb_build_object('method','token_refresh','timestamp',claims -> 'iat')));
  perform set_config('request.jwt.claims',invalid::text,true);
  perform pg_temp.assert_true(public._recent_mfa_epoch() is null,'refresh treated as MFA');
  invalid:=jsonb_set(claims,'{amr}',jsonb_build_array(jsonb_build_object('method','totp','timestamp',(claims ->> 'iat')::bigint-601)));
  perform set_config('request.jwt.claims',invalid::text,true);
  begin perform public._require_admin(array['OWNER']::public.admin_role[],true); raise exception 'stale TOTP accepted'; exception when insufficient_privilege then null; end;
  invalid:=(claims - 'amr') || jsonb_build_object('mfa_verified_at',claims -> 'iat');
  perform set_config('request.jwt.claims',invalid::text,true);
  perform pg_temp.assert_true(public._require_admin(array['OWNER']::public.admin_role[],true) is not null,'legacy signed MFA claim denied');
end;
$$;

-- Main lifecycle: every state write uses a named public command; only identity/scanner fixtures are synthetic.
do $$
<<lifecycle>>
declare laptop jsonb; quote jsonb; rental jsonb; contract jsonb; payment jsonb; summary jsonb; result jsonb;
  laptop_id uuid; rental_id uuid; kyc uuid; slip uuid; before_evidence uuid; after_evidence uuid; before_log uuid; after_log uuid;
  refund_id uuid; version integer; key text; audit_count bigint; outbox_count bigint; product uuid;
begin
  perform pg_temp.actor('owner');
  laptop:=public.create_admin_laptop('Synthetic lifecycle notebook','{"cpu":"Synthetic"}',10000,50000,gen_random_uuid()::text,repeat('a',64),'create-laptop');
  laptop_id:=(laptop ->> 'id')::uuid;
  laptop:=public.set_admin_laptop_status(laptop_id,'MAINTENANCE','Synthetic maintenance',(laptop ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'maintenance');
  perform pg_temp.assert_true(laptop ->> 'status'='MAINTENANCE','maintenance not set');
  laptop:=public.set_admin_laptop_status(laptop_id,'AVAILABLE','Synthetic maintenance complete',(laptop ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'available');
  product:=pg_temp.ready_upload('LAPTOP_PRODUCT',laptop_id,'owner');
  laptop:=public.attach_admin_laptop_image(laptop_id,product,'Synthetic notebook',(laptop ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'attach-image');
  perform pg_temp.assert_true(public.get_public_laptop(laptop_id) ->> 'thumbnailUrl' like '/storage/v1/object/public/laptop-public/%','catalog image not attached');
  begin perform public.attach_admin_laptop_image(laptop_id,product,'Duplicate',(laptop ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'duplicate-image'); raise exception 'duplicate image attached'; exception when unique_violation then null; end;
  perform public.publish_admin_contract('Synthetic contract','Synthetic legal fixture only',statement_timestamp()-interval '1 second',gen_random_uuid()::text,repeat('a',64),'publish-contract');
  perform public.update_admin_setting('CONTACT_LINE_URL','https://line.me/R/ti/p/@synthetic',0,gen_random_uuid()::text,repeat('a',64),'line-url');
  perform pg_temp.assert_true(public.get_customer_public_settings() ->> 'contactLineUrl'='https://line.me/R/ti/p/@synthetic','public contact projection wrong');
  begin perform public.update_admin_setting('CONTACT_LINE_URL','https://line.me.evil.test/path',1,gen_random_uuid()::text,repeat('a',64),'invalid-url'); raise exception 'untrusted contact host accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.update_admin_setting('PAYMENT_INSTRUCTIONS','{"qrImageUrl":"https://name:secret@example.test/qr","accountDisplayName":"Synthetic"}',0,gen_random_uuid()::text,repeat('a',64),'invalid-qr'); raise exception 'credential QR accepted'; exception when invalid_parameter_value then null; end;
  perform public.update_admin_setting('PAYMENT_INSTRUCTIONS','{"qrImageUrl":"https://example.test/synthetic-qr.png","accountDisplayName":"Synthetic account"}',0,gen_random_uuid()::text,repeat('a',64),'payment-settings');

  perform pg_temp.actor('customer');
  quote:=public.create_rental_quote(laptop_id,current_date+10,current_date+11);
  key:=gen_random_uuid()::text;
  rental:=public.create_rental_from_quote((quote ->> 'quoteId')::uuid,'Synthetic renter','0800000000',key,repeat('a',64),'booking');
  perform pg_temp.assert_true(rental=public.create_rental_from_quote((quote ->> 'quoteId')::uuid,'Synthetic renter','0800000000',key,repeat('a',64),'booking-replay'),'booking replay changed response');
  rental_id:=(rental ->> 'id')::uuid;
  contract:=public.get_current_contract();
  perform public.accept_rental_contract(rental_id,(contract ->> 'id')::uuid,contract ->> 'contentHash',gen_random_uuid()::text,repeat('a',64),'accept-contract',null,null);
  perform pg_temp.actor('owner');
  perform public.publish_admin_contract('Later synthetic contract','Later terms must not replace accepted terms',statement_timestamp()-interval '1 second',gen_random_uuid()::text,repeat('a',64),'publish-later-contract');
  perform pg_temp.actor('customer');
  kyc:=pg_temp.ready_upload('KYC_ID',rental_id,'customer');
  slip:=pg_temp.ready_upload('PAYMENT_SLIP',rental_id,'customer');
  result:=public.get_own_rental(rental_id) -> 'completionSummary';
  perform pg_temp.assert_true((result ->> 'kycReady')::boolean and result ->> 'paymentStatus'='NOT_SUBMITTED'
    and (result ->> 'paymentEvidenceId')::uuid=slip and result -> 'acceptedContract' ->> 'id'=contract ->> 'id','reload completion summary wrong');
  payment:=public.submit_rental_payment(rental_id,slip,'RENT_AND_DEPOSIT',gen_random_uuid()::text,repeat('a',64),'submit-payment');
  result:=public.get_own_rental(rental_id) -> 'completionSummary';
  perform pg_temp.assert_true(result ->> 'paymentStatus'='SUBMITTED' and result -> 'paymentEvidenceId'='null'::jsonb,'consumed payment slip offered for reuse');
  rental:=payment -> 'rental';
  perform pg_temp.actor('other-customer');
  perform pg_temp.assert_true(public.get_own_rental(rental_id) is null,'cross-customer rental leaked');

  perform pg_temp.actor('reviewer');
  rental:=public.verify_rental_kyc(rental_id,array[kyc],'Synthetic verified',(rental ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'verify-kyc') -> 'rental';
  rental:=public.verify_rental_payment(rental_id,(payment ->> 'paymentId')::uuid,'synthetic-payment-reference','Synthetic verified',(rental ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'verify-payment') -> 'rental';
  begin perform pg_temp.command(rental_id,'reject',(rental ->> 'version')::integer); raise exception 'verified paid rental rejected'; exception when invalid_parameter_value then null; end;
  begin perform public.get_rental_financial_summary(rental_id); raise exception 'reviewer read finance'; exception when insufficient_privilege then null; end;
  rental:=pg_temp.command(rental_id,'approve',(rental ->> 'version')::integer) -> 'rental';

  perform pg_temp.actor('operations');
  rental:=pg_temp.command(rental_id,'start-preparation',(rental ->> 'version')::integer) -> 'rental';
  begin perform pg_temp.command(rental_id,'mark-ready',(rental ->> 'version')::integer); raise exception 'missing before inspection accepted'; exception when invalid_parameter_value then null; end;
  before_evidence:=pg_temp.ready_upload('CONDITION_BEFORE',rental_id,'operations');
  before_log:=(public.create_rental_inspection(rental_id,'BEFORE_RENT',array[before_evidence],'Synthetic before',gen_random_uuid()::text,repeat('a',64),'before-inspection') ->> 'id')::uuid;
  rental:=pg_temp.command(rental_id,'mark-ready',(rental ->> 'version')::integer) -> 'rental';
  rental:=pg_temp.command(rental_id,'handover',(rental ->> 'version')::integer) -> 'rental';
  perform pg_temp.assert_true(rental ->> 'status'='ACTIVE','rental not active');
  begin perform public.set_admin_laptop_status(laptop_id,'MAINTENANCE','Rented laptop',(public.get_admin_rental(rental_id) -> 'rental' ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'invalid-maintenance'); raise exception 'rented laptop maintenance accepted'; exception when unique_violation then null; end;
  rental:=pg_temp.command(rental_id,'request-return',(rental ->> 'version')::integer) -> 'rental';
  rental:=pg_temp.command(rental_id,'receive-return',(rental ->> 'version')::integer) -> 'rental';
  audit_count:=(select count(*) from public.audit_events); outbox_count:=(select count(*) from public.notification_outbox);
  begin perform pg_temp.command(rental_id,'finalize-inspection',(rental ->> 'version')::integer,'Missing after',before_log); raise exception 'wrong inspection accepted'; exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_true((select count(*) from public.audit_events)=audit_count and (select count(*) from public.notification_outbox)=outbox_count,'failed transition left side effects');
  after_evidence:=pg_temp.ready_upload('CONDITION_AFTER',rental_id,'operations');
  after_log:=(public.create_rental_inspection(rental_id,'AFTER_RETURN',array[after_evidence],'Synthetic after',gen_random_uuid()::text,repeat('a',64),'after-inspection') ->> 'id')::uuid;
  perform public.create_rental_fee_obligation(rental_id,'DAMAGE_FEE',10000,'Explicit synthetic item',gen_random_uuid()::text,repeat('a',64),'fee');
  begin perform public.create_rental_fee_obligation(rental_id,'LATE_FEE',50001,'Excess synthetic fee',gen_random_uuid()::text,repeat('a',64),'over-fee'); raise exception 'fees exceeded deposit'; exception when invalid_parameter_value then null; end;
  rental:=pg_temp.command(rental_id,'finalize-inspection',(rental ->> 'version')::integer,'Synthetic itemized settlement',after_log) -> 'rental';
  summary:=public.get_rental_financial_summary(rental_id);
  perform pg_temp.assert_true(summary -> 'disposition' ->> 'kind'='ITEMIZED' and (summary -> 'disposition' ->> 'refundableSatang')::bigint=40000,'financial disposition wrong');
  refund_id:=(summary -> 'refunds' -> 0 ->> 'id')::uuid;
  begin perform public.create_rental_fee_obligation(rental_id,'DAMAGE_FEE',1,'Frozen fee',gen_random_uuid()::text,repeat('a',64),'late-fee-edit'); raise exception 'fees changed after disposition'; exception when invalid_parameter_value then null; end;
  begin perform public.request_rental_refund(rental_id,40001,'Over-allocation',gen_random_uuid()::text,repeat('a',64),'over-refund'); raise exception 'over-refund accepted'; exception when unique_violation then null; end;
  result:=public.request_rental_refund(rental_id,40000,'Existing exact obligation',gen_random_uuid()::text,repeat('a',64),'refund-request');
  perform pg_temp.assert_true((result ->> 'id')::uuid=refund_id and (select count(*) from public.refunds f where f.rental_id=lifecycle.rental_id)=1,'second refund obligation created');
  begin perform pg_temp.command(rental_id,'complete-settlement',(rental ->> 'version')::integer); raise exception 'pending refund settled'; exception when invalid_parameter_value then null; end;
  begin perform public.confirm_rental_refund(rental_id,refund_id,40000,'synthetic-bank-transfer','Operator transferred deposit',(rental ->> 'version')::integer-1,gen_random_uuid()::text,repeat('a',64),'stale-refund'); raise exception 'stale confirmation accepted'; exception when unique_violation then null; end;
  key:=gen_random_uuid()::text; version:=(rental ->> 'version')::integer;
  summary:=public.confirm_rental_refund(rental_id,refund_id,40000,'synthetic-bank-transfer','Operator transferred deposit',version,key,repeat('a',64),'confirm-refund');
  perform pg_temp.assert_true(summary=public.confirm_rental_refund(rental_id,refund_id,40000,'synthetic-bank-transfer','Operator transferred deposit',version,key,repeat('a',64),'confirm-replay'),'refund replay changed response');
  begin perform public.confirm_rental_refund(rental_id,refund_id,40000,'different-transfer','Different completed details',(summary ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'conflicting-refund-details'); raise exception 'completed refund details changed'; exception when unique_violation then null; end;
  perform pg_temp.assert_true((select count(*) from public.refund_attempts a where a.refund_id=lifecycle.refund_id)=1,'refund replay added attempt');
  rental:=pg_temp.command(rental_id,'complete-settlement',(summary ->> 'version')::integer) -> 'rental';
  perform pg_temp.assert_true(rental ->> 'status'='COMPLETED','rental did not complete');
  perform pg_temp.assert_true(not exists(select 1 from public.rental_inventory_reservations x where x.rental_id=(rental ->> 'id')::uuid),'reservation retained after completion');
end;
$$;

-- Resume projection negatives use explicit synthetic fixtures, not the lifecycle proof above.
do $$
declare rental_id uuid:=gen_random_uuid(); old_kyc uuid:=gen_random_uuid(); current_kyc uuid:=gen_random_uuid();
  old_submission uuid:=gen_random_uuid(); current_submission uuid:=gen_random_uuid();
  consumed_slip uuid:=gen_random_uuid(); unused_slip uuid:=gen_random_uuid(); result jsonb;
begin
  insert into public.rentals(id,customer_id,laptop_id,start_date,end_date,daily_rate_satang,rental_subtotal_satang,deposit_satang,total_due_satang,status,hold_expires_at)
  values(rental_id,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',current_date+150,current_date+150,45000,45000,300000,345000,'PENDING_PAYMENT',statement_timestamp()+interval '30 minutes');
  insert into public.evidence_objects(id,purpose,customer_id,rental_id,bucket_id,object_key,declared_mime_type,size_bytes,status,finalized_at,created_at) values
    (old_kyc,'KYC_ID','10000000-0000-4000-8000-000000000001',rental_id,'kyc-private','synthetic/' || old_kyc,'image/png',8,'READY',statement_timestamp(),statement_timestamp()-interval '4 seconds'),
    (current_kyc,'KYC_ID','10000000-0000-4000-8000-000000000001',rental_id,'kyc-private','synthetic/' || current_kyc,'image/png',8,'READY',statement_timestamp(),statement_timestamp()-interval '3 seconds'),
    (consumed_slip,'PAYMENT_SLIP','10000000-0000-4000-8000-000000000001',rental_id,'payments-private','synthetic/' || consumed_slip,'image/png',8,'READY',statement_timestamp(),statement_timestamp()-interval '2 seconds'),
    (unused_slip,'PAYMENT_SLIP','10000000-0000-4000-8000-000000000001',rental_id,'payments-private','synthetic/' || unused_slip,'image/png',8,'READY',statement_timestamp(),statement_timestamp()-interval '1 second'),
    (gen_random_uuid(),'PAYMENT_SLIP','10000000-0000-4000-8000-000000000001',rental_id,'payments-private','synthetic/quarantined/' || rental_id,'image/png',8,'QUARANTINED',statement_timestamp(),statement_timestamp());
  insert into public.kyc_submissions(id,rental_id,customer_id,created_at) values
    (old_submission,rental_id,'10000000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 seconds'),
    (current_submission,rental_id,'10000000-0000-4000-8000-000000000001',statement_timestamp()-interval '1 second');
  insert into public.kyc_submission_evidence(submission_id,evidence_id) values(old_submission,old_kyc),(current_submission,current_kyc);
  insert into public.payments(rental_id,type,status,amount_satang,evidence_id,attempt_number,decision_reason)
  values(rental_id,'RENT_AND_DEPOSIT','REJECTED',345000,consumed_slip,1,'Synthetic rejection');
  perform pg_temp.actor('customer');
  result:=public.get_own_rental(rental_id) -> 'completionSummary';
  perform pg_temp.assert_true((result ->> 'kycReady')::boolean and result ->> 'paymentStatus'='REJECTED'
    and (result ->> 'paymentEvidenceId')::uuid=unused_slip and result -> 'acceptedContract'='null'::jsonb,'resume did not select unused READY slip/current KYC');
  insert into public.kyc_decisions(submission_id,status,decided_by,reason)
  values(current_submission,'REJECTED','71000000-0000-4000-8000-000000000003','Synthetic current KYC rejected');
  perform pg_temp.assert_true(not (public.get_own_rental(rental_id) -> 'completionSummary' ->> 'kycReady')::boolean,'older READY KYC bypassed current rejection');
  perform pg_temp.actor('other-customer');
  perform pg_temp.assert_true(public.get_own_rental(rental_id) is null,'resume projection crossed customer boundary');
end;
$$;

-- Financial edge fixtures isolate no-fee, zero-refund and duplicate-reference settlement.
do $$
declare rental_id uuid; slip uuid; inspection uuid; summary jsonb; rental jsonb; refund uuid; fee integer; day_offset integer:=170;
begin
  foreach fee in array array[0,50000,10000] loop
    rental_id:=gen_random_uuid(); slip:=gen_random_uuid(); day_offset:=day_offset+1;
    insert into public.rentals(id,customer_id,laptop_id,start_date,end_date,daily_rate_satang,rental_subtotal_satang,deposit_satang,total_due_satang,status)
    values(rental_id,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',current_date+day_offset,current_date+day_offset,10000,10000,50000,60000,'INSPECTION_PENDING');
    insert into public.evidence_objects(id,purpose,customer_id,rental_id,bucket_id,object_key,declared_mime_type,size_bytes,status,finalized_at)
    values(slip,'PAYMENT_SLIP','10000000-0000-4000-8000-000000000001',rental_id,'payments-private','synthetic/' || slip,'image/png',8,'READY',statement_timestamp());
    insert into public.payments(rental_id,type,status,amount_satang,evidence_id,attempt_number,verified_by,verified_at,decision_reason)
    values(rental_id,'RENT_AND_DEPOSIT','VERIFIED',60000,slip,1,'71000000-0000-4000-8000-000000000003',statement_timestamp(),'Synthetic verified');
    perform pg_temp.actor('operations');
    inspection:=(public.create_rental_inspection(rental_id,'AFTER_RETURN',array[pg_temp.ready_upload('CONDITION_AFTER',rental_id,'operations')],'Synthetic edge inspection',gen_random_uuid()::text,repeat('a',64),'edge-inspection') ->> 'id')::uuid;
    if fee>0 then perform public.create_rental_fee_obligation(rental_id,'DAMAGE_FEE',fee,'Explicit synthetic edge fee',gen_random_uuid()::text,repeat('a',64),'edge-fee'); end if;
    rental:=pg_temp.command(rental_id,'finalize-inspection',1,'Synthetic edge disposition',inspection) -> 'rental';
    summary:=public.get_rental_financial_summary(rental_id); refund:=(summary -> 'refunds' -> 0 ->> 'id')::uuid;
    perform pg_temp.assert_true(summary -> 'disposition' ->> 'kind'=case when fee=0 then 'NO_FEES' else 'ITEMIZED' end,'edge disposition kind wrong');
    if fee=50000 then
      perform pg_temp.assert_true(summary -> 'refunds' -> 0 ->> 'status'='NOT_REQUIRED','zero refund not explicit');
      rental:=pg_temp.command(rental_id,'complete-settlement',(rental ->> 'version')::integer) -> 'rental';
      perform pg_temp.assert_true(rental ->> 'status'='COMPLETED','zero refund could not settle');
    else
      begin perform public.confirm_rental_refund(rental_id,refund,50000-fee,'synthetic-bank-transfer','Duplicate transfer',(rental ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'duplicate-bank-reference'); raise exception 'duplicate bank reference accepted'; exception when unique_violation then null; end;
      perform pg_temp.assert_true(not exists(select 1 from public.refund_attempts a where a.refund_id=refund),'failed duplicate created attempt');
      begin perform public.confirm_rental_refund(rental_id,refund,50001-fee,'synthetic-wrong-amount','Wrong amount',(rental ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'wrong-refund-amount'); raise exception 'inexact refund amount accepted'; exception when invalid_parameter_value then null; end;
      perform pg_temp.actor('reviewer');
      begin perform public.confirm_rental_refund(rental_id,refund,50000-fee,'synthetic-reviewer','Wrong role',(rental ->> 'version')::integer,gen_random_uuid()::text,repeat('a',64),'wrong-refund-role'); raise exception 'reviewer confirmed refund'; exception when insufficient_privilege then null; end;
    end if;
  end loop;
end;
$$;

-- Explicit missing-disposition/refund fixture cannot bypass settlement.
insert into public.rentals(id,customer_id,laptop_id,start_date,end_date,daily_rate_satang,rental_subtotal_satang,deposit_satang,total_due_satang,status)
values('49000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',current_date+200,current_date+200,45000,45000,300000,345000,'REFUND_PENDING');
select pg_temp.actor('operations');
do $$ begin
  begin perform pg_temp.command('49000000-0000-4000-8000-000000000001','complete-settlement',1); raise exception 'missing disposition/refund settled'; exception when invalid_parameter_value then null; end;
end $$;

-- Outbox crash/reclaim fixture verifies fresh fencing and a bounded final failure.
insert into public.notification_outbox(id,aggregate_type,aggregate_id,event_type,payload,idempotency_key,status,attempts,lease_token,lease_expires_at)
values('89000000-0000-4000-8000-000000000001','rental','49000000-0000-4000-8000-000000000001','SYNTHETIC_CRASH','{}','synthetic-outbox-crash','PROCESSING',4,
 '89000000-0000-4000-8000-000000000002',statement_timestamp()-interval '1 second');
select pg_temp.actor('outbox');
do $$
declare entry jsonb;
begin
  select value into entry from jsonb_array_elements(public.claim_notification_outbox(100)) where value ->> 'id'='89000000-0000-4000-8000-000000000001';
  perform pg_temp.assert_true(entry is not null and entry ->> 'lease_token'<>'89000000-0000-4000-8000-000000000002','outbox crash did not reclaim with new fence');
  perform pg_temp.assert_true(not public.complete_notification_outbox('89000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000002',true),'stale outbox completion accepted');
  perform pg_temp.assert_true(public.complete_notification_outbox((entry ->> 'id')::uuid,(entry ->> 'lease_token')::uuid,false,'TRANSIENT_ERROR',1),'outbox final failure denied');
  perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.claim_notification_outbox(100)) x where x ->> 'id'='89000000-0000-4000-8000-000000000001'),'outbox exceeded attempt ceiling');
end;
$$;
rollback;
