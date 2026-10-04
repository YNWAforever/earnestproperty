# EP-09/10 — 三分行、offers 與刊登的隔離證據

`test:propertyhk-reconciliation:owned:db`：4 PASS，0 SKIP；兩個新建 owned PostgreSQL17，各套用完整 85 migrations。採集 envelope、scope approval 和網址都是 synthetic fixture，沒有宣稱 Property.hk 真 detail/full 接通。

實際 ingest dry-run 零寫入；持久 ingest/replay 保留前置零 ID：2 advertisements、3 offers、3 properties，售租不同 offer，EPS/EPT/EPW memberships 保留。少 branch、漏 terminal page、缺 detail 或標記 acquisition 403 皆拒絕，不替換 accepted full baseline、不推導撤盤。

第二 fixture 用實際 PNG bytes 經現有媒體驗證和 synthetic owned storage port，兩個有身份證據的 ads 合成一物業；published=1、duplicateCanonical=1、source states=2。獨立 canonical SQL 只一公開結果；replay 不再 fetch/upload，下一次 ingestion 不覆寫公開媒體/描述/身份。未使用 real Blob、Property.hk 或其他網絡。

下一層仍 BLOCKED：真正分行/dt approval、合法 detail/media fixtures、Property.hk 6826616 正向訊息→verified account/scope→enquiry；不以 synthetic 正向刊登代替真來源驗收。跨來源同數字 ID、同名衝突、relist 的既有 identity/parser contract 回歸亦保留，不因測試成功放寬 merge。

回退逐 scope 停 apply，保留 canonical protected edits、accepted baseline 和來源歷史。不可用 index-only 或供應商拒絕推斷 absence。
