-- S9b (finding 20; CAT-1): a new household's "Other" starts with an emoji, like the other starting categories; no
-- starting category has the placeholder dot. Runs after schema_test.sql (A's household was made by create_household).
\set A '11111111-1111-1111-1111-111111111111'
reset role;
set role authenticated;
set request.jwt.claim.sub = :'A';
select emoji = '📦' as ok_cat1_other_has_an_emoji from categories where name = 'Other' and household_id = my_household();
select count(*) = 0 as ok_cat1_no_starting_category_is_a_dot from categories
where household_id = my_household() and emoji = '•' and name in ('Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport',
  'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other');
reset role;
