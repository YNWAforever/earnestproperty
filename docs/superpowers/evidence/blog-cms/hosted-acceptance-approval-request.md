# Isolated hosted acceptance: exact resource approval request

Status: **DRAFT — NOT AUTHORIZATION. Hosted execution NOT_RUN.**

This request accompanies Task 7 on `codex/blog-cms-release`, starting from
`e33323cf862551d4e341456f36aaf1a9751c75f7`. The deployment and runner must use the
same **final committed SHA containing this runner**, not the starting SHA. No
resource identifiers, credentials, sessions or approvals have been invented or
obtained for execution. The test fixture is deliberately fictional and must
never be submitted as an approval.

## Owner decision requested

Approve one time-bounded run against a separately provisioned, exclusive test
environment, with the exact fields below completed and independently reviewed.
Provisioning and deployment are separate decisions; this command does neither.
The owner must arrange the isolated resources and data before this request can
become executable. Do not inherit the production project's Preview environment.

The source of truth for every accepted field and type is
[`inputSchema` / `approvalSchema`](../../../../scripts/blog-cms/hosted-contract.ts).
Both reject unknown fields. Empty values, partial manifests and missing cleanup
identities are errors. All times are UTC ISO timestamps.

| JSON field | Exact non-secret value required from the owner |
| --- | --- |
| `format`, `runId` | `blog-hosted-acceptance-v1`; a new UUID for this run |
| `target.environment` | `isolated-hosted` |
| `target.origin` | Immutable HTTPS deployment origin on `vercel.app`, with no path, credentials, port or alias; a separately named isolated project |
| `target.projectId`, `teamId`, `deploymentId`, `commit` | Exact isolated Vercel project, owning team, READY preview deployment and full 40-character Git SHA |
| `target.neon` | Exact isolated `projectId`, `branchId`, direct `endpointId`, unpooled `host`, dedicated `database` and DB-owner `role`; the database name must differ from production `neondb` |
| `target.auth` | Exact `origin`, full `baseUrl` ending in `/auth`, and matching isolated Neon `projectId` / `branchId` |
| `target.blob` | Bare `storeId` and corresponding `<storeId>.public.blob.vercel-storage.com` host, exclusively isolated |
| `production` | Complete current exclusion inventory: `domains`, `projectIds`, `neonProjectIds`, `branchIds`, `endpointIds`, `dbHosts`, `databases`, `authHosts`, `blobHosts`, `blobStoreIds`; include all immutable and branch aliases. This task did not refresh production. Missing inventory blocks execution. |
| `actors.admin`, `actors.manager`, `actors.agent` | Distinct real isolated `userId`, `staffId`, `sessionSha256`, SHA-256 of the exact existing Playwright state file as `browserStateSha256`, and `expiresAt`. Each staff account must have exactly its requested role, be active and already bound to its auth user. No bootstrap or email-only bindings. |
| `actors.anonymous` | Literal `no-session`; runner uses a fresh empty browser context and no bearer |
| `binding` | Independent immutable deployment configuration receipt: exact duplicate `target`, `source=owner-verified-immutable-deployment-config`, `evidenceId`, `verifiedBy`, `verifiedAt`, `expiresAt`, `fixtureAuth=false`, `fixtureDatabase=false`, and `writerFenceId` |
| `checklistSha256` | SHA-256 of the exact bytes of `release-url-checklist.json` |
| `articles` | All 112 exact checklist slugs, each with isolated `id`, canonical digest of `articleInput(record)` as `inputSha256`, exact visible `title`, distinctive `bodyText` probe (at most 500 characters), complete rendered `seoTitle` and `seoDescription`. The isolated baseline must publish all 112 records. |
| `categoryIds`, `settingsIds` | Seven distinct existing category UUIDs and eight distinct existing settings UUIDs. Each scope needs at least two published articles for ordered feature checks. |
| `functions` | Eight distinct full built server-function IDs from this exact deployment: `listServer`, `previewServer`, `saveServer`, `stateServer`, `settingsServer`, `categoryServer`, `pageServer`, `articleServer` |
| `media` | New UUID `uploadId`, exact `pathname=article/<admin-staff-id>/<uploadId>`, exact Blob `url`, and `imageSha256` of the runner's fixed valid 69-byte PNG |
| `recovery` | Named `id`, literal `table=articles`, exact `offlineTable=task7_offline_<runId without hyphens>`, and `maxDurationMs` from 5000 through 60000. Approve the bounded read-outage operations below; no default fault authority is inferred. |
| `cleanup` | Named `id`; literal mode `restore-exact-blog-rows-and-delete-exact-upload`; exact `articleIds`, `categoryIds`, `settingsIds`, `uploadId`, `blobUrl`, all matching the preceding inputs |

The immutable configuration receipt must verify **both build-time and runtime**
auth configuration, runtime DB and Blob bindings, public site origin/canonicals,
and absence of local fixtures. A matching JSON digest is integrity evidence,
not independent proof of that configuration. The owner must review its original
evidence. Runtime also checks Vercel deployment metadata, Neon endpoint mapping,
the actual SQL connection identity, active session rows/roles, content identity,
real browser cookie-to-token identity, and uploaded metadata in the isolated DB.

