begin;

-- pgcrypto may live outside public on Supabase; the built-in SHA-256 keeps the strict search path.
create or replace function public.publish_admin_contract(
  p_title text, p_content text, p_effective_at timestamptz, p_idempotency_key text,
  p_request_hash text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public._require_admin(array['OWNER']::public.admin_role[], true);
  replay jsonb; contract public.contract_versions%rowtype; next_version integer; response jsonb;
begin
  replay := public._idempotency_start('ADMIN', actor, 'publishAdminContract', null,
    p_idempotency_key, p_request_hash);
  if replay is not null then return replay; end if;
  if nullif(btrim(p_title), '') is null or length(p_title) > 200 or length(p_content) not between 1 and 100000
  then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('contract-version'));
  select coalesce(max(version_number), 0) + 1 into next_version from public.contract_versions;
  insert into public.contract_versions (version, version_number, title, content_snapshot,
    content_sha256, effective_at, published_by)
  values (next_version::text, next_version, btrim(p_title), p_content,
    encode(pg_catalog.sha256(convert_to(p_content, 'UTF8')), 'hex'), p_effective_at, actor)
  returning * into contract;
  perform public._audit('ADMIN', actor, 'publishAdminContract', 'contract_version', contract.id,
    p_request_id, p_idempotency_key, null, contract.version);
  response := jsonb_build_object('id', contract.id, 'version', contract.version,
    'title', contract.title, 'content', contract.content_snapshot,
    'contentHash', contract.content_sha256, 'effectiveAt', contract.effective_at);
  return public._idempotency_finish('ADMIN', actor, 'publishAdminContract', null,
    p_idempotency_key, p_request_hash, 201, response);
end;
$$;

commit;
