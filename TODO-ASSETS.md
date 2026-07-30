# TODO-ASSETS — 仍需客戶提供

Everything below blocks a client annotation that is otherwise code-complete. Each item names the
exact file that is waiting for it, so dropping the asset in is a small, contained change.

Last updated: 2026-07-30. Source: `docs/client-feedback/Wang-Ye-27072026.docx`.

---

## 1. 屋苑相片 ×6

Four of the ten estate cards have photos. `docs/client-feedback/屋苑相/` supplied 碧堤半島, 海韻花園,
麗都花園 and 浪翠園; those are normalised and live in `public/estates/`.

**Still needed — 16:9 or larger, landscape:**

| 屋苑     | Card slug          | Blocking                                                     |
| -------- | ------------------ | ------------------------------------------------------------ |
| 豪景花園 | `hong-kong-garden` | `src/content/core-estates.ts`, `src/content/estate-pages.ts` |
| 海雲軒   | `hoi-wan-hin`      | `src/content/core-estates.ts`                                |
| 帝華軒   | `tai-wah-hin`      | `src/content/core-estates.ts`                                |
| 海韻台   | `hoi-wan-toi`      | `src/content/core-estates.ts`                                |
| 縉皇居   | `chun-wong-kui`    | `src/content/core-estates.ts`                                |
| 龍騰閣   | `lung-tang-kok`    | `src/content/core-estates.ts`                                |

Cards without a photo fall back to a brand-green gradient, so nothing is broken — they are just
plainer than the four with photography.

**Note on the supplied files:** they arrived as `.JPG` / `.jpeg` at 3–4.6 MB each. Vercel's
filesystem is case-sensitive, so an uppercase extension 404s in production; all four were renamed to
lowercase `.jpg` and downscaled to 120–360 KB. Please send future photos as landscape JPEG under
~500 KB.

**浪翠園 needs a better original.** The supplied file is 600×357 and captioned 三期 only — it is
below the density the card wants and it depicts one phase rather than the estate. A larger
full-estate photo would be better.

---

## 2. 麗都分行 新舖面相 ×1

Annotation 「麗都舖轉相」 (docx p40). The original photo still ships.

Blocking: `src/config/site-branches.js` → `photo: "/branches/lido.jpg"`

The three shopfront photos are not all the same orientation, so please note the dimensions when
sending — each photo's intrinsic width/height is declared in code to prevent layout shift.

---

## 3. 屋苑資料 — 5 個新屋苑

海雲軒, 帝華軒, 海韻台, 縉皇居, 龍騰閣 were added with **no figures at all**. Their cards show 「—」
for 單位數目, 平均實呎 and 最新放盤. Nothing was invented.

Needed per estate: 總單位數, and confirmation of whether the estate should get its own detail page.

**Three districts are unknown.** 海雲軒 and 縉皇居 were placed in 汀九 because
`src/content/castle-peak-road.ts` already lists them among 油柑頭 / 汀九's featured estates. But
帝華軒, 海韻台 and 龍騰閣 have no reference anywhere in the codebase and are currently `null` rather
than being assumed to sit in 深井. 海韻台 in particular should not be assumed to follow 海韻花園
just because the names share 海韻.

**Slugs need confirming before any of these gets a URL.** The romanised slugs above were derived,
not supplied. They are currently React keys only — the five new cards do not link anywhere, because
linking would ship five pages with no content. Once a slug becomes a URL it is permanent.

---

## 4. 代理資料 — WhatsApp 號碼與牌照號碼

All 23 agents render with name, title and branch. `whatsapp` and `licenceNo` are `null` for every
one of them.

Blocking: `src/config/site-team.ts`

`docs/client-feedback/Namecard/` contains a card for each agent and very likely holds this data, but
transcribing 23 people's personal contact details out of images is a decision for the client to make
explicitly — it has deliberately not been done. A spreadsheet or plain-text list is preferred.

Two roster notes:

- **Kelvin Wu** has a QR code in `docs/client-feedback/QR CODE/` but no namecard, no headshot, and no
  roster entry. Probably stale — please confirm.
- **Andy Han** is spelled `Han` on the roster but `HAH` on his namecard, his QR code, and in the repo
  (`slug: "andy-hah"`, photo filename). The display name follows the roster; the asset filenames were
  left alone. Say which spelling is correct and the assets can be renamed.

---

## Resolved since the original brief

These were open when the revision started and are now closed:

- ~~深井 / 青山公路 生活圈 描述句~~ — the docx left it as 「……..，車位比例高，租售價錢十分相宜」; the
  client supplied both paragraphs on 2026-07-29.
- ~~Andy Han 職級~~ — the docx read 「級客戶經理」; confirmed as a typo for 高級客戶經理.
- ~~Michael Wong~~ — had a namecard and was live on the site but absent from the roster; the client
  confirmed removal.
- ~~FAQ 三題內容~~ — the three empty accordion headings were not missing content. They were a
  rendering fault: blank answers were reaching the accordion and the FAQPage schema. A shared filter
  now drops them, so no new copy is owed.
- ~~23 位代理相片~~ — all 23 headshots are in the repo.
