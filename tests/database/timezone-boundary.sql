-- Real instant, session expiry and civil-date regression under changing caller TimeZone.
begin;
set local app.settings.customer_jwt_issuer='https://notebookrental.test';
set local app.settings.customer_jwt_audience='authenticated';
create function pg_temp.time_actor(kind text,subject uuid default '91000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
declare instant bigint:=floor(extract(epoch from statement_timestamp()));
begin
  perform set_config('request.jwt.claims',jsonb_build_object('iss','https://notebookrental.test','aud','authenticated',
    'role',case when kind='customer' then 'authenticated' else 'app_session_service' end,
    'principal_type',case when kind='customer' then 'customer' else 'session_service' end,
    'scope',case when kind='customer' then '' else 'session:' || kind end,
    'sub',subject,'jti',gen_random_uuid(),'iat',instant,'nbf',instant,'exp',instant+case when kind='customer' then 300 else 60 end)::text,true);
end;
$$;
do $$
declare zone text; v_nonce_hash text; binding_hash text; token_hash text; session_result jsonb; resolved jsonb;
  customer_id uuid; session_id uuid; quote jsonb; start_day date:=(statement_timestamp() at time zone 'Asia/Bangkok')::date+25;
begin
  foreach zone in array array['UTC','Asia/Bangkok','UTC'] loop
    perform set_config('TimeZone',zone,true);
    v_nonce_hash:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');
    binding_hash:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');
    token_hash:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');
    perform pg_temp.time_actor('bootstrap');
    perform public.app_issue_line_bootstrap_nonce(v_nonce_hash,binding_hash,statement_timestamp()+interval '5 minutes');
    if not exists(select 1 from public.line_bootstrap_nonces n where n.nonce_hash=v_nonce_hash and n.issued_at=statement_timestamp()
      and n.expires_at-n.issued_at=interval '5 minutes') then raise exception 'nonce instant/expiry shifted under %',zone; end if;
    session_result:=public.app_create_line_session(v_nonce_hash,binding_hash,'synthetic-time-session-' || gen_random_uuid(),token_hash,repeat('c',64),'Synthetic time fixture',
      statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '10 minutes');
    customer_id:=(session_result ->> 'customerId')::uuid; session_id:=(session_result ->> 'sessionId')::uuid;
    if not exists(select 1 from public.customers c where c.id=customer_id and c.created_at=statement_timestamp() and c.updated_at=statement_timestamp())
      or not exists(select 1 from public.app_sessions s where s.id=session_id and s.issued_at=statement_timestamp() and s.last_used_at=statement_timestamp()
        and s.idle_expires_at-s.issued_at=interval '5 minutes' and s.absolute_expires_at-s.issued_at=interval '10 minutes')
      then raise exception 'session/identity defaults shifted under %',zone; end if;
    perform pg_temp.time_actor('resolve');
    resolved:=public.app_resolve_session(token_hash);
    if resolved ->> 'valid'<>'true' or (resolved ->> 'absoluteExpiresAt')::timestamptz<>statement_timestamp()+interval '10 minutes'
      then raise exception 'live session invalid/extended beyond absolute expiry under %',zone; end if;
    -- Expired-session fixture preserves the original issued-before-expiry constraint.
    update public.app_sessions set issued_at=statement_timestamp()-interval '20 minutes',
      last_used_at=statement_timestamp()-interval '10 minutes',idle_expires_at=statement_timestamp()-interval '1 second' where id=session_id;
    if public.app_resolve_session(token_hash) ->> 'valid'<>'false' then raise exception 'expired session accepted under %',zone; end if;
    perform pg_temp.time_actor('customer',customer_id);
    if public.current_customer_id() is distinct from customer_id then raise exception 'valid customer claims shifted under %',zone; end if;
    quote:=public.create_rental_quote('20000000-0000-4000-8000-000000000001',start_day,start_day+1);
    if not exists(select 1 from public.rental_quotes q where q.id=(quote ->> 'quoteId')::uuid
      and q.start_date=start_day and q.end_date=start_day+1 and q.rental_subtotal_satang=q.daily_rate_satang*2
      and q.created_at=statement_timestamp() and q.expires_at-q.created_at=interval '10 minutes')
      then raise exception 'civil-date/quote instant changed under %',zone; end if;
    perform set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{exp}',to_jsonb(floor(extract(epoch from statement_timestamp()))-1))::text,true);
    if public.current_customer_id() is not null then raise exception 'expired customer claims accepted under %',zone; end if;
  end loop;
end;
$$;
rollback;
