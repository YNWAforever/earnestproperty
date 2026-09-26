# Earnest Property 修復及 WhatsApp 批量工作流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL（如執行環境提供）: 使用 `superpowers:executing-plans` 逐項實作；以 checkbox 記錄進度。指定執行模型：**Codex GPT-6 Sol**。本文件是交接計劃，不表示任何程式、資料或正式設定已被修改。

**Goal:** 修復公開樓盤搜尋及查詢上下文，讓管理員可靠地建立、管理及批量匯出 WhatsApp 追蹤連結，並能驗證指定同事的分派和通知結果。

**Architecture:** 沿用 TanStack Start server functions、Neon 原生參數化 SQL、現有工作佇列、不可變連結版本及 WOZTELL transport。抽出共用的公開樓盤上下文、同事 readiness 和批量服務；UI 接駁既有功能，不另造 CRM、身份系統或訊息發送通道。

**Tech Stack:** React 19、TypeScript、TanStack Start/Router/Query、Vite、Neon Postgres/Auth、Zod、Tailwind/shadcn、Node test runner、Bun、Playwright；版本以執行時的 lockfile 為準。本計劃不要求升級框架。

**Spec:** 隨包附上的 `references/EarnestProperty_Audit_2026-09-27_zhHK.md` 與 `references/EarnestProperty_Audit_2026-09-27_zhHK.html`。MD 為 F01–F24 文字依據；HTML 包含同一內容及三張原始截圖。兩者均須閱讀。

**Repository:** https://github.com/YNWAforever/earnestproperty  
**Live:** https://earnestproperty.vercel.app/  
**Admin:** https://earnestproperty.vercel.app/admin  
**Audit baseline SHA:** `098844e6a97545e1b590f45c756a8d2ca77db7bb`  
**計劃日期:** 2026-09-27，Asia/Hong_Kong。

## Global Constraints

- 在目前最新目標分支上實作；先與 audit baseline 比較。不得把 repository reset 到舊 audit SHA，不得覆蓋使用者未提交改動。
- 先讀適用的 `AGENTS.md`、`CLAUDE.md`、package scripts、lockfiles 及相關資料庫 migration。舊文件中的 cron／角色描述可能過時，須以程式和已驗證 schema 核對。
- 公開及 staff UI 使用繁體中文（香港）；保留品牌、路由和既有買樓／租樓／CRM 功能。
- `.server.ts` 維持 server-only；client server-function wrapper 以動態 import 讀 server 實作。使用現有 `requireStaffAccess` 和 capability checks；SQL 全部參數化。
- 不改動生成的 `src/routeTree.gen.ts`；不重加已有 Vite/TanStack plugins；不為此工作導入 ORM。
- 保留公開樓盤 canonical identity、最新來源選擇及下架優先；內部 SYNC ID 不能成為客戶看到的編號。
- 保留 immutable link version、`expectedVersion`、job lease、發送前重新驗證及權限校驗。無法讀取設定時應顯示 unknown/blocked，不可假定可發送。
- **點擊連結 ≠ 已查詢；requested staff ≠ confirmed assignment；provider accepted ≠ delivered；Inbox private note ≠ 同事 WhatsApp。** 每個狀態獨立儲存／呈現。
- 公開 GET 不得 provision 連結；建立連結／儲存映射不得發訊息；複製／預覽不得觸發 staff notification。
- 不移除同事端點核實、permission、客戶與同事目的地隔離、reply-context、correlation、association-review 或未驗證模板阻擋以取得假成功。
- 延用現有每次批量寫入 **最多 50 條**。跨批次是部分完成，不可假裝整個任務原子成功。
- 開發及自動測試使用合成資料與隔離 DB／供應商 stub。不能因測試名稱含 e2e 就在正式環境送訊息。
- 原使用者已要求指定同事試送，但未提供同事身份及核實接收端點。先完成所有不依賴它的實作；只把實際試送標為 blocked。不能擅自選名為 test 的記錄或猜手機號碼。
- 本次授權是編寫計劃。往後收到執行指令後，可完成 branch、測試及可審閱 PR；正式合併、部署、migration、批量資料更新與發送按當時已有授權執行，不重新詢問已授權事項。

## Review Focus

1. **相同公開編號多個來源／租售並存／最新來源已下架**：搜尋與 CTA 必須指向正確 current offering，不復活舊盤。由 T01、T02 測試。
2. **preview 後同事停用、映射換版或放盤下架**：提交及真正發送均重新驗證，不能只信前端 snapshot。由 T04、T06、T07 測試。
3. **雙擊、兩個管理員並行、commit 後 response 丟失**：重試取得同一結果，不能新增重複連結或重送。由 T06、T07 測試。
4. **供應商超時／結果不明／回執先後次序不同**：保留 unknown，先 reconcile，不把 accepted 升級為 delivered、不盲目再發。由 T04、T13 測試。
5. **角色不足、session 過期、CSV 公式字串及大批資料**：拒絕越權、可恢復登入、匯出安全、分頁不遺漏。由 T03、T07、T08、T09 測試。

## 1. Codex 執行方式與交付物

把此計劃放到 repository 的 `docs/superpowers/plans/2026-09-27-earnest-audit-remediation.md`，審核資料放同目錄下 `references/` 或保留本交接包並記錄實際相對路徑。不要把含登入資料的截圖、raw provider payload 或正式名單放進公開 git。

依 T00–T13 的依賴次序執行，每一 task 完成：相關測試 → 實際結果 → 更新 finding ledger → 小範圍 commit。可沿用環境正常的單一 agent 執行方式，不要求額外 sub-agent。

建立以下文件，持續更新而非每次另寫新報告：

- `docs/reports/2026-09-27-earnest-remediation-ledger.md`：F01–F24、基線、task、commit、測試證據、狀態。
- `docs/reports/2026-09-27-earnest-validation.md`：實際執行的 commands、exit code、passed/failed/skipped、UI 截圖位置。
- `docs/reports/2026-09-27-earnest-rollout.md`：migration、feature flags、部署次序、回滾與資料修復方式。
- `docs/runbooks/whatsapp-staff-handoff-test.md`：第 9 節的實際試送 runbook 及當次證據欄位。

Ledger 狀態只用 `open / reproduced / fixed-local / verified-staging / verified-production / blocked / no-longer-reproducible`。`no-longer-reproducible` 必須有 current SHA 和重測證據；blocked 不算修復完成。

## 2. 依賴、工作包及全部 findings 對照

