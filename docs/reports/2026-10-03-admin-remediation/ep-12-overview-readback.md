# EP-12 — scoped overview與同filter讀回

最新main已保留grouped nav、safe return、server roles及staff session處理。本輪不更換auth provider。

新重現：`getAdminOverview()`沒有actor，open lead／conversation count取全公司；卡片連向預設all列表。owned85 schema中agent甲有1筆open＋1筆closed，agent乙有2筆open。甲總覽錯顯3；`stage=open`原列表取0。三個葉測試RED。

最小修正：從 `requireStaff` 傳actor；overview共用 `readAdminPage` 的open/contacts/conversation totals與scope。新增open lead集合filter，不造新的lead_stage enum。未授權campaign count為null。client用 same-filter URL；scope＋香港時間as-of；source失敗標error保留last success，401/403清舊值；identity/request epoch丟棄late reads。

GREEN：owned4/4，真server SQL＋同filter列表＋獨立SQL。實際admin.index/leads路由在390/768/1280/1440各驗三項：card2→list2→reload同filter、read failure不當0、permission loss清舊count，12/12包含在107browser suite。Auth/API是synthetic；零remote/mutation HTTP，不能替代真登入續期或8 sessions。

publicProperties/publicOffers仍明示全站公開資料，沒有稱為agent自己盤數；完整inventory/team filter、role/flag action reconciliation和正式auth expiry/revocation仍待驗，EP-12／NEW-12保持PARTIAL。共用分頁／command-center／team既有測試全部通過。
