# EarnestProperty Admin Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改善 EarnestProperty 側邊導覽及全部25個後台頁面的對齊，讓管理員和代理能完成有證據可核對的日常工作。

**Architecture:** 延伸現有 `AdminShell`、`AdminToolbar`、Sheet/Dialog 與角色表，把導覽 metadata、頁首及內容寬度契約抽成共用單位；分批遷移現有 routes。後端權限、staff workspace identity、業務 handlers、draft/CAS/receipt 機制沿用，UI 不能自行擴權。

**Tech Stack:** TanStack Start/Router、React19、TypeScript、Tailwind4、shadcn/ui、Neon raw SQL/Auth；Node/Bun/Playwright 依 repo 的 named scripts。

**Spec:** 同包 `01_Scope_and_UX_Spec_zhHK.md`；原始要求及歷史證據來自 `EarnestProperty_Admin_Audit_2026-10-02_zhHK.zip` 的00/01/05/06/07與兩份CSV。

**Executor:** 使用者指定 Codex GPT-6.1 Sol；這是工作交接標籤，不包含模型供應或能力宣稱。

**Baseline:** main `433ab194f9e51c789d89d49216fe2983f2791616`，2026-10-13 HKT 核對。開工時如 main 已改動，先做 T-UX00 差異核對，不把舊方案直接覆蓋新程式。

## Global Constraints

- 本輪是計劃交付；所有任務待開始，新50個UAT案例未執行。repo/live 是否同版未知。
- 先讀目前 checkout 的 AGENTS.md（如有）、CLAUDE.md；本輪 tree 未發現 AGENTS.md。
- 現有框架是 TanStack Start，不改成 Next.js；不手改 `src/routeTree.gen.ts`。
- 不另建第二套後台、不新增無用途的 UI library、不把 UI-only 工作變成 DB migration。
- 所有25個 route templates 都要列出及遷移；不只改首頁或截圖中的頁面。
- `standard=1440px`、`wide=available width`、`form=896px`；gutter 16/24/32px；sidebar 256/72px；desktop breakpoint1024px。
- 已驗證 server role/capability、actor scope、staff identity、receipt-first、unknown-send reconciliation、draft、dirty/CAS 與 protected fields 保持。
- 未知 staff lookup、撤權或身份變更不得顯示之前身份的私人內容。`visibleNavEntries(null)` 現有 fallback 不可被誤解為有讀寫權。
- 只有 server 核實的角色控制業務操作；sidebar 隱藏不代替 server ACL。
- 保留 zh-HK、HKD、HKT、deep links/query、現有首頁公開 chrome 邊界。
- 不向客戶發訊息、不發佈正式內容、不執行正式 migration 或 merge/deploy；先完成可review的程式、隔離驗證及具體 rollout。
- 不改寫10/2原始 PASS/FAIL/BLOCKED；新增 execution 欄／本輪檔案，記錄 SHA、環境、實際結果。

## Review Focus

1. 角色在畫面開着時降權／branch binding 改變；私人內容及晚到回應不殘留。T-UX01/08，SEC-03/04。
2. 390px 長中文、瀏覽器200%放大、短螢幕；頁首不截斷，控制及登出可達。T-UX02/07，NAV-08、LAY-02/08。
3. Editor dirty draft 與手機對話草稿；切頁、收合 sidebar、回覆 timeout 不丟資料或重送。T-UX04/05，AGT-05/07、LAY-07。
4. loading/empty/partial/error/stale 差異；不能以0或全成功掩蓋未能讀取。T-UX03/06，ADM-01/06/09、AGT-12。
5. 搜尋使用中文 IME、query/deep link、詳情返回；focus、篩選及唯一 active nav 正確。T-UX01/03，NAV-04/05、AGT-03。

## File Structure