| 工作包 | Tasks | 依賴 | 可審閱成果 |
|---|---|---|---|
| A 基線與公開查詢 | T00–T02 | 無 | 搜尋命中、customer-facing identity 一致、完整 CTA fallback |
| B 分派、能力及通知 | T03–T05 | T00；T05 依 T04 | 真實 schema regression、readiness、映射及試送介面 |
| C 批量管理 | T06–T08 | T01、T04；T07 依 T06；T08 依 T06–T07 | 可恢復批次、查重、分頁、編輯、CSV、樓盤勾選入口 |
| D Onboarding／內容／健康 | T09–T11 | T04；其餘可在核心修復後執行 | 人員與帳戶狀態分離、可信指標、內容清理 |
| E 效能與驗收 | T12–T13 | 量度可先行；release 依所有涉及功能 | 香港效能證據、staging journey、指定同事單筆驗收 |

| Finding | 主責 task | 補充依賴 |
|---|---|---|
| F01 | T01 | T12 查詢效能 |
| F02 | T01 | T02 CTA |
| F03 | T02 | T06 補建 |
| F04 | T11 | T13 公開頁 |
| F05 | T11 | T10 真人回覆數據 |
| F06 | T11 | T08 待辦 |
| F07 | T02 | T13 分享預覽 |
| F08 | T03 | T13 DB 與 UI |
| F09 | T04 | T05、T08 |
| F10 | T04 | T05、T13 |
| F11 | T04 | T13 能力及送達驗證 |
| F12 | T05 | T04 readiness |
| F13 | T10 | T05 policy 顯示 |
| F14 | T08 | T06 preview |
| F15 | T07 | T08 列表 UI |
| F16 | T06 | T08 批量 UI |
| F17 | T07 | T03 權限回歸 |
| F18 | T12 | T13 隔離負載測試 |
| F19 | T09 | T04 readiness |
| F20 | T09 | T13 首次登入 |
| F21 | T10 | T04、T13 |
| F22 | T08 | T09、T11 |
| F23 | T12 | T13 比較證據 |
| F24 | T12 | T06 集合驗證 |

## 3. 已核對的檔案邊界及重用要求

以下是 audit SHA 的存在路徑。執行時如搬位，以 `rg` 找到新的 owner，更新 ledger；不要因舊路徑不存在就新造重複模組。

| 範疇 | 已有檔案／功能 | 修改原則 |
|---|---|---|
| 公開 identity | `src/lib/property-public.ts` 的 `publicPropertyNo`、`activePropertyOfferings`、`selectPropertyOffering` | 先修現有 helper／DTO，避免另一套公開編號邏輯 |
| 公開讀取 | `src/lib/neon/public-data.server.ts`；`src/routes/index.tsx`、`listings.tsx`、`property.$listingNo.tsx` | 搜尋與 detail 使用同一 canonical current-offer 規則 |
| SEO | `src/lib/listing-seo.ts`；`src/routes/__root.tsx` | 保留 CMS 文案 override，補 route-specific meta |
| 連結服務 | `src/lib/neon/whatsapp-enquiries.ts`、`.server.ts`、`.types.ts` | 沿用 `saveWhatsappTrackingLink`、`provisionWhatsappLinks`、`resolveWhatsappLinks` |
| 分派／通知 | `src/lib/whatsapp-enquiries/assignment.server.ts`、`staff-notifications.server.ts`；`src/lib/woztell/staff-whatsapp-transport.server.ts` | 修正和重用 existing state machine／job pipeline |
| 同事設定 | `src/routes/admin.whatsapp-settings.tsx`；`StaffEndpointEditor.tsx`、`StaffReferenceEditor.tsx`、`WhatsappServicePolicyEditor.tsx`；`src/lib/neon/staff-endpoints.ts`、`.server.ts` | 同事集中設定，能力分開，不漏 secrets |
| 物業 bulk | `src/routes/admin.listings.tsx`；`AdminPropertyBulkActions.tsx`；`src/lib/admin/property-bulk-client.ts` | 保留既有上下架／指定代理；加入連結建立 action |
| 團隊 | `src/routes/admin.team.tsx`；`src/components/admin/team/`；`src/lib/neon/admin-team.*`、`staff-lifecycle*` | 沿用身份綁定、邀請與 owner 保護，不建立第二個帳戶系統 |
| 健康 | `src/lib/whatsapp-enquiries/service-health.server.ts`；`src/lib/control-plane/health.server.ts`；`src/components/admin/operations/WhatsappServiceHealth.tsx` | 共用實際 runtime flags 及 due-work 語義 |
| 屋苑內容 | `src/routes/estate.$slug.tsx`；`src/content/estate-pages.ts`、`estate-registry.ts`、`core-estates.ts`、`castle-peak-road-estates.ts` | 核對是否被 DB/CMS override，改真正內容來源 |
| 圖片 | `src/components/media/AppImage.tsx`；`src/lib/media/responsive-images.generated.json`；`scripts/media/generate-responsive.mjs` | 已有 srcSet 支援，修 gallery 使用方式及缺失 variants |
| 測試 | `e2e/staff-handoff.spec.ts`、`scripts/test-staff-handoff-browser.mjs`、`playwright.config.ts` | 使用現有 staging fixture 邊界；擴充 journeys |

**補充發現：** `assignment.db.test.mjs` 在 audit SHA 第 94 行把 `staff_roles.role` 建成 `text`，而正式 migration 使用 `staff_role` enum。因此既有綠燈測試不能排除 F08；T03 必須使用真實 enum schema。

## 4. 共用接口設計

以下是本計劃的目標 contract，不聲稱現有版本已有。現有相容 API 優先保留；新 consumer 統一採這些 DTO。`StaffAccess`、`TrackingLinkInput`、`TrackingLink` 重用 repository 的現有型別。

### 4.1 公開查詢上下文（T01–T02）

在新檔 `src/lib/whatsapp-enquiries/public-context.ts` 定義：

```ts
type PublicWaOffer = {
  propertyId: string;
  publicListingNo: string;
  dealType: "sale" | "rent";
  title: string;
};
type PublicWaAction = {
  href: string;
  mode: "tracked" | "untracked" | "contact";
  publicListingNo: string;
  dealType: "sale" | "rent";
};
buildPublicWhatsappMessage(offer: PublicWaOffer): string;
```

`resolveWhatsappLinks` 的現有 shape 如有其他 consumer，不破壞它；加 typed adapter 輸出 per-offer `PublicWaAction`。公司電話只使用既有可信 config；公開結果不能帶 requestedStaffId、Inbox IDs、endpoint reference。

### 4.2 同事 readiness（T04）

