begin;

do $$ begin
  if exists (select 1 from storage.buckets where id in ('kyc-private','payments-private','conditions-private','quarantine-private') and public) then
    raise exception 'sensitive bucket is public';
  end if;
end $$;

set local role anon;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id in ('kyc-private','payments-private','conditions-private','quarantine-private')) then
    raise exception 'anonymous sensitive object listing leaked';
  end if;
end $$;

rollback;