| 檔案 | 決策與責任 |
|---|---|
| 修改 `src/components/admin/AdminShell.tsx` | 保留 Auth/checklist/attention/sign-out 管理；增加 sidebar 收合與唯一 content wrapper，委派 navigation/header |
| 新增 `src/components/admin/admin-navigation.ts` | `ADMIN_NAV_GROUPS` labels/order/URLs/activeExact；不重複寫角色規則 |
| 新增 `src/components/admin/AdminNavigation.tsx` | desktop/mobile 共用連結、badge、accessible name、collapsed presentation；從 `visibleNavEntries` 篩選 |
| 修改 `src/components/admin/admin-nav-roles.ts` 與 test | 角色 authoritative list 保留；更新測試讀取 metadata 的位置，增加頁內連結 parity |
| 新增 `src/components/admin/AdminPageHeader.tsx` | 唯一 h1、breadcrumb、description、actions；不持有業務狀態 |
| 修改 `src/components/admin/AdminToolbar.tsx` | 保留 filters/actions API，增加 optional summary/disabled；mobile wrap/min-w-0，fieldset disabled 保護保留 |
| 修改 `src/styles.css` | 只在 admin 範圍加入 layout tokens/utilities；不破壞公開頁 |
| 修改全部 `src/routes/admin*.tsx` | 按 route coverage 的 variant/主要操作/breadcrumb 遷移；所有 loading/denied 分支同樣處理 |
| 按需修改既有編輯／工作區元件 | PropertyForm、TransactionForm、AdminPropertyWorkspace、AgentProfileForm、AdminEstateEditorForm、AdminDetailPanel；只處理真實幾何／互動問題 |
| 新增 `e2e/admin-navigation.spec.ts`、`e2e/admin-page-layout.spec.ts` | 真實 React components/routes + synthetic auth/API 的 owned UI 幾何、導航驗收 |
| 新增 `scripts/browser-fixtures/build-admin-layout.mjs` 與 `scripts/browser-fixtures/admin-layout/{index.html,admin-layout.tsx,synthetic-api.ts}` | 延用現有 Vite owned fixture 模式；實際 routes，不另寫假的 admin UI |
| 新增 `scripts/browser-fixtures/admin-layout/route-cases.ts` | 25 routes、fixture id、width variant、allowed roles、狀態清單；與 CSV 同步 |
| 修改 `playwright.admin-owned.config.ts`、`playwright.config.ts`、`package.json` | owned testMatch、remote-ignore、新 named scripts；`src/test-wiring.test.mjs` 必須通過 |
| 新增 repo 文件 `docs/superpowers/plans/2026-10-13-admin-usability.md`、`docs/specs/2026-10-13-admin-usability.md` | 實作者將本 plan/spec 複製入 repo，連同新CSV/evidence報告 |

Repo 路徑均相對於 checkout 根；「新增」是本計劃的預定檔案，並不聲稱已存在。

## Interfaces

```ts
// AdminShell.tsx — existing props remain compatible.
export type AdminContentWidth = "standard" | "wide" | "form";
// Add contentWidth?: AdminContentWidth (default "standard").
// Header, toolbar and body share the same width wrapper.

// admin-navigation.ts — keep /admin URL literals and existing role source.
export type AdminNavItem = {
  to: string; label: string; icon: string; activeExact: boolean;
  attention?: "leads" | "inbox";
};
export type AdminNavGroup = { id: string; label: string; items: readonly AdminNavItem[] };
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[];
// icon names map to existing lucide imports in AdminNavigation.tsx.

// AdminNavigation.tsx — types reused from admin-data.types.ts.
type AdminNavigationProps = {
  roles: readonly StaffAccessRole[] | null;
  attention: AdminAttentionCounts | null;
  collapsed?: boolean;
  onNavigate?: () => void;
};
export function AdminNavigation(props: AdminNavigationProps): React.ReactElement;

// AdminPageHeader.tsx — accepts the current Shell header slots.
type AdminPageHeaderProps = {
  title: string; description: string;
  breadcrumb?: React.ReactNode; actions?: React.ReactNode;
};
export function AdminPageHeader(props: AdminPageHeaderProps): React.ReactElement;

// AdminToolbar.tsx — current call sites keep compiling.
type AdminToolbarProps = {
  filters: React.ReactNode; actions?: React.ReactNode;
  summary?: React.ReactNode; disabled?: boolean;
};
export function AdminToolbar(props: AdminToolbarProps): React.ReactElement;
```

Route type safety must use the existing TanStack generated route types at the Link boundary; do not suppress arbitrary unknown URLs with a broad `as any`. No new server endpoint is required by these interfaces.

## T-UX00 — 核對基準及完成追蹤表（P1 gate，S）

**Files:** 讀 CLAUDE.md、原ZIP、當前上述產品檔案；讀 `docs/reports/2026-10-03-admin-remediation/` 中 EP-12–20 及最新 reconciliation。新增本次 spec/plan/evidence 文件。