新建 `src/lib/neon/whatsapp-readiness.types.ts`、`.ts`、`.server.ts`。Client wrapper `getWhatsappStaffReadiness` 與 runtime wrapper `getWhatsappRuntimeStatus` 只供獲授權 staff；server 每次按 actor 核權。

```ts
type CapabilityState = "ready" | "blocked" | "unknown";
type ReadinessReason = { code: string; message: string; actionHref?: string };
type Capability = { state: CapabilityState; reasons: ReadinessReason[] };
type StaffWhatsappReadiness = {
  staffId: string;
  displayName: string;
  active: boolean;
  assignment: Capability;
  inboxPrivateNote: Capability;
  staffWhatsapp: Capability;
  maskedDestination: string | null;
  mappingVersion: number | null;
  endpointVersion: number | null;
  checkedAt: string;
};
type WhatsappRuntimeStatus = {
  mode: string;
  serviceEnabled: boolean;
  assignment: Capability;
  customerReply: Capability;
  staffWhatsappText: Capability;
  staffWhatsappTemplate: Capability;
  approvedPolicyVersion: number | null;
  checkedAt: string;
};
```

必需 reason codes：`staff_inactive`、`role_ineligible`、`mapping_missing`、`mapping_unverified`、`mapping_retired`、`channel_mismatch`、`endpoint_missing`、`endpoint_unverified`、`permission_missing`、`outside_message_window`、`template_unverified`、`runtime_disabled`、`schema_unavailable`。可加更細原因，UI 不顯示 raw exception。

Assignment ready 只代表可分派；不強迫有手機通知才可作 Inbox 接單。選用 staff WhatsApp 通知時才要求該 capability ready。Mapping 的 UI 勾選不能代替實際 provider verification。

### 4.3 批量 preview／commit（T06–T08）

新增 `src/lib/neon/whatsapp-link-batches.types.ts`、`.ts`、`.server.ts`；沿用現有 provision 的驗證及 transaction 基礎，把可共用邏輯抽小，不複製整個服務。

```ts
type BatchRow = {
  rowKey: string;                 // stable within one draft; UUID
  input: TrackingLinkInput;
  placementKey: string;           // server-normalized placement identity
};
type BatchRowPreview = {
  rowKey: string;
  decision: "create" | "reuse" | "blocked";
  existingLinkId: string | null;
  reasons: ReadinessReason[];
};
type BatchPreview = {
  batchId: string;                // UUID generated once per operator draft
  previewToken: string;           // server-authenticated; actor/hash/expiry scoped
  expiresAt: string;
  rows: BatchRowPreview[];
  counts: { create: number; reuse: number; blocked: number };
};
type CommitChunkInput = {
  batchId: string;
  chunkId: string;                // stable UUID on retry
  previewToken: string;
  rows: BatchRow[];               // 1..50
};
type BatchRowResult = {
  rowKey: string;
  outcome: "created" | "reused" | "blocked" | "failed";
  linkId: string | null;
  code: string | null;
  version: number | null;
  reasonCode: string | null;
};
type CommitChunkResult = {
  batchId: string;
  chunkId: string;
  state: "committed" | "rejected";
  rows: BatchRowResult[];
};
```

Wrappers：`previewWhatsappLinkBatch({batchId,rows})`、`commitWhatsappLinkChunk(CommitChunkInput)`、`getWhatsappLinkBatchResult({batchId})`。設定本輪 UI preview 上限為 **1,000 個展開後 rows**，不是 1,000 個物業；超過明示分拆工作，不靜默截斷。這是本計劃新增的初始產品上限，可日後有量測再調整。

Preview token 10 分鐘有效，綁 actor、canonical payload hash、允許的 row keys。不能用前端 hash 當授權；commit 仍重新驗證 DB。若採 server-side snapshot ID 而非 signed token，必須提供同等 actor scope、payload match、有效期及不可竄改保證，記錄選擇理由。

## 5. Implementation tasks

### T00 — 核對版本、依賴、schema 及測試環境

**Files:** 讀 root instructions、`package.json`、lockfiles、`neon/migrations/`、`vercel.ts`、`workers/cron/`；建立第 1 節 ledger／validation／rollout。

**Interfaces:** 輸出 baseline manifest：current SHA、audit diff、package manager、Node/Bun、測試 DB identity、preview origin、可用 test commands；不輸出 secrets。

- [ ] 確認 repository origin、branch、工作目錄改動；建立隔離 branch／worktree（如需要）。
- [ ] 重讀兩份 audit，F01–F24 全數進 ledger。對照最新提交標示仍存在／已變更／需重測。
- [ ] 按 lockfile 及現有 CI 安裝，讀 package scripts；此 repo 沒有通用 `npm test`，build 不包括 typecheck。
- [ ] 檢查 DB tests 所需 `ASTRA_TEST_DATABASE_URL`／`ASTRA_TEST_BRANCH_ID`。部分現有測試綁定特定 branch ID；只在真實獲授權隔離 branch 執行，不能偽填 ID 或移除檢查。
- [ ] 為新 integration tests 建立明確的 isolated DB allowlist、合成 schema、cleanup 及 provider-network deny guard；可另建新 harness，不改寫舊安全 guard 以強行通過。
- [ ] 執行下列 baseline unit scripts，記錄原有失敗／跳過；建立空 ledger 不能當成修復。

```sh
npm run typecheck
npm run test:listing-search
npm run test:whatsapp-enquiries
npm run test:staff-notifications
npm run test:team
```

**Done:** baseline 可重現，DB 測試不會連到 production；所有未具備 access 有明確項目，不阻擋純程式工作。

### T01 — 修復公開編號搜尋、顯示及多來源一致性（F01、F02）

**Modify:** `src/lib/neon/public-data.server.ts`、`src/lib/property-public.ts`、`src/routes/index.tsx`、`src/routes/listings.tsx`、`src/routes/property.$listingNo.tsx`。
**Tests:** 擴充 `src/lib/property-public.test.ts`、`src/lib/neon/listing-search.contract.test.mjs`、`src/lib/neon/property-identity.db.test.mjs`；新建 `src/lib/neon/public-number-search.db.test.mjs`。
**Interfaces:** 保留 `publicPropertyNo`／`selectPropertyOffering` consumer；輸出資料有可信 public number 和正確 active offer ID。

