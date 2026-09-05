
# Task 3B: upload authentication and recovery

Implemented the upload-only portion. Video/FAQ editorial lifecycle remains a separate pending decision.

Both CMS and ImageUploader call `uploadAdminMedia`, which uses `withStaffAuthHeaders` and same-origin cookies. File content and owner type identify a retry in tab session storage, including reload/reselection. Invalid/empty/over-5MB files stop client-side; the server independently authorizes staff before parsing, bounds the actual multipart stream, and checks file type/size.

Migration `20260905140000_media_upload_intents.sql` persists actor, content fingerprint, exact pathname and upload identity before the one permitted provider PUT. Concurrent or repeated requests cannot repeat PUT. The existing Vercel REST adapter remains unchanged. Metadata completion writes the intent URL and unique asset row in one SQL statement. A signed receipt, bound to actor, upload ID, content fingerprint and pathname, lets a client retry a successful Blob upload whose database completion failed. Errors expose bounded outcome codes, never raw provider/database errors.

If the provider outcome is unknown, or the server dies after Blob success before returning a receipt, retries remain `UPLOAD_OUTCOME_UNKNOWN`. The persisted pathname/upload ID is the operator reconciliation reference; it must be checked against the approved storage account before completing metadata or declaring absence. No automatic second PUT or destructive cleanup is attempted. Do not clear session storage or generate a new identity to bypass this state. Closing the tab/clearing browser storage loses the browser receipt; token rotation invalidates receipts signed by the old Blob token. Those cases require operator reconciliation. Assets may upload before any published revision exists; existing revision reference checks are unchanged.

Verified locally: 11 new fake-provider/repository and injected route/client tests, plus existing upload/admin route contracts (52/52 combined). Tests cover successful Blob/failed metadata recovery, simultaneous retries, unknown provider result, pre-provider persistence failure, forged/cross-actor/cross-file receipts, bearer/cookie request forwarding, denied staff, malformed/type/size/empty gates, missing credentials, and shared caller retry behavior. Initial full typecheck passed. Final typecheck after body-stream guard reported only the concurrent Task 6 admin-data.server.ts:3463 submissionId / WebsiteInquiryPersistenceInput mismatch; no upload errors. Root notified. Authorization route tests inject the staff resolver (real identity resolution is covered separately by staff-auth suites).

No migration, database, Blob, staging, outbound message, credential load, or deployment was performed. Disposable-database transaction/concurrency and approved staging bearer/cookie tests remain release gates. Independent review requested from root.



## Independent review follow-up

Reproduced same-file upload identity collision after switching staff accounts in one tab. Recovery keys now include stable authenticated user ID; credentials and ID come from one session snapshot. Token rotation keeps the same recovery identity. Fake-provider account-switch regression failed before the fix and passes after it. Database upload creator column is named created_by and remains immutable history during staff handover. No provider or database calls.
