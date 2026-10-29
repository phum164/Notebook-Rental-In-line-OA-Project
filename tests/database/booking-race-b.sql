\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
set local timezone='UTC';
set local app.settings.customer_jwt_issuer='https://notebookrental.test';
set local app.settings.customer_jwt_audience='authenticated';
select set_config('request.jwt.claims',jsonb_build_object('iss','https://notebookrental.test','aud','authenticated','role','authenticated','principal_type','customer','sub','10000000-0000-4000-8000-000000000002',
  'iat',floor(extract(epoch from statement_timestamp())),'nbf',floor(extract(epoch from statement_timestamp())),'exp',floor(extract(epoch from statement_timestamp()))+300)::text,true);
select public.create_rental_from_quote((select id from public.rental_quotes where laptop_id='29000000-0000-4000-8000-000000000001' and customer_id='10000000-0000-4000-8000-000000000002'),
  'Concurrent B','0800000002','booking-concurrent-key-b',repeat('b',64),'race-b');
commit;
