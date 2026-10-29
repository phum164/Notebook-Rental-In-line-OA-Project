-- Use only an isolated disposable database after migrations and seed.
begin;
set local timezone='UTC';
set local app.settings.customer_jwt_issuer='https://notebookrental.test';
set local app.settings.customer_jwt_audience='authenticated';
insert into public.laptops(id,name,daily_rate_satang,deposit_satang)
values('29000000-0000-4000-8000-000000000001','Concurrent booking fixture',10000,50000);
do $$
declare customer text;
begin
  foreach customer in array array['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('iss','https://notebookrental.test','aud','authenticated','role','authenticated','principal_type','customer','sub',customer,
      'iat',floor(extract(epoch from statement_timestamp())),'nbf',floor(extract(epoch from statement_timestamp())),'exp',floor(extract(epoch from statement_timestamp()))+300)::text,true);
    perform public.create_rental_quote('29000000-0000-4000-8000-000000000001',current_date+60,current_date+62);
  end loop;
end;
$$;
commit;
