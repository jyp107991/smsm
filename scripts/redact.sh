#!/usr/bin/env bash
# Filters tool output before it reaches a public Actions log: hides email addresses and drops the account
# and permission lines wrangler prints when authentication fails. Usage: some-command 2>&1 | scripts/redact.sh
sed -u -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[hidden]/g; /Account Name|associated with|Account ID|Token Permissions|^[│|].*[│|]$/d'
