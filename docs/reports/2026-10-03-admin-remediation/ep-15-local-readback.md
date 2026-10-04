# EP-15 原試送恢復及四步設定補驗

程式提交 `f596c9a45f530dfae91924538d241aa9c6e24733`。復用原 StaffMappingWizard／InboxAccountPicker／StaffTestNotificationDialog 與現有server request、preview、job、audit；沒有新 DTO、migration、provider ID或production configuration。

## RED → GREEN

有效RED：1280實際settings route的「提交已commit但回應遺失」情境，關閉視窗後「測試 Inbox 私有備註」仍enabled；新preview會清除原request的session journal。原服務雖可按同一request idempotent replay，但新preview產生新request會失去這層保護。測試要求結果不明時只讀原請求，修改前1 FAIL。

最小修復：初次render先讀原journal；queued／dispatching／unknown及未讀回的request禁止新preview／enqueue。增加「查閱原試送結果」，失敗或未找到仍保留原request並顯示可恢復錯誤，reload不重送。原request有已核實狀態後，仍需另作明確preview／submit才可開始新試送；accepted仍不稱delivered。preview使用既有captured endpointVersion，版本變更時顯示原版本並阻止提交，須重新預覽。

第一輪selector把label加select options視作exact名稱而失敗，屬fixture錯誤，已更正，不計產品RED。新的測試 Window type及prefer-const lint問題也已修正，沒有改產品guard以遷就測試。

## 四尺寸實際路由操作

1440／1280／768／390，各10情境，共40 PASS／0 FAIL／0 SKIP。使用actual `admin.whatsapp-settings`、shell、wizard、picker、endpoint editor、capability badges、test dialog及CSS；Auth/API、flags和provider結果是明確owned synthetic。只在owned loopback接受GET/HEAD，所有其他遠端request封鎖；沒有真發送。

涵蓋：Haze同名不同電郵／分行候選分頁；未核實、denied與expired review均不能save；empty／403／outage Folder分開呈現並可retry；離職同事不在picker；四步save→fresh mapping version readback，save／preview／close的enqueue為0，assignment與optional phone能力分開。unknown response保留request、read outage及reload後可原request恢復；worker unknown新讀回後仍禁止重送；accepted／provider delivery／人工確認／ack各自呈現，人工確認不能補寫provider送達。端點v1→v2保留舊preview並要求重建。

真phone目的地核實、consent／provider window／tenant membership、真Auth及完整管理員／經理流程仍待可寫隔離目標與具體授權；沒有把synthetic已預設endpoint當作已完成正式四步接駁。此處僅manager UI fixture，不能推論8個正式sessions或跨scope Auth已驗。

## 同schema SQL 的獨立讀回

`test:whatsapp-setup:db`由原1至2 PASS／0 SKIP，fresh owned PostgreSQL17全85 migrations。actual Folder/review/mapping save、source版本和audit原驗證保留。新增actual endpoint save→preview→enqueue，在commit後模擬response loss；SQL獨立readByRequest讀原attempt／job／endpointVersion。unknown fixture反覆原request replay，attempt／job／enqueue audit各1；wake只記錄1次mock port、無真worker啟動。另一active manager無法讀原actor的request，改actor replay409；zero EPWA。沒有以mock query全面替代transaction。

本次unknown worker state以owned SQL fixture設定，未證真worker lease/restart或真provider unknown；這些維持既有分層驗收。真正runtime auth在server wrapper另列外部gate；本SQL test用trusted actor object及真staff role rows。

## 驗證與交接

同一source SHA：shared owned UI 88（property28／Ops20／staff40）PASS／0 SKIP；owned setup2、staff notifications Node21＋Bun14 PASS。typecheck、lint、build分開exit0，lint僅3 baseline warnings。前輪的104 owned及102歷史aggregate保留原SHA；本批PR head CI另行核對expanded aggregate，不用預期數當已通過。

兩份CSV只更新相關execution結果，原29 PASS／9 FAIL／22 BLOCKED、22 planned NEW及1400 action IDs不動。TEST-19真手機試送仍BLOCKED；NEW-06／15仍PARTIAL；rendered controls沒有因這40情境自動改成action PASS。此前独立review不延伸至本slice，本批為focused self review及regression evidence。

回退此聚焦app提交可回前一兼容UI；原request/session journal、preview、attempt、job、audit、receipts、outbound intents及人工protected edits保留。未知結果先查原request，不能換ID重發或清除journal當成成功。正式migration/config差異零；local修復READY，正式phone／provider／Auth能力BLOCKED，全產品仍NOT_READY。28Hse維持既有main1/3、本修復正式0/3，沒有部署或監看。