- [ ] 建立 fixture：public A074714 → internal SYNC UUID；同 public number 有 sale、rent、多來源以及最新來源下架。
- [ ] 寫行為 regression：`A074714`、`a074714`、` A074714 ` 命中；舊合法 alias 解析至 canonical；內部 ID 不出現在 breadcrumb、form、訊息；最新下架不回退較舊 active。
- [ ] 執行新 test，確認能以現有行為失敗；DB test 須真正執行 SQL，不能只搜尋 source string。
- [ ] 修改 keyword join／EXISTS 讓 public number 和 alias 被搜尋；維持參數化 LIKE escaping；精確編號優先，count 和資料 rows 用同一 predicate，不因 join 重複計數。
- [ ] 公開 CTA／form 使用已有 helper；缺 canonical identity 時顯示資料待核實／總台入口，不用 `SYNC` 補位，也不靠切字串猜編號。
- [ ] 跑 `npm run test:listing-search`、`npm run test:property-experience` 和新 DB test；在 preview 重做 A074714 等價 fixture，記錄輸出。
- [ ] Commit：`fix(public): unify public listing search and display identity`。

### T02 — 共用 WhatsApp CTA、完整 fallback 及分享 meta（F03、F07）

**Modify:** T01 路由、`src/lib/neon/whatsapp-enquiries.server.ts`、`.ts`、`src/lib/listing-seo.ts`、`src/routes/__root.tsx`、`src/components/property/PropertyDecisionActions.tsx`。
**Create/Test:** `src/lib/whatsapp-enquiries/public-context.ts`、`public-context.test.mjs`；擴充 `src/lib/listing-seo.test.ts`、`e2e/public-acceptance.spec.ts`。
**Interfaces:** 實作第 4.1 節；沿用 tracking resolver，所有 surfaces 用同一 per-offer action。

- [ ] Test：tracked link exists → `/w/`；missing/disabled link → 公司 wa.me 仍有公開編號、租售及標題；電話未設定 → `/contact`；任何分支不含 staff/internal IDs。
- [ ] `buildPublicWhatsappMessage` 固定基本格式：「您好，我想查詢樓盤 {publicListingNo}（{出售／出租}）：{title}。」；不要在 untracked fallback 自造 EPWA token。
- [ ] 首頁／列表每批 offers 一次 resolve，避免 N+1；detail desktop/mobile 改用選中的 sale/rent offer，切換後不保留上一個 offer URL。
- [ ] Public read 不 provision。對缺連結的 offering 提供 T08 後台待辦；T06 完成後加入可預覽的補建動作。自動補建只可由既有發佈／匯入 job 以相同 idempotent service 執行，預設不自動擴大投放。
- [ ] 保留真實錯誤 observability 和可用 fallback；區分 resolver 正常無記錄與系統錯誤，兩者都不能假報 tracked。
- [ ] 每頁 `og:url`／canonical 對應正確 public URL；保留 CMS metadata override；canonical deal-query policy 維持目前規格，不擅自大規模改網址。
- [ ] 跑 `node --test src/lib/whatsapp-enquiries/public-context.test.mjs`、`npm run test:seo`、`npm run test:property-experience`；browser 核對四個 CTA surfaces 和 SSR head。
- [ ] Commit：`fix(whatsapp): preserve property context across public entry points`。

### T03 — 以真實 enum schema 修復分派面板（F08）

**Modify:** `src/lib/whatsapp-enquiries/assignment.server.ts`、`src/components/admin/WhatsappEnquiryContext.tsx`、`src/lib/neon/whatsapp-assignment.ts`。
**Tests:** `assignment.test.mjs`、`assignment.db.test.mjs`；新建 `assignment-role-enum.db.test.mjs`（同目錄）。
**Interfaces:** 保留 `readAssignmentContext` 的授權邊界；回傳可辨認的錯誤類型及 request ID，不向 browser 洩露 raw SQL。

- [ ] 在隔離 schema 建真正 `staff_role` enum，測試 admin、manager、agent、viewer／無角色、inactive，以及 agent 不屬於該對話。
- [ ] 執行現有 `r.role=ANY($2::text[])` 查詢，記錄實際錯誤；若 live 根因不同，補 trace 證據再修，不能只改成綠燈 UI。
- [ ] 若型別問題重現，採相容 enum[] 或明確 role cast；此處不需要把正式 enum 改為 text，更不能刪除角色 predicate。
- [ ] 保留 assigned conversation 範圍檢查；區分 401、403、找不到、schema unavailable 和服務錯誤。UI 的「重新整理」只重新讀，不觸發 assignment。
- [ ] 執行 `npm run test:whatsapp-enquiries` 和新 enum DB test；成功條件是 authorized context 有資料、越權被拒，0 個關鍵 DB test skipped。
- [ ] Commit：`fix(whatsapp): read assignment evidence with production role types`。

### T04 — 共用 readiness 與真正可用的通知能力（F09–F11）

**Create:** 第 4.2 節三個 readiness 檔案；`src/lib/whatsapp-enquiries/readiness.test.mjs`、`readiness.db.test.mjs`。
**Modify:** `staff-notifications.server.ts`、`src/lib/neon/staff-endpoints.server.ts`、`src/lib/woztell/staff-whatsapp-transport.server.ts`；新增該 transport 的測試。
**Interfaces:** 第 4.2 節 DTO；UI、batch preview、commit 和 dispatcher 分享同一 capability policy，但 dispatcher 必須讀最新狀態。

- [ ] Test matrix：active 無 mapping、mapping retired、wrong channel、verified Inbox only、verified phone only、missing permission、runtime off、window expired、template unsupported。
- [ ] 集合讀取 staff＋roles＋mapping＋endpoint，輸出 ready/blocked/unknown；未有 mapping 的人也要出現在結果。錯誤與缺 schema 不得變成 empty＝全部正常。
- [ ] 維持三種能力分離；手機顯示遮罩，安全的管理員細節才可核對原始端點；日誌不記 access token、raw phone 或 customer message body。
- [ ] 畫面顯示「可用」須寫明 customer reply、Inbox assignment、private note 或 staff WhatsApp；保留 accepted、delivered、read 各自時間和證據來源。
- [ ] 模板部分：閱讀目前 WOZTELL 官方 API 文件及 repo provider contract；取得已批准 template name、language、參數 schema 和 provider result fixture 後，實作 typed template payload、解析及測試。不能直接移除 `STAFF_TEMPLATE_CONTRACT_UNVERIFIED`。
- [ ] 若外部模板設定／權限未提供，仍完成 readiness、文字通知、UI 和 contract boundary；模板維持 blocked 並記錄具體缺項。這是外部依賴未完成，不能把 F11 全部標 fixed。
- [ ] Test unknown timeout → unknown/reconcile、明確拒絕 → failed、accepted 不升 delivered；重送／重複 receipt 不增加通知；設定 template 不應把可用的 session text path 誤判為已使用模板。
- [ ] 跑 `npm run test:staff-notifications`、`npm run test:whatsapp-enquiries`、新 readiness 和 transport tests；通知 DB suite 在隔離環境執行。
- [ ] Commit：`feat(whatsapp): expose verified staff routing and notification readiness`。