**Consumes:** 原 F01–08、RPK01–07、UC01–20；本包50案例與25路由。
**Produces:** current SHA、worktree狀態、source/live版號差異、角色/操作inventory、舊finding reconciliation。

- [ ] 記錄 `git status --short`、`git rev-parse HEAD`、分支，讀規則；保留未提交工作。若最新main有變，逐檔比對再更新本計劃。
- [ ] 核對 ZIP hash 和 CSV 的 record_kind/category；保留68業務動作與1,332候選的區別，舊測試結果不覆寫。
- [ ] 核對所有25 route、17 nav destinations、各首個read及write的server guard；記錄feature flags，分開 role 和 capability。
- [ ] 如已有授權登入，觀察兩站sidebar正常/收合/active/mobile及三類內頁；沒有登入則保留 UX-F05 blocked，按本spec先做可獨立實作。
- [ ] 在修改前執行相關 named scripts 建立 baseline；任何原有失敗記錄原SHA/環境。不要用刪測試解決。
- [ ] Commit 文件：`docs(admin): record current usability baseline`。

驗收：25路由與17導覽分母明確；新版原稽核問題逐項有狀態；沒有未授權production操作。回退：只回退新增文件。

## T-UX01 — Sidebar 資訊架構、收合及角色一致（P2，M；依賴00）

**Files:** AdminShell、admin-nav-roles及test；新增admin-navigation、AdminNavigation；新增navigation spec；fixture建置隨此任務建立最小shell/實際總覽版本。
**Consumes:** 現有staff session、attention、角色函式。
**Produces:** spec三組選單及可收合desktop／手機Sheet；提供後續頁面一致導航。

- [ ] 先擴充 `admin-nav-roles.test.mjs`，斷言 metadata無重複、17入口完整、agent恰好6入口、viewer只有operations、empty roles無入口、loading/null語義保留。替換只搜尋AdminShell字串的舊斷言，不刪server guard比對。
- [ ] 在 `admin-navigation.spec.ts` 加入 NAV-01–08 的互動斷言，同步建立named script及owned testMatch/default testIgnore；先跑到預期 RED（沒有收合控制或分組順序不符），保存真正失敗原因。
- [ ] 將AdminNav抽成共用元件，依spec順序分組；改接收設定的顯示名稱。Collapse button提供`aria-expanded`與明確名稱；localStorage失敗不阻斷使用。
- [ ] 全部active判斷忽略search值，保留正確exact/segment prefix；手機完成導航關drawer，保留dialog focus行為。移動私有頁header時不得越過staffReady gate。
- [ ] 執行 `node --test src/components/admin/admin-nav-roles.test.mjs` 及新增 `npm run test:admin-navigation:ui`，期待0 failed；同步修正受文案變動影響的實際日常suite。
- [ ] Commit：`feat(admin): unify role-aware collapsible navigation`。

驗收：NAV-01–08、SEC-01；badge/keyboard/checklist仍可用。回退：單獨回退presentation commit，保留原角色／server guards。

## T-UX02 — 共用頁首及版面契約（P2，M；依賴01）

**Files:** AdminShell、AdminToolbar、styles.css；新增AdminPageHeader；新增layout spec/route-cases，先覆蓋overview、leads、new transaction三種型態。
**Consumes:** AdminNavigation、原Shell slots。
**Produces:** `contentWidth`三種variant、共用header/toolbar、穩定幾何測試選點。

- [ ] 在layout spec先加入 LAY-01/02/03/08/09，同步建立layout named script及config wiring；390/768/1280/1440px，header/toolbar/body左外緣差≤1CSS px；document無橫向overflow；200%文字放大不遮控件。
- [ ] 增加 `data-admin-content/header/toolbar/body/table-region` 等少量測試選點；以實際bounding boxes與互動驗收，不以class字串等於spec當幾何證據。
- [ ] 增加AdminPageHeader及width variants。移除Shell重複gutter，讓寬度wrapper包含header及body；h1可換行，actions自然換行；root已存在main，只加跳至內容target。
- [ ] 延伸AdminToolbar而不改舊props用途；filters能縮排／wrap，disabled仍使用fieldset或等效保護，移動按鈕時保留form ownership/type。
- [ ] 加入手機safe-area與可見focus；不要全局hidden overflow。跑 `npm run test:admin-layout:ui`、`npm run test:layout`、`npm run test:styles` 及typecheck，期待無新增失敗。
- [ ] Commit：`refactor(admin): standardize page header and content alignment`。

