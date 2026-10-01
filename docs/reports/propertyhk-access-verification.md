# Property.hk 存取核實（2026-10-01）

| 分行 | 入口 / 第一頁 | ID scope / 真實 parser | 匯入 / 發佈 | 結果 |
|---|---|---|---|---|
| EPS 麗都花園 | 原 SID 入口未提供可核實完整 URL；p=9 不能作全量；dt=NTW 語義未核實 | 未核實 | 停用 | BLOCKED_EXTERNAL |
| EPT 青龍頭村 | 原 SID 入口未提供可核實完整 URL；dt=NTM 是否排除其他區域未核實 | 未核實 | 停用 | BLOCKED_EXTERNAL |
| EPW 海韻花園 | 原 SID 入口未提供可核實完整 URL；dt=NTW 語義未核實 | 未核實 | 停用 | BLOCKED_EXTERNAL |

- 檢查既有 worker、範例配置、deployment/README、庫內 audit、可用 connector；未找到晉誠已獲批准 feed/export 或完整三分行入口。既有 generic directory 並非分行清單，不能刪 SID 推測入口。
- 本次一次普通 HTTPS 詳情讀取：`https://www.property.hk/asking_detail/6826616.html`，2026-10-01T05:04:36.912Z，HTTP403，驗證頁1647bytes，回應 SHA256 dc85018fa4a68caed0b2f9c26d91cbcdfa02ab4869b39202a6f344d8c609ca5c。沒有重試挑戰、代理、更改身份或取得 challenge cookies。
- 官方 [服務背景](https://www.property.hk/profile.php) 可讀；其銀行估價 API 描述不是晉誠 inventory feed 已存在／已授權的證明。未聯絡供應商、未聲稱取得權限。
- 保留 HTTP transport；目前無證據要求 JS/browser、Crawl4AI、固定 IP 或新 adapter。生產 policy/source links 都沒有 Property.hk；未作配置／DB 變更。
- 範例 publishEnabled=false、access_verified=false、id_scope_verified=false；branch URLs/selectors/ID scope 保持 null，absence 始終 false。Synthetic fixture 只驗完整性邏輯，不升級為正式 selector。

## 最小外部接駁資料

由有權營運者透過受管理配置提供：供應商支援的完整三分行第一頁 URL（保留必要固定 identity）、或正式 feed/export；公司／牌照驗證；可用範圍及配額；pagination/終頁／空頁語義；global/branch ID scope；售租及撤盤語義、更新時間；合法圖片 hosts/rights。若 SID 為 credential，僅放受管理 secret；若公開固定 agent identity，仍須真實樣本核實。无需在聊天貼 secret。

取得 sale/rent/dual-offer/空盤/終頁/明示撤盤的合法樣本後才核實 parser、first baseline 和 server policy。三行3/3完整才接受既有合併scope，首次 absence 關閉。28Hse及後台工作繼續。