### T05 — 同事映射 wizard、清楚接收端及安全試送（F12；支援 F09–F11）

**Modify:** `src/routes/admin.whatsapp-settings.tsx`、`StaffEndpointEditor.tsx`、`StaffReferenceEditor.tsx`。
**Create:** `src/components/admin/whatsapp/StaffMappingWizard.tsx`、`StaffReadinessBadge.tsx`、`StaffTestNotificationDialog.tsx`；`src/lib/neon/whatsapp-test-notification.ts`、`.server.ts`；對應 component／service tests。
**Interfaces:** 消費 readiness；`previewStaffTestNotification({staffId,transport,endpointVersion})` → 遮罩目的地／文字／阻擋原因；`enqueueStaffTestNotification({staffId,transport,endpointVersion,requestId,previewToken})` → job/attempt ID。server 重新驗證 token、actor、endpoint 及 request id。

- [ ] 四步：選同事 → 連接 Inbox → 選通知方式 → 核實與試送。不要三個分散同事下拉；可從 team/listing readiness deep link 打開指定 staff。
- [ ] 明確填分行／Folder／routingNode 等進階欄位，顯示用途；不憑同名推斷 provider ID。保存及取消不遺留上一同事的目的地。
- [ ] External reference 改姓名＋來源選擇器，不要求一般操作者貼 raw UUID；顯示有效期與核實時間。
- [ ] 試送 dialog 顯示 `[測試]`、姓名、transport、遮罩目的地和文案；只有明確 submit 才 enqueue。預覽、保存映射或打開頁面不送。
- [ ] 使用現有 staff notification pipeline／job lease，不從 browser 直接呼叫 provider。測試採獨立合成 context；不得借用客戶對話或讓 test event 污染營運 SLA。
- [ ] 同一 requestId 重試只一個 attempt；purpose-specific test rate cap 初始為每 actor 每 endpoint 每分鐘 1 次，server enforced；保留 audit trail。這是新增試送保護，不改全站正常通知速率。
- [ ] Test revoked endpoint between preview/submit → blocked；agent 無管理權 → denied；accepted 顯示等待送達；unknown 顯示可核對而非自動重發。
- [ ] 本 task 可完成 stub/staging 驗收；真正向指定同事發送放 T13，未提供收件人不阻擋後續開發。
- [ ] Commit：`feat(admin): guide staff mapping and explicit notification tests`。

### T06 — 可恢復、可查重的批量服務（F16；支援 F03、F24）

**Create:** 第 4.3 節 batch 檔案；`src/lib/whatsapp-enquiries/link-batch-policy.ts`、`link-batches.test.mjs`、`link-batches.db.test.mjs`；migration `neon/migrations/20260927090000_whatsapp_link_batch_operations.sql`（執行時如 timestamp 已被占用，取新的唯一 timestamp）。
**Modify:** `src/lib/neon/whatsapp-enquiries.server.ts`、`.ts`、`.types.ts`。
**Interfaces:** 第 4.3 節；service 以 actor 執行，在 DB transaction 內把 operation result 與 link insert 一起 commit。

- [ ] 先設計並測試 canonical placement key：channel＋public number＋deal＋source＋entry type＋placement identifier＋requested staff／reference＋branch。Website 的 placement identifier 明確命名；不同廣告／影片不合併。
- [ ] 新 migration 建 `whatsapp_link_batch_operations`、`whatsapp_link_batch_rows`，及供可重用連結查找的 placement key metadata；保留 legacy links/code/version，不重寫歷史歸因。
- [ ] Operation 至少有 batchId、chunkId、actorStaffId、payloadHash、state、結果及 timestamps；DB unique `(batch_id,chunk_id)`；row unique `(batch_id,row_key)`。已完成同 key／同 hash 回原結果；同 key／不同 hash 回 `BATCH_PAYLOAD_CONFLICT`。
- [ ] Reuse 只針對 enabled、channel 相符、完整語義相同的已驗證 link。多筆 legacy candidates 時標明衝突需選擇，不自動刪重。新建採 canonical key 的 transaction lock 或等效 DB 約束，並發也不能各建一條。
- [ ] Preview 不建立 link／open／message；驗證全部輸入並按 row 回 create/reuse/blocked。大量 staff／offer／reference 用集合查詢，避免每 row 串行 1–3 次查詢。
- [ ] Commit 每次 1–50 rows，驗 actor、payload、token、current offerings、readiness、reference 和版本。所有事實在 transaction 內重新驗證／鎖定，使同時下架或撤銷不能越過檢查。
- [ ] 每 chunk 全部通過才寫入；若一行現時 blocked，該 chunk `rejected` 且無新 links，顯示其餘行未處理。操作者重新預覽有效 rows 後用新 chunkId 提交；不得悄悄改原 chunk 的 payload。
- [ ] 已 commit 但 response 遺失：先 query operation result；重送相同 chunk 返回同 code/id/version。1000 rows 的任務可部分批次完成，已成功 chunk 不因後續失敗撤銷。
- [ ] Failed/unknown provider semantics 不在此 task；link creation 永遠不產生 outbound message。
- [ ] DB tests 必須覆蓋：2 個 actor 同時建相同 placement、同 chunk 同時提交、commit 後模擬 response lost、不同 payload 重試、preview 後下架／mapping revoke、20×3＝60 rows 的 50＋10 分批。
- [ ] 執行 `node --test src/lib/whatsapp-enquiries/link-batches.test.mjs` 及隔離 DB suite；保留既有 `provisionWhatsappLinks` compatible consumer 或一次遷移所有 callsites 並測試，不留無 idempotency 的新 UI path。
- [ ] Commit：`feat(whatsapp): provision resumable idempotent link batches`。

### T07 — 分頁、編輯、重新啟用、停用與安全匯出（F15、F17）

**Modify:** `src/lib/neon/whatsapp-enquiries.*`、必要索引 migration。
**Create/Test:** `src/lib/whatsapp-enquiries/link-management.test.mjs`、`link-management.db.test.mjs`；`src/lib/admin/whatsapp-link-export.ts`、`.test.ts`。
**Interfaces:** 新 `listWhatsappTrackingLinksPage({q,source,staffId,enabled,cursor,pageSize})` → `{items,nextCursor,total}`；pageSize 25/50/100，預設 50。保留舊 list wrapper 至 consumer 遷移完成。