驗收：三種實際route先通過幾何及互動；公開layout無回歸。回退：還原layout元件／admin樣式，沒有schema rollback。

## T-UX03 — 日常清單頁與頁內權限入口（P2，M；依賴02）

**Files:** admin.index、admin.leads、admin.leads_.command-center、admin.listings、admin.transactions；AdminPropertyTable/BulkActions按需。
**Consumes:** header/toolbar/standard width；現有workspace identity、filter URL、mutation handlers。
**Produces:** 每日工作五頁一致操作列；修復UX-F03。

- [ ] 先為代理開樓盤頁加入回歸：不得渲染到 `/admin/property-sync` 的連結；admin/manager可見，直接URL仍拒絕無權角色。確認舊碼失敗。
- [ ] 五頁遷移spec版面；把「新增」等頁級主要操作放header actions，bulk操作留選取列，filter apply留filter旁。移動fieldset內容時保留bulkBusy及防重複提交。
- [ ] 保留總覽同scope/as-of卡片連結、目前搜尋參數與IME debounce。不要為「今日待辦」新增沒有後端計數的假卡片。
- [ ] 擴展現有daily-work/property-maintenance suite，跑 ADM-01/02/04/06、AGT-01/02/03/08/09；write以獨立reload及版本讀回核對，不只toast。
- [ ] 跑 `npm run test:admin-daily-work:ui`、`npm run test:property-maintenance:ui`、nav及layout suites；相關Node/Bun tests按檔案變動選取。
- [ ] Commit：`fix(admin): align daily lists and authorized shortcuts`。

驗收：filter→detail→返回保持scope；空白/錯誤不同；agent捷徑不通往無權頁；loading分支也採共用shell。回退不清草稿／選取資料。

## T-UX04 — 全部新增／編輯頁（P2，M；依賴02）

**Files:** listings_.new/$id、transactions_.new/$id、agents_.new/$id、estates_.new/$id；PropertyForm、TransactionForm、AgentProfileForm、AdminEstateEditorForm、AdminPropertyWorkspace按需。
**Consumes:** form/standard variant、header breadcrumb、既有form及dirty guards。
**Produces:** 全8個editor入口完整對齊及返回路徑。

- [ ] 對新增及編輯各類型加入 LAY-04/05/07，先重現缺breadcrumb、長validation溢出或操作列不可達；已有通過行為維持回歸。
- [ ] 七個短／一般editor使用form896；樓盤管理 `$id` 的複合工作區使用standard1440。移除各頁零散max-w，不刪dialog自身有業務需要的max-width。
- [ ] 所有editor加「後台→模組→新增／編輯」breadcrumb及返回清單；同一頁只保留一套submit ownership，不新建獨立save state。不要用固定高度截斷表單。
- [ ] invalid price、missing required、upload failure、stale409、dirty cancel、既有圖片排序逐案驗收；必要操作sticky時確認200%放大及手機鍵盤不遮輸入。
- [ ] 跑 `npm run test:admin-leave-guards:ui`、`npm run test:property-maintenance:ui`、`npm run test:transactions`（DB部分需隔離target）及新增layout；記錄不能跑的環境依賴。
- [ ] Commit：`refactor(admin): align property transaction agent and estate editors`。

驗收：8頁都在coverage；儲存後scope/record/version正確。表單UI回退不能回退server CAS或已提交資料。

## T-UX05 — WhatsApp 代理工作區（P2，M；依賴02/03）

**Files:** admin.whatsapp、AdminDetailPanel及有實際問題的whatsapp子元件；既有admin-whatsapp-mobile.spec。
**Consumes:** wide variant、既有conversation/draft/assignment/outbound intent狀態。
**Produces:** sidebar縮放與小螢幕下仍可完成接手、草稿、備註及回覆。

