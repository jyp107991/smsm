-- smsm migration (S9b review 6): a report's message is at most 4,100 characters. The phone already cuts every message
-- to 4,000 (src/data/errors.ts MAX_TEXT, "Report a problem" included), so nothing the app sends is refused; the limit
-- keeps anyone else from filling the table with one huge row. Rows already there are cut to the limit first, so the
-- check holds for them. Expand only: the deployed app never sends more.
update client_errors set message = left(message, 4100) where length(message) > 4100;
alter table client_errors add constraint client_errors_message_length check (length(message) <= 4100);