- [ ] 採 `(created_at,id)` deterministic cursor，篩選及 total 同一語義；不能把 `LIMIT 500` 改為無上限 SELECT。跨頁列出 650 條 fixture，無重複無遺漏。
- [ ] DTO 加指定同事名稱、來源投放 ID、核實時間、readiness、最近試送摘要及定義清楚的 opens/enquiries；缺事件顯示 0，讀取失敗顯示 unknown，不偽造數值。
- [ ] 編輯／停用／重新啟用沿用 save＋expectedVersion；停用只驗管理權限、link 身份及版本，不要求舊 reference 或舊 offer 仍有效；重新啟用才驗全部依賴。
- [ ] 增加 cursor、篩選及 export server authorization；CSV 使用同一 row DTO，不匯出客戶號碼、raw endpoint／Inbox IDs 或 token。
- [ ] CSV 正確處理逗號、引號、換行及 UTF-8 BOM；對以 `= + - @` 或控制字元開始的非數字文字防 spreadsheet formula injection。格式不要依賴使用者 locale。
- [ ] Export 提供「選中」及「全部符合篩選」兩個明確範圍；後者 snapshot IDs 並分頁／stream，不以畫面當頁資料冒充全部。新版本變更不改舊 link code。
- [ ] Test：expired reference 可 disable；過期 expectedVersion conflict；reenable expired reference blocked；650 rows paging；agent越權；CSV公式字串。
- [ ] Commit：`feat(admin): manage and export tracking links with version checks`。

### T08 — 接通單筆與批量五步操作（F14–F16、F22）

**Modify:** `src/routes/admin.whatsapp-links.tsx`、`src/routes/admin.listings.tsx`、`src/components/admin/AdminPropertyBulkActions.tsx`。
**Create:** `src/components/admin/whatsapp/WhatsappLinkWizard.tsx`、`WhatsappLinksTable.tsx`、`WhatsappBatchResult.tsx`；`src/lib/admin/whatsapp-link-batch-client.ts`、`.test.ts`；`e2e/whatsapp-link-bulk.spec.ts`。
**Interfaces:** 消費 T04 readiness、T06 batch contracts、T07 paged list；既有 property selection 由 public property number 展開 current offering IDs。

- [ ] UI 分「樓盤查詢」和「一般查詢」入口；搜尋與選中合一，明示已選樓盤、租售及價格。沒有選中樓盤不能靜默存一般查詢。
- [ ] 樓盤列表加入「建立 WhatsApp 連結」，保留既有批量上下架／指定代理及本頁 selection semantics。
- [ ] 五步 wizard：選盤 → 來源／placement → 跟樓盤代理／統一／逐行指定／總台 → dry-run → 建立及結果。28hse／YouTube 才出相應 external ID 欄位，並提供逐行貼入表格。
- [ ] 「跟樓盤代理」只用真實 assignment；缺代理顯示 blocked 或由使用者明確選總台，不自動換另一位同事。
- [ ] 「本頁 N 個」與「全部符合篩選 M 個」明確分開。全選在 server snapshot 實際 IDs，顯示展開後 offering／link 數；超過 1000 rows 要縮小篩選。Snapshot 後新增物業不默默加入。
- [ ] 提交中保留 request/batch IDs、row結果及進度。畫面離開後可由 batchId 重新載入；失敗重試先查 server結果；不依賴記憶體才能去重。
- [ ] 列表可搜尋、篩選、分頁、編輯、重新啟用及匯出；Copy 成功 toast，失敗則提供可選取 URL。批量結果清楚區分 created、reused、blocked、未提交。
- [ ] 加「未指派代理」「缺網站連結」「缺映射」「待核實內容」待辦入口及 deep links。不能把「已有手機端點」等同「已送達」。
- [ ] Keyboard/focus/labels、loading/empty/error/retry、375px mobile、1366px desktop 驗證；基本操作不需要橫向掃十多欄，次要資訊放詳情。
- [ ] Browser tests：60 rows、50＋10、首批成功次批失敗再試、filter切換範圍、session過期、copy失敗、無電話就緒者不宣稱手機可收。
- [ ] 跑新 client/component tests、`npm run test:admin-properties` 及新 Playwright spec；畫面完成度須有真實 server result，不能用 mock cards 當交付。
- [ ] Commit：`feat(admin): add bulk WhatsApp link creation and recovery workflow`。

### T09 — 團隊 onboarding 與首次登入（F19、F20）

**Modify:** `src/routes/admin.team.tsx`、`src/components/admin/team/`、`src/lib/neon/admin-team.*`、`staff-lifecycle-policy.ts`、`staff-lifecycle.server.ts`、`src/routes/auth.login.tsx`、`auth.$pathname.tsx`。
**Tests:** 擴充 `src/lib/neon/staff-lifecycle-policy.test.mjs`、`src/components/admin/team/AdminTeam.test.tsx`；新 `e2e/staff-onboarding.spec.ts`。
**Interfaces:** Team DTO 增加 server-derived onboarding steps 與 `attentionReasons`，引用 T04 readiness，不更改 staff ID 或按同名自動合併。

- [ ] 狀態拆成人員 active、invitation、email verified、identity bound、role/branch、Inbox readiness、phone readiness；「需跟進」依應有角色能力計算，不要求所有人都有手機通知。
- [ ] Invite 明示人工分享；copy feedback、到期、重發／撤回操作都用既有 lifecycle services，沒有後端支援才補。未實際寄信不顯示已寄出。
- [ ] 未受邀登入者無 staff access，顯示繁中說明與聯絡管理員；驗證電郵前不綁 staff；不把所有登入者自動升為 agent。
- [ ] Staff login 用精簡 staff shell；避免 public marketing footer 干擾。首次登入 checklist 引導本人基本資料，只有管理員／經理可配置供應商映射及高權限角色。
- [ ] 保留 owner admin、防自我鎖出、session refresh 及既有 JWT 修復；新 UI 不另儲存身份 token。
- [ ] Test：active但無email → attention；invitation expired／revoked；同名不同人；驗證前拒綁；viewer/agent不能改roles；既有admin可正常登入。
- [ ] 跑 `npm run test:team`、`npm run test:neon-auth` 及新 staging browser test。
- [ ] Commit：`fix(admin): distinguish staff records from onboarding readiness`。

### T10 — 統一 runtime、policy 及健康狀態（F13、F21）

**Modify:** `src/lib/whatsapp-enquiries/service-health.server.ts`、`src/lib/control-plane/health.server.ts`、`src/components/admin/operations/WhatsappServiceHealth.tsx`、`WhatsappServicePolicyEditor.tsx`、相關 routes、`CLAUDE.md` 的已證實過時說明。
**Tests:** 新 `src/lib/whatsapp-enquiries/service-health-readiness.test.mjs`；擴充 operations／job-wake suites。
**Interfaces:** UI 全部消費 T04 runtime status；Health 加 eligibleStaff、assignmentReadyStaff、staffWhatsappReadyStaff、missingMappingStaff、overdueJobs、lastSuccessAt，不以 array length=0 當健康。

