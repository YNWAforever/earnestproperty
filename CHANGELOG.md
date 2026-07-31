# CHANGELOG — 客戶批註修訂 (Wang-Ye-27072026)

Point-by-point against `docs/client-feedback/Wang-Ye-27072026.docx`.

**Legend:** ✅ 已完成 · ⏳ 待素材 · ❓ 待客戶確認

Branch `feat/client-revision-2026-07` → PR #30, stacked on PR #29 (which must merge first).
All 14 test suites pass, `npm run build` succeeds, `npx tsc --noEmit` unchanged at its 56-error
baseline.

---

## PHASE 1 — 品牌與全站字串

| 批註                            | 狀態 | 備註                                                                                                                                                                                                              |
| ------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公司logo要大啲                  | ✅   | 40px → 56px mobile (+40%), 60px desktop (+50%), set per breakpoint. `width`/`height` carry the larger size so the header grows without shifting. Footer mark left at 48px — the annotation pointed at the header. |
| 晉誠地產(轉綠色)                | ✅   | Repainted to the approved `#1F7A4D`. See note below — this was larger than it looked.                                                                                                                             |
| 堅盤源 → 全部真盤               | ✅   | Zero residue under `src/`, tests included.                                                                                                                                                                        |
| 十多年 → 廿多年                 | ✅   | Zero residue.                                                                                                                                                                                                     |
| Hero slogan 晉誠地產 ‧ 全部真盤 | ✅   | 晉誠地產 highlighted in brand green. Uses the client's `‧`, not the previous fullwidth `．`.                                                                                                                      |

**The green already on the site was the wrong green.** The shipped palette was derived from
`#6B7A16` — olive/khaki, a different hue family, not a near-miss. Re-deriving only the four brand
tokens would have left sixteen warm-tinted neutrals, a gold `--primary` in dark mode, a gold `--ring`
and a gold `--chart-2` behind. All were rotated onto the new hue.

White on `#1F7A4D` measures **5.32:1**, clearing WCAG AA. Three pairings failed and were fixed rather
than shipped: the hero chip (`bg-gold/20 text-gold` at 3.8:1 — no translucent green reaches AA over
that photograph, so it is a solid pill now at 5.35:1), the `hover:bg-primary/90` alpha hovers
(4.22:1 → 7.69:1 using the deep green), and three gold icons at ~2.2:1.

A pre-existing AA failure was fixed incidentally: the active nav chip was 4.34:1 and is now 4.71:1.

---

## PHASE 2 — Section 排序

| 批註         | 狀態 | 備註                                                                                                                                                                                                     |
| ------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精選筍盤置頂 | ✅   | Featured Listings now sits directly after the Hero, ahead of 深井核心屋苑. Section order only; no component internals touched, every `id`/anchor preserved because the header and footer link into them. |

---

## PHASE 3 — 深井核心屋苑

| 批註                                                   | 狀態 | 備註                                                                                                                                   |
| ------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 加返屋苑相片                                           | ⏳   | 4 of 10 supplied and wired. 6 outstanding — see `TODO-ASSETS.md`.                                                                      |
| 新增 海雲軒、帝華軒、海韻台、縉皇居、龍騰閣            | ✅   | All five added. Every figure is `null`, rendering 「—」. Nothing invented.                                                             |
| units / avgPsf / listingCount 一律 null，UI 顯示 「—」 | ✅   | Fixed a real bug: the card did `(total_units ?? 0).toLocaleString()`, so a missing figure printed a confident 「0 個單位」 and 「$0」. |
| 區塊描述 紮根深井青山公路廿多年…                       | ✅   |                                                                                                                                        |
| Grid 4/2/1 + 查看更多屋苑                              | ✅   | Eight-card preview, client-side expander, no new route or dependency.                                                                  |
| 5 個新屋苑的 slug                                      | ❓   | Romanised, not confirmed. Currently React keys only — the cards do not link, so nothing is committed to a URL yet.                     |
| 帝華軒 / 海韻台 / 龍騰閣 所屬地區                      | ❓   | Left `null` rather than guessed.                                                                                                       |

**海雲軒 and 縉皇居 are 汀九, not 深井.** The corridor registry already lists both among
油柑頭 / 汀九's featured estates. The card hardcoded 「深井 ·」 before the estate name, so adding
them naively would have printed a false location for two real estates.

**The five new estates render as non-linking cards.** They have no detail page, and linking would
ship five thin pages — the SEO problem PR #29 exists to fix.

---

## PHASE 4 — 認識晉誠代理團隊

| 批註                       | 狀態 | 備註                                                  |
| -------------------------- | ---- | ----------------------------------------------------- |
| 加分行及 Title             | ✅   | All 23 carry a real title and branch.                 |
| 名單排列（不按分行 group） | ✅   | The client's order exactly.                           |
| 移除 Michael Wong          | ✅   | 24 − 1 = 23, reconciling exactly with the roster.     |
| Andy Han 職級              | ✅   | 高級客戶經理, confirmed as a typo for 「級客戶經理」. |
| 董事卡置頂並突出           | ✅   | Kenneth Chang, no branch.                             |
| 分行 filter chips          | ✅   |                                                       |
| 姓名首字母 avatar          | ✅   |                                                       |
| WhatsApp / 牌照號碼        | ⏳   | `null` for all 23 — see `TODO-ASSETS.md`.             |

