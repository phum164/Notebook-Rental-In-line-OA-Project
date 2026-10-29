-- Run after `supabase db reset`; this script checks privilege shape without production data.
begin;

do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing
  from unnest(array[
    'app_issue_line_bootstrap_nonce', 'app_create_line_session', 'app_resolve_session',
    'app_revoke_session', 'create_rental_quote', 'create_rental_from_quote',
    'accept_rental_contract', 'create_upload_intent_record', 'authorize_upload_scan',
    'can_scan_storage_object', 'finalize_upload_intent_record',
    'submit_rental_payment', 'verify_rental_kyc', 'reject_rental_kyc',
    'verify_rental_payment', 'reject_rental_payment', 'execute_rental_command',
    'claim_notification_outbox', 'complete_notification_outbox'
  ]) name
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = name);
  if missing is not null then raise exception 'missing RPCs: %', missing; end if;

  if (select rolbypassrls or rolsuper or rolcanlogin from pg_roles where rolname = 'app_session_service')
  then raise exception 'app_session_service is over-privileged'; end if;
  if has_table_privilege('app_session_service', 'public.app_sessions', 'SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'app_session_service has direct table access'; end if;
  if has_table_privilege('app_upload_scanner', 'public.evidence_objects', 'SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'app_upload_scanner has public table access'; end if;
  if has_function_privilege('anon', 'public.app_resolve_session(text)', 'EXECUTE')
  then raise exception 'anon can resolve sessions'; end if;
  if not has_function_privilege('app_session_service', 'public.app_resolve_session(text)', 'EXECUTE')
  then raise exception 'session role cannot execute allowed RPC'; end if;
end $$;

rollback;
