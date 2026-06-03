# Contacts CSV Bulk Import

`POST /contacts/import` accepts a `multipart/form-data` request with a CSV file in the `file` field. The request must carry the workspace tenant context in `x-tenant-id`.

Required CSV headers:

- `email`
- `stage`

Optional CSV headers:

- `firstName`
- `lastName`
- `phone`
- `externalId`

Import behavior:

- Emails are trimmed and lowercased before validation and insertion.
- `stage` must be one of `PROSPECT`, `QUALIFIED`, `PROPOSAL`, `ENGAGEMENT`, `RENEWAL`, or `INACTIVE`.
- Row-level validation is used: valid rows are inserted, invalid rows are skipped with inline row errors.
- Duplicate emails already in the same workspace are skipped.
- Duplicate emails inside the uploaded CSV are skipped after the first occurrence.
- Writes are wrapped in the service transaction manager and inserted in 500-row batches.
- Starter-plan workspaces are limited to 50 contacts; imports that would exceed the limit fail with HTTP 402 and insert nothing.
- Fatal file/request errors (missing file, invalid content type, unreadable CSV, malformed required headers, missing tenant context, plan limit failures) reject the whole import.

The response body is:

```json
{
  "imported": 0,
  "skipped": 0,
  "errors": [
    { "row": 2, "field": "email", "reason": "Email must be valid" }
  ]
}
```

Do not log raw CSV contents or contact personal data. Logs for this route should remain limited to route metadata, correlation IDs, status, and non-sensitive counts.