The binding must additionally contain `backgroundJobs=disabled-by-owner` and
`knowledgeInvalidation=disabled-by-owner`. Article writes normally activate
`ep_knowledge_articles`, which updates knowledge chunks and queues repair jobs.
The owner must separately disable that trigger and all background workers/cron
on this isolated target before acceptance. The runner does not perform that
persistent change. Its live catalog preflight requires that exact trigger to be
disabled, the four blog/category/revision integrity triggers to remain enabled,
and no unknown non-internal triggers on the touched tables. This excludes AI
knowledge/worker integration acceptance; it prevents untracked side effects
from being mistaken for complete cleanup.

Known production project `prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5`, Neon project
`dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, database `neondb`,
`earnestproperty.com` and Earnestproperty Vercel aliases are refused even if
omitted from the submitted exclusion inventory. The true production endpoint,
auth and Blob values must be supplied by the owner in the exclusion inventory;
the runner cannot infer those from redacted evidence.

## Exact allowed operations and cleanup

- Read the one Vercel deployment and one Neon endpoint using read credentials.
- Read all 112 URLs twice, verify exact public/CMS identity, content, canonical,
  metadata and returned cache headers, then check sitemap/llms publication sets.
- Save/reload all 112 approved records, edit and restore all eight settings and
  seven categories, check ordered featured placement and scope independence.
  Exercise anonymous 401, agent settings/category/publish/unpublish 403,
  manager/admin writes, stale-save 409, private agent drafts, unpublication,
  future/null dates and exact request-ID lost-response retry. No new article,
  category, auth identity, session or deployment is created by the runner.
- Upload the fixed test PNG as admin at the one approved path; verify public
  bytes/content type and DB metadata, anonymous 401, cross-actor manager/agent
  upload-ID conflict 409 and exact admin retry. Agent/manager uploads are an
  allowed product capability: the negative case is reuse of another actor's ID.
- Run the shared 27-page accessibility matrix at 375/1440 px, all eight blog
  page scopes, all 112 articles, and list/editor scans for all three staff roles.
  WCAG 2/2.1/2.2 AA tags, best practices, current navigation/filter/pagination
  and minimum mobile Chinese running-text size match the normal a11y suite.
  Missing dynamic data, login redirects, skipped pages and non-200 outcomes fail.
  Third-party frames are excluded as in the existing suite. Browser network
  requests are restricted to approved app/auth/Blob origins and read methods.
  Direct credential-free GET navigations into excluded third-party iframes
  (including the contact page's Google Maps embeds) are aborted before network
  access and recorded as `browser-excluded-frame`, without failing the parent
  scan. This exception applies only to iframes directly owned by the approved
  main page during the accessibility suite. Top-level navigation, other foreign
  resources, credentials, writes, approval expiry and every redirect remain
  fatal. The scanner still reports accessibility violations in the parent page.
  Every response is fetched with zero redirects; all 3xx responses (including
  same-origin redirects) fail before another hop receives headers or cookies.
- Separately exercise read-outage recovery after the request-ID replay check.
  Temporarily rename only `public.articles` to the exact approved `offlineTable`
  in this exclusive isolated database. Record its catalog OID and both names in
  the durable journal before dispatch. Require actual page/article RPC 503s,
  both hosted documents returning 500 with the unavailable heading and Retry
  button, then restore the same OID to `articles` and click both Retry buttons.
  Require real successful RPC responses and the expected rendered headings
  within `maxDurationMs`; simulated browser errors or successful replay do not
  count. The rename transactions use 3-second lock and 5-second statement limits.
  A process-local watchdog and `finally` restore the name on failure. **A killed
  process or lost DB connection cannot guarantee the time bound:** retain the
  writer fence and use separately approved exact-OID recovery if restoration
  cannot be verified. This operation requires the isolated table owner's DDL
  authority and the explicit `bounded-read-outage` approval action.
- Capture a private baseline before writes. Restore only approved article,
  category, settings, feature, article-revision and associated `audit_logs` rows;
  remove client-journaled request IDs plus internally generated archive requests
  proven to belong to an exact unpublish parent by transaction ID (`xmin`),
  actor, article, operation, command and result. Reconcile and journal those
  exact IDs before deletion; read back the **entire** `blog_mutation_requests`
  table against the immutable baseline. Unknown or missing children, foreign
  writes and changes to baseline rows fail cleanup; the table is never excluded.
  `ops_audit_logs`, users, roles, migrations, import receipts and other resources
  are outside this cleanup. The owner must approve **transactional disable and
  re-enable of `cms_revision_immutable` and `blog_project_article_revision` on
  `public.cms_content_revisions`**, plus exact restoration of test audit rows.
  These controls require table ownership. They are in one locked transaction;
  rollback restores trigger state on failure. No whole-table truncate or
  database/branch deletion occurs. Unexpected foreign revision/audit writers
  stop restoration; the exclusive writer fence is mandatory.
- Delete only the approved Blob URL, with verified bytes and current ETag as
  `x-if-match`, and its exact owned media intent/metadata rows. Verify 404 (bounded
  polling for CDN removal) and DB absence. Media and blog cleanup are attempted
  independently; any failure prevents a passing receipt.

These operations need the owner's exact approval; preparing this request does
not grant it. Test writers must remain exclusive through final cleanup. On
process termination, expiry or any incomplete journal, keep the isolated target
fenced and review the exact journal for separately approved recovery. The CLI
does not automatically resume/replay a crashed run or provision a replacement.

## Private credential delivery and commands

Use a clean environment and already installed Node (with `registerHooks`),
TypeScript and Chromium. Bun runs the pure guard tests only; Node runs native
acceptance and loopback browser regressions because Bun's Chromium launch hangs
on this Windows host. Do not put
credentials or storage-state contents in this document or tracked files.

| Environment key | Private input |
| --- | --- |
| `HOSTED_DATABASE_URL` | `postgresql://<approved-role>:<password>@<exact-direct-host>/<dedicated-db>?sslmode=verify-full`; no other query options |
| `HOSTED_BLOB_TOKEN` | Existing read/write token whose embedded store ID matches the approved isolated store |
| `HOSTED_VERCEL_READ_TOKEN`, `HOSTED_NEON_READ_TOKEN` | Existing provider read credentials, scoped to the reviewed resources |
| `HOSTED_ADMIN_SESSION`, `HOSTED_MANAGER_SESSION`, `HOSTED_AGENT_SESSION` | Existing real session tokens matching approved SHA-256 values |
| `HOSTED_ADMIN_STORAGE_STATE`, `HOSTED_MANAGER_STORAGE_STATE`, `HOSTED_AGENT_STORAGE_STATE` | Existing private Playwright JSON files; exact file hashes and app/auth-only origins/cookies required |
| `HOSTED_VERCEL_BYPASS` | Optional existing bypass secret, sent only to the exact app origin |

