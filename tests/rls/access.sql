begin;

set local role anon;
do $$ begin
  begin
    perform 1 from public.customers;
    raise exception 'anonymous customer table unexpectedly granted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.rentals;
    raise exception 'anonymous rental table unexpectedly granted';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","principal_type":"customer","sub":"not-a-uuid","iss":"forged","aud":"forged","iat":0,"exp":9999999999}', true);
do $$ begin
  if public.current_customer_id() is not null then raise exception 'forged customer context accepted'; end if;
  if exists (select 1 from public.customers) then raise exception 'forged customer read leaked'; end if;
end $$;

select set_config('request.jwt.claims', '{"role":"authenticated","principal_type":"customer","sub":"10000000-0000-4000-8000-000000000001","aal":"aal2"}', true);
do $$ begin
  if public.current_admin_id() is not null then raise exception 'customer token substituted for admin'; end if;
end $$;

rollback;