**This was the highest-impact fix in the revision.** Every roster entry had `branch: null`, and both
agent routes did `branch ?? DEFAULT_AGENT_BRANCH.name` where the default is `SITE_BRANCHES[0]` =
麗都分行. The live site therefore stated that all 23 agents work at 麗都分行 — wrong for the 15 based
at 海韻 or 青山公路豪景, and a factual claim about named real people.

Filling the roster alone would **not** have fixed it: `resolveDisplayAgents` is all-or-nothing, so a
published Neon profile with a `NULL` branch would still have rendered 麗都分行. The fallback was
removed from both routes. The phone fallback was kept — routing an enquiry to the main line is a
useful default, whereas claiming someone works somewhere they do not is not the same thing.

---

## PHASE 5 — 關於晉誠地產

| 批註                              | 狀態 | 備註                                                                                                                                                                                                                   |
| --------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主標保留 深井、青山公路物業專家   | ✅   |                                                                                                                                                                                                                        |
| 副標 全部真盤、即時回覆、持牌可靠 | ✅   |                                                                                                                                                                                                                        |
| 正文                              | ✅   |                                                                                                                                                                                                                        |
| 將相片放大                        | ✅   | `h-40`/`h-44` → `h-64 sm:h-72`. Also fixed a latent CLS bug: all three shopfronts declared `width={640} height={480}` while two are portrait 1200×1600, reserving an inverted box. Now per-photo intrinsic dimensions. |
| 麗都舖轉相                        | ⏳   | Replacement photo not supplied.                                                                                                                                                                                        |

---

## PHASE 6 — 地區範圍

| 批註                 | 狀態 | 備註                                                                                                                      |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 三個生活圈           | ✅   | Five segments collapsed to the client's three, copy verbatim.                                                             |
| 生活圈 2 開頭欠句    | ✅   | The docx read 「……..，車位比例高…」; the client supplied both paragraphs on 2026-07-29.                                   |
| 導引句               | ✅   |                                                                                                                           |
| 底部三個地區入口     | ✅   |                                                                                                                           |
| Region whitelist     | ✅   | 深井/青山公路/汀九/青龍頭/油柑頭, enforced at the consumer — the listing API was not touched, per the brief.              |
| 被移除的 route → 301 | ✅   | Retired slugs redirect to a surviving zone and leave the sitemap. A test asserts no URL is both redirected and canonical. |

**The task spec contradicted the client here, and the client was followed.** The spec read
「只保留深井 青山公路 汀九」 as an instruction to cut to two zones and delete 小欖/掃管笏/三聖. The
client's own document says 「分成三個買家容易理解的生活圈」, supplies full copy for 小欖/掃管笏/三聖區
and names it in the guidance sentence. 屯門 appears **zero** times in the client's document — it came
from the spec author. The client confirmed three zones on 2026-07-29.

屯門 remains in the transport descriptions: 「往荃灣、屯門和機場均有路線」 is factual bus-route
information, not district scope, and removing it would make those sentences wrong.

---

## PHASE 7 — 底部 CTA

| 批註                                       | 狀態 | 備註                                  |
| ------------------------------------------ | ---- | ------------------------------------- |
| 準備搵深井 青山公路筍盤？                  | ✅   |                                       |
| 按鈕轉綠                                   | ✅   | Uses the brand token, no hex literal. |
| 保留 WhatsApp-first 及 tracking event 名稱 | ✅   | Event names byte-identical.           |

---

## PHASE 8 — FAQ 空白項

| 批註                                    | 狀態 | 備註                                                                             |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| 三個空的 accordion heading              | ✅   | Not missing copy — a rendering fault. Blank answers were reaching the accordion. |
| FAQPage JSON-LD 不能有空 acceptedAnswer | ✅   | The visible list and the schema now share one filter, so they cannot drift.      |

A shared `renderableFaqs` filter in `src/lib/faq.ts` is wired into all five FAQ surfaces, and both
the rendered list and `mainEntity` gate on the filtered array. The test feeds blank and
whitespace-only answers through the filter rather than grepping source, and separately asserts
nothing valid is over-filtered.

---

## Fixed in passing

Not requested, found while working:

- **`og:image` was a relative hashed path.** Open Graph requires an absolute URL, so homepage share
  cards were broken. Now absolutised against `SITE_URL`.
- **The homepage meta description existed twice** with divergent tails (「Licence C-018613。」 vs
  「持牌代理 C-018613。」). It now reads from the registry once.
- **The estate figure renderer masked missing data as `0`** — see Phase 3.

---

## Known gaps in verification

- **No browser check.** The homepage loader needs Neon credentials and the local `DATABASE_URL` is
  empty, so nothing here was viewed in a running page. Verification was tests, typecheck and build.
  Before/after screenshots are worth taking on the PR preview deployment — the brand repaint, the
  section reorder, the estate grid and the agent cards are the four worth comparing.
- **`tsc --noEmit` reports 56 errors.** All pre-existing (TanStack server-fn generics, Bun test
  typings, un-narrowed nullable DB columns) and none in files this revision touched. The brief asked
  for zero; that is unreachable without unrelated cleanup, so the gate applied was _no new errors_.
