-- S9b review 6: a report's message is at most 4,100 characters (the phone cuts to 4,000). Runs after schema_test.sql.
\set A '11111111-1111-1111-1111-111111111111'
reset role;
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into client_errors(message, app_version) values (repeat('x', 4100), '0.1.0');
insert into client_errors(message, app_version) values (repeat('x', 4101), '0.1.0'); -- expect error: message too long
reset role;
select count(*) = 1 as ok_client_errors_longest_kept from client_errors where length(message) = 4100;
select count(*) = 0 as ok_client_errors_nothing_longer from client_errors where length(message) > 4100;