- [ ] 先擴展 AGT-04–07/10/12、LAY-06；desktop三區／兩區現有行為、手機列表→對話→返回、長文字、未知送出均有斷言。
- [ ] route改wide，調整面板min-width與scroll ownership；recipient、conversation context、composer及送出狀態不可被layout遮住。不得新建第二份draft store。
- [ ] drawer/sidebar收合不unmount當前表單或清draft；A→B→A各自草稿與selection不混；輪詢不能搶焦點或跳到訊息底部干擾閱讀。
- [ ] 保留「客戶回覆」與「內部備註」語義及不同backend路徑；unknown只查原intent，expired window維持原限制；AI套用只到draft。
- [ ] 跑 `npm run test:whatsapp-mobile:ui`、`npm run test:whatsapp-safety:ui`、nav/layout及受影響的no-link/woztell suite。Native手機IME/虛擬鍵盤另做真裝置UAT，Playwright viewport不冒充鍵盤測試。
- [ ] Commit：`fix(admin): preserve inbox workflows across responsive layouts`。

驗收：零錯recipient、零重送、draft保留、provider stub外無網路副作用。回退只presentation，不重放outbound effects。

## T-UX06 — 管理、推廣及設定內頁（P2，M；依賴02）

**Files:** admin.analytics/blasts/cms/estates/segments/whatsapp-links/whatsapp-settings/team/agents/property-sync/operations；對應子元件按需。
**Consumes:** standard width、共用header/toolbar；既有capability及technical details元件。
**Produces:** 其餘11頁完整遷移；management workflows保持。

- [ ] 每頁先在route-cases指定normal、empty、error及長內容fixture；CMS各tab及主要editor dialog、operations各role tab另列operation rows。
- [ ] 將主要頁級動作放header，其餘篩選／tab/preview/選取行維持業務位置。analytics日期form保留submit與最多90日規則；team/admin專屬寫入不因新header外露。
- [ ] 設定用業務名稱和readiness，沿用picker／wizard；系統ID診斷保持admin-only。sync failed/partial顯示最後成功時間及可行下一步，未知結果查原run。
- [ ] 驗收 ADM-07–12、SEC-02/06/07/08；campaign preview、consent排除、CMS草稿/發布、下載CSV及bulk retry不被布局改動破壞。
- [ ] 跑受影響named suites：staff-setup、property-sync:recovery、operations、admin-campaign-review、admin-performance、admin-link-bulk；不是每次無差別跑所有113組。
- [ ] Commit：`refactor(admin): align management and settings pages`。

驗收：25 route全部完成variant移轉，dialog/tab/action明確記錄；technical detail不泄露給agent。回退逐模組commit，不變更production flags。

## T-UX07 — 全頁面幾何與互動覆蓋（P2 gate，M；依賴03/04/05/06）

**Files:** admin-layout fixture/route-cases、兩個新spec、package/config及本包CSV的repo副本。
**Consumes:** 25真實route與全部layout primitives。
**Produces:** 100個admin viewport instances與角色適用子集的本輪自動化結果；不宣稱真Auth。

- [ ] 逐頁接入實際route/component及型別相符的synthetic read資料，重用現有fixture module；不能只用共用Shell加假的div替代內頁。fixture拒絕外部origin及未知write。
- [ ] route-cases列出25路由、dynamic fixture IDs、contentWidth和state。CLI新增 `test:admin-navigation:ui`、`test:admin-layout:ui`；兩個spec加入owned config及default config testIgnore，讓remote run不能誤跑owned測試。
- [ ] 以390/768/1280/1440×25跑100個normal-state幾何實例；edge states依50案例定義另跑。agent可讀的10個頁面模板（含listing/transaction editors）補角色畫面；viewer驗operations，manager補角色特有操作。
- [ ] LAY-01–10斷言必含：外緣±1px、主頁無横scroll、toolbar不疊字、長title可讀、table區可scroll、modal/footer可達、無重複h1/巢狀main、空/失敗狀態與baseline對齊。
- [ ] 每次結果記錄route/role/state/viewport/SHA/result/evidence，保留未執行/失敗；改名後修正現有用accessible name定位的tests，不放寬斷言來通過。
- [ ] 執行 `node --test src/test-wiring.test.mjs`、new scripts；Commit：`test(admin): cover every page layout and navigation state`。

驗收：100/100適用normal layout實例有結果；FAIL/BLOCKED不能省略。既有synthetic suite只證明UI契約，不當資料或授權E2E。

## T-UX08 — Admin／Agent 日常與真權限驗收（P1 gate，M；依賴07）

**Files:** 50案例CSV、role-route execution CSV、測試證據及既有owned PostgreSQL/golden journey helpers；按需求新增最小可重跑測試。
**Consumes:** 隔離完整app、disposable Postgres、正常auth流程的測試職員帳戶／session、隔離provider stub。
**Produces:** UI→正常server fn→DB獨立readback的daily workflows及負面ACL結果。