- [ ] 定義 coverage denominator：active 且有接單角色、在目前 channel/branch 服務範圍的人；不把 viewer／非值班對象混入。顯示 X/Y 及 scope。
- [ ] 顯示生效 policy 的 version 與摘要；「編輯草稿」單獨開啟，錯誤只屬草稿。不同 capability／serviceEnabled／mode 不合併成一個綠燈。
- [ ] Worker health 依 due jobs、lease、next alarm/wake 及最近成功判斷；無 due work 的舊 heartbeat 不報停擺，有逾期工作才告警。閾值使用現有 policy／job SLA，不硬寫「22 小時＝壞」。
- [ ] Migration health 核對真實 registry 和 schema；缺必要 schema 的功能標 blocked，不能全站正常。不能以告警作為自動 apply migration 的觸發器。
- [ ] 真人首回覆與 test/spam/bot 排除條件明確；opens、attributed enquiries、assignment、human response 分開，顯示樣本量及時區。
- [ ] Test：27 eligible／1 mapping 給 1/27 readiness，不給0問題；無due work idle不警報；due expired警報；active＋serviceOff 文案一致；schema missing＝blocked。
- [ ] 跑 `npm run test:operations`、`npm run test:control-plane`、`npm run test:job-wake` 和新 health test。
- [ ] Commit：`fix(ops): report actual WhatsApp readiness and due-work health`。

### T11 — 公開內容、媒體承諾及資料待核實（F04–F06）

**Modify:** `src/routes/estate.$slug.tsx`、`src/content/estate-pages.ts`、`estate-registry.ts`、`core-estates.ts`、`castle-peak-road-estates.ts`、首頁文案及實際 CMS owner；媒體呈現 owner。
**Create:** `docs/reports/2026-09-27-content-corrections.md`，逐項 before/after/source/status。
**Interfaces:** 保留 raw imported title／source metadata／人工 override。新增 display normalization 必須可逆，不能反寫原始樓盤事實。

- [ ] 用 rg 找並移除客戶頁面工程文案：SEO 頁、MLS 匯入流程、factual trust proof；檢查 DB override 是否仍帶相同字句。
- [ ] 星堤及其他屋苑逐頁核對地區、交通、業主 CTA；以官方／客戶提供資料驗證，缺證據先用中性文案，不自行捏造班次、設施或地區。
- [ ] 未有可支持的真人 SLA 前，將「5分鐘」及「直達負責代理」改為符合實際總台／營業時間的文字，例如「WhatsApp 查詢樓盤，由團隊跟進」；營業時間未核實不加入數字承諾。
- [ ] 移除顯示標題多餘宣傳前綴及修正文案錯字；睡房／工人房不自動加減推算，矛盾進待核實隊列。有真實可用 VR/video URL 才呈現相應標籤。
- [ ] Content migration／批量更新先輸出 exact rows preview；保留人工編輯來源優先與回復記錄，不用 SQL 全表取代字串。
- [ ] 低風險文案不新增鏡像式測試；執行現有 `npm run test:homepage`、`test:estate-conversion`、`test:blog`、`test:videos`、`test:seo`，人工檢查代表性屋苑及無媒體／無資料狀態。
- [ ] Commit：`fix(content): replace internal copy and unverified property claims`。

### T12 — 量度驅動的效能、圖片和 redirect 限流（F18、F23、F24）

**Modify:** `src/lib/neon/public-data.server.ts`、`src/lib/neon/whatsapp-enquiries.server.ts`、`src/components/media/AppImage.tsx`、detail/gallery、`scripts/media/generate-responsive.mjs`；按 trace 實際瓶頸修改 owner。
**Create:** `docs/reports/2026-09-27-performance-baseline.md`；新 `src/lib/whatsapp-enquiries/redirect-capacity.test.mjs`。
**Interfaces:** Server-Timing/tracing 保留 request ID，不加入 SQL文字／個人資料；public data cache 與 staff/private responses 完全分離。

- [ ] 先量首頁、列表（跟完 redirect）、詳情及 staff links/settings：香港測試點、desktop/mobile、每條至少5個warm樣本，cold另列；記 deployment/DB region、TTFB、DB/SSR timing、request count、transfer bytes。
- [ ] 取得實際 Neon region 後才判斷 iad1 距離；不得因 audit 12秒樣本直接搬區。EXPLAIN 分析 canonical CTE／count/page query後才加 index或預計算。
- [ ] 若導入 public cache，列清 key、TTL、publish/unpublish invalidation；下架後按產品時效立即失效。新測試必須證明不復活withdrawn listing、不快取staff資料、不污染其他filter結果。
- [ ] Gallery縮圖接現有 AppImage 的 srcSet/sizes，生成實際存在的variants；約76px展示依DPR選128/256等合適尺寸，不能只改HTML width而仍下載1200px。主要首屏圖保留優先，其他lazy；width/height穩定避免跳動。
- [ ] T06集合驗證已處理批量N+1；量度50row commit DB round trips並保留transaction語義。Settings透過T04合併readiness reads，避免重複auth往返。
- [ ] Redirect先區分valid已註冊link與無效輸入；為已註冊link加入受控分區限流，保留有界global保護，不對任意code/IP產生無限bucket。限流數值移至可觀察config；不直接移除300/min後宣稱解決。
- [ ] 在隔離staging重現超過300/min及單一link攻擊／多活動同時流量；按預期活動量提供兩組配置的結果，選擇能保護正常campaign且不造成DB hot row的方案。若需edge能力，先驗部署支持再接，不能寫不存在的Vercel配置。
- [ ] 有效但受限link提供保留物業文字的公司聯絡fallback並標untracked；不在過載時mint更多reference。量測prefetch不寫、429/fallback可觀察、registered bucket可清理。
- [ ] 效能目標是本計劃的驗收目標，非現狀聲稱：同測試條件warm median TTFB較基線改善至少30%或已低於1秒；核心DB讀取p95目標300ms；未達標列清trace原因。LCP≤2.5秒、INP≤200ms、CLS≤0.1作後續RUM p75目標，不能以5次synthetic冒充field p75。
- [ ] 跑 `npm run test:media`、`npm run test:listing-search`、`npm run test:whatsapp-enquiries`、隔離 `test:public-performance:db` 和新capacity test；只在staging做負載。
- [ ] Commit：`perf(public): reduce measured query and image overhead`；limiter可另小commit附量測。