Ambient DB/auth/Blob/Playwright/proxy/TLS overrides are refused. The Node command
does not load `.env` files; pure Bun tests use `--no-env-file`. No production
credentials are read or copied implicitly.

Local validation only:

```text
npm run blog:hosted -- validate <private-input.json>
npm run test:blog:hosted:guards
npm run test:blog:hosted:browser
npm run typecheck:blog:hosted
```

The first command prints `VALID_INPUT_NOT_HOSTED_ACCEPTANCE` and the canonical
`inputSha256`. It performs no network calls. That digest must be independently
reviewed and bound into a separate approval JSON with these exact fields:

```text
status: APPROVED_ISOLATED_EXECUTION
id: <owner's exact approval record ID>
approver: <named accountable owner>
inputSha256: <reviewed canonical input digest>
runnerCommit: <exact final committed runner/deployment SHA>
issuedAt: <UTC instant>
expiresAt: <UTC end of tests and acceptance decision>
cleanupUntil: <later UTC deadline, expressly authorizing only exact cleanup>
actions: [read-provider-bindings, read-112-urls, cms-test-writes,
          test-image-upload, browser-a11y, bounded-read-outage, exact-cleanup]
```

After the exact future approval, on the clean committed branch:

```text
npm run blog:hosted -- execute <private-input.json> <private-approval.json> <new-private-output-directory> <independently-reviewed-approval-file-sha256>
```

The parent output directory must already exist; the run directory must not.
The private output contains one immutable `baseline.json` and append-only,
hash-chained `journal-00000001.json` generations, including request intents and
per-check evidence. Each file is flushed before atomic publication; a failed or
interrupted write leaves a `.pending` file without replacing earlier evidence.
`readRecoveryJournal` is read-only inspection, not resume authorization. A write
failure poisons the writer and stops further dispatch. This is process-crash
recovery evidence, not a guarantee against disk loss or hardware power failure.
Protect these files as private test data. The runner writes `receipt.json`
only after every required check and exact cleanup succeeds within approval.
Failures exit nonzero with a generic message and retain an incomplete journal;
do not infer successful cleanup from exit status. A forged receipt JSON is not
evidence: only the native command's bound journal and actual provider results
can support acceptance. Unit callback seams cannot issue a runtime receipt.

Hosted acceptance does not authorize production deployment, traffic changes,
cache purge, merge, migrations, content writes or writer reopening. Returned
absence of a Vercel-consumed CDN header is recorded as absent, not invented;
cacheable returned directives, HIT/STALE and positive Age fail. Repeated fresh
responses are checked, but no production CDN purge is performed or claimed.

Provider cleanup protocol references: [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[delete implementation](https://github.com/vercel/storage/blob/main/packages/blob/src/del.ts),
[API origin](https://github.com/vercel/storage/blob/main/packages/blob/src/helpers.ts).
These documentation reads did not access the user's deployed services.