- [ ] 重用 `scripts/acceptance/owned-postgres-test.mjs`／`admin-golden-journeys.test.mjs` 的DB/actor準備，核對schema及target ownership。禁止以production URL跑mutation；沒有可用目標標blocked。
- [ ] 執行CSV的ADM-01–12、AGT-01–12及SEC-01–08；所有寫入回到原角色重新讀回，保存before/after revision或receipt，清理僅本次fixture。
- [ ] 25 route×admin/manager/agent/viewer建立100組role-route預期與結果。Sidebar可見、頁面read及每個write capability分開；正向只用授權record，負向包括他人id、分行、直接URL、直接API。
- [ ] 撤權／branch變更時測晚到response與in-flight mutation；401/403不殘留私人header、record、selection、badge；manager不能透過team頁改角色，viewer不能寫入。
- [ ] 真provider可選canary與本地stub分欄；沒有指定test recipient/授權不送；真手機IME與HKWTIA視覺比對各自blocked時不擋其他獨立案例，但不標全驗收。
- [ ] Commit去識別文字結果：`test(admin): record role-based daily workflow acceptance`。

驗收：核心admin/agent任務有同版本實證；權限負面測試0意外寫入；blocked清楚列最低補充。回退：清理run標記的隔離資料，不刪正式history。

## T-UX09 — Review、交付及 rollout（P1 gate，S；依賴08）

**Files:** PR diff、route/test/traceability CSV、本輪readout/rollback。
**Consumes:** 所有本輪同SHA證據。
**Produces:** 可review分批PR與明確release建議，不自動merge/deploy。

- [ ] 執行 `npm run typecheck`、`npm run lint`、`npm run build`；build需要repo要求的contact env，缺少便記blocked。build通過不替代typecheck。
- [ ] 檢查更動的公開chrome和CSS scope；完成selected meaningful regressions，不為UI包啟動無關正式同步、embedding或paid model測試。
- [ ] 更新每個task和case的actual、evidence、SHA、env；確認原finding沒有被無條件關閉、所有新增高優先問題均有task。
- [ ] 按三批準備review：A共用導覽/版面（01/02）；B全部routes（03–06）；C完整acceptance與readout（07/08）。保持可独立review的commits，PR description寫原因、行為、驗證及限制。
- [ ] 提供preview供admin和agent核對。只在具體發布授權後部署；部署後確認真正版本、驗收兩角色基本流程。回退沿用既有deployment版本機制，無新增DB migration；若是既有權限修復不得回退到漏洞版本。

Done：程式完成≠正式已驗收。若無真登入／DB/provider證據，狀態是待驗收或受阻，最終報告不可寫「所有功能通過」。

## 驗證命令與測試契約

下列兩個script是**本計劃新增**，開工前不存在：

```json
{
  "test:admin-navigation:ui": "playwright test --config playwright.admin-owned.config.ts e2e/admin-navigation.spec.ts",
  "test:admin-layout:ui": "playwright test --config playwright.admin-owned.config.ts e2e/admin-page-layout.spec.ts"
}
```

幾何核心斷言示例（以fixture內真實元素定位；先確保box存在）：

```ts
expect(Math.abs(headerBox.x - bodyBox.x)).toBeLessThanOrEqual(1);
expect(Math.abs(toolbarBox.x - bodyBox.x)).toBeLessThanOrEqual(1);
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
```

每個task以行為測試為主，簡單可回復文案／spacing不新增鏡像implementation的單元測試。不要把geometry範例當完整UAT；權限要有server denial和零寫入、草稿要有切換/恢復、保存要有讀回、發送要有原intent核對。

## 第一批可立即執行與交接

先做 T-UX00→01→02：核對main、抽出共用navigation、建立sidebar收合及共用版面。其後按03→04→05→06完成全部頁面，再做07→08→09。預估S/M是難度／不確定性，不承諾日數；最大外部依賴是真職員登入、HKWTIA參考畫面及隔離全鏈環境。

完整案例見 `03_Admin_Agent_UAT.csv`（50個獨立案例）；routes見 `04_Route_Coverage.csv`（25模板）；任務追溯見 `05_Task_Traceability.csv`（10任務）。全部初始not-tested／待開始。本輪只校驗文件完整性，不聲稱產品測試通過。