### T13 — 整體驗收、指定同事試送、上線及回滾

**Modify/Create:** 第1節的三份報告與 runbook；擴充 `e2e/public-acceptance.spec.ts`、`e2e/staff-handoff.spec.ts` 及新bulk/onboarding specs。
**Interfaces:** 消費全部tasks；輸出每F項的最後證據，區分staging、production、blocked。

- [ ] 執行第6節總驗證；不能用以前36tests通過替代本次測試，不能把skipped DB tests列passed。
- [ ] 依migration expand→code→backfill preview→受控backfill次序完成staging；驗舊links仍可用、舊歸因不被重寫、code rollback仍讀新schema。
- [ ] 試送前完成recipient manifest：staff ID／姓名、Inbox mapping版本、phone endpoint版本／遮罩、transport、channel、核實ref、測試手機、單一測試link、當次request ID。缺任何必要項只阻擋該試送。
- [ ] 由專用測試手機打開真實link並發送原預填EPWA文字；保留open→inbound→enquiry→requested staff→confirmed assignment的同一證據鏈。
- [ ] 分開驗Inbox私人備註及同事WhatsApp。provider接受只標accepted；記錄delivery receipt與本人收件核對，若無read receipt則明示unknown，不補造。
- [ ] 同事開工作連結及回覆，確認對應原測試查詢且不會錯發給客戶／另一同事。duplicate webhook／job replay在隔離環境測試，不重發正式客戶訊息。
- [ ] 瀏覽器組織政策若阻擋WhatsApp，記錄blocker，讓已指定tester在可用裝置完成實際發送；不繞過限制，不把blocked標website failure。
- [ ] 先交付可審閱PR及release notes；部署、正式migration和外部test按實際已有授權執行。未授權時報告具體尚待的動作、review URL和回滾方式，不能只問泛泛「可以繼續嗎」。
- [ ] Production先一名同事／一個測試placement，再小範圍代理和來源。單筆送達未驗證前不自動啟用全隊通知或大量投放。
- [ ] 更新ledger：每項含commit、test、live結果；F11模板或delivery若仍blocked保留缺項，不宣稱全部24項已完成。
- [ ] Commit：`docs(release): record audit remediation evidence and rollout`。

## 6. 驗證命令與成功條件

以下 scripts 已在 audit SHA 的 package.json 核對。執行時先確認名稱；只有新增spec使用直接command。DB和browser命令需真實隔離環境，不偽填env。

```sh
npm run typecheck
npm run lint
npm run build
npm run test:listing-search
npm run test:property-experience
npm run test:whatsapp-enquiries
npm run test:staff-notifications
npm run test:team
npm run test:admin-properties
npm run test:operations
npm run test:control-plane
npm run test:job-wake
npm run test:seo
npm run test:media
```

**DB（只在驗證過的隔離 DB）：** `npm run test:whatsapp-enquiries:db`、`test:staff-notifications:db`、`test:public-performance:db`，以及新增 enum、batch、link management、readiness DB tests。若舊suite限定特定branch不能執行，使用經核實的同等隔離harness並報告原suite未跑，不能改env假裝原branch。

**Browser：** 現有 `npm run test:staff-notifications:e2e` 要求 `PLAYWRIGHT_BASE_URL` 與 `STAFF_HANDOFF_BROWSER_FIXTURE`；先讀fixture schema。新bulk/onboarding規格加入現有Playwright。這些自動測試預設stub provider，不默認真發訊息。

**總 gate：** typecheck/lint/build成功、所有受影響測試通過、關鍵DB tests實際執行、desktop/mobile/keyboard journeys有證據、沒有越權及重複副作用。新增測試須證明行為，不能只assert程式碼包含某字串。純文案用既有tests及人工覆核即可。

**代表性fixture：** canonical A074714↔SYNC；同盤租售；最新withdrawn；缺代理；inactive staff；wrong-channel mapping；expired reference；verified Inbox-only；verified staff phone；outside window template；650 links；60-rowbatch；CSV malicious cell；lost response after commit。

## 7. Migration、回滾與保留的行為

| 變更 | 發佈方法 | 回滾 |
|---|---|---|
| 公開搜尋及CTA | code修復＋staging回歸 | revert code；canonical identity資料不變 |
| 新batch tables／metadata | additive migration，先schema後code；不重寫舊code/token | 關閉新batch入口並回舊UI；保留operation records用於reconcile，不drop有記錄表 |
| Legacy placement backfill | exact-row preview；一次小批；不可確定者標review | 保留原值／operation ID，按批次恢復metadata；不刪歷史link |
| 通知capability／template | 經contract＋staging驗證再按同事啟用 | 使用既有kill switch停dispatch；保留unknown attempts作核對，不一律retry |
| 公開快取 | 先有invalidation及withdrawn回歸 | 關cache／purge；不能回復已下架公開內容 |
| 內容更新 | before/after及來源記錄，保留人工override | 依revision恢復，不能全表reset |

如改動會令已投放link不能解析，優先維持舊schema/read compatibility；短連結code不輪換。回滾的是新寫入能力，不是刪掉審核／通知證據。Production密鑰、phone或private screenshot不得出現在PR描述。

## 8. Codex 完成後的回覆格式

回覆用繁中，先交代已完成與未完成：

1. Current SHA、branch／PR URL、覆蓋的F項。
2. 每個工作包的實際改動與使用者行為差異。
3. Tests：commands、passed/failed/skipped及隔離DB／staging範圍。
4. WhatsApp：recipient是否核實、transport、accepted/delivered/unknown及當次證據；沒有發就寫沒有發。
5. Performance：測量條件與前後數據；不要聲稱未量度的香港p75或百分比。
6. Migration／flags／backfill與rollback；已deploy或僅PR要明確。
7. 只列剩餘真正依賴，例如指定同事、核實端點、模板批准或production執行授權；其他可做部分需先完成。

## 9. 計劃自我核對

- F01–F24 全部對應主責task；無未分派finding。
- 未把audit中的疑似SQL根因、copy失敗或12秒樣本當作無條件已證實結論。
- 不另建CRM／auth／訊息通道，重用public helpers、batch API、bulk selection、team lifecycle、AppImage及provider evidence。
- contracts一致：preview與commit同rowKey；每chunk≤50；preview總rows≤1000；committed／rejected與row結果語義分開。
- 對權限、真實enum、資料撤銷、並行／重試、CSV及發送unknown都有task和測試。
- 本計劃未執行產品修復、migration、部署或外部訊息發送。
