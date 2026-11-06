# Live public/source blog inventory — 2026-11-05

**Public/source inventory: DIRECTLY_VERIFIED. Database inventory/reconciliation: BLOCKED / UNKNOWN. No production changes, push, merge, deployment, SQL, environment-file access, or private-draft collection.**

Final public observation window: 2026-11-05T06:53:02.556Z through 2026-11-05T06:53:05.575Z. Provider observation: 2026-11-05T06:52:55.397Z. These are bounded point-in-time observations, not an atomic database snapshot or release approval.

## Target and source association

Read-only Vercel `get_deployment` for `www.earnestproperty.com` reconfirmed production deployment `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5`, READY, project `prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5`, branch `main`, source SHA `8b49d0a21c867c401c4d41db393e43c8db76a74d`. The domain appears in the deployment aliases. This independently refreshes the public-domain/source identity from [live-target.md](live-target.md); database endpoint/database binding remains unproven.

The full, unfiltered `blogArticles` export was materialized from that exact local Git commit, including its complete 13-file relative import closure. Every saved source file was compared with its Git blob ID and SHA-256. No current working-tree registry file, publication-filtered export, or historical public snapshot was substituted. Full article fields, sections, links, comparison references and publication dates remain in the ignored registry/source artifacts. Two registry records omit publication dates; zero are future-dated or invalid at this observation time. These are source facts, not DB publication-state findings.

## Counts and exact URL comparison

| Observation | Count |
| --- | --- |
| HTTP 200 responses in final capture | 9 |
| Presentation pages (main + all categories) | 8 |
| Discovered category keys | 7 |
| Unfiltered registry records / unique slugs | 112 / 112 |
| All sitemap URLs | 765 |
| Sitemap `/blog/…` URLs / unique URLs | 113 / 113 |
| Excluded policy URLs | 1 |
| Article URLs after policy exclusion | 112 |
| Exact registry-to-sitemap article URL matches | 112 |
| Unique article links across captured presentation pages | 112 |
| Public-only article URLs (sitemap or page links; missing source) | 0 |
| Source-only registry URLs (missing sitemap) | 0 |
| Page article links missing sitemap | 0 |
| Duplicate registry slugs / duplicate sitemap blog URLs | 0 / 0 |
| Live DB articles / revisions / private drafts | UNKNOWN / UNKNOWN / UNKNOWN |

Comparison uses exact absolute URLs, without slug renaming or case/query normalization. The 112 non-policy sitemap URLs and 112 registry URLs are equal as sets. Public-only and source-only URL lists are empty in this capture; the per-record association file retains URL, slug, category, source SHA, content fingerprint, sitemap membership and linking presentation pages. Main/category GETs expose links; individual article responses and rendered bodies were not crawled. Source completeness does not prove article-runtime parity or dynamic estate-table values.

## Categories and presentation

Query parameter name `category` and each decoded value are preserved exactly; links below retain the encoded query. Rows follow the current main blog navigation order, which matches the deployed `BLOG_CATEGORIES` order. Registry category counts are source-only counts. Page links include the shared featured buying-guide link and must not be interpreted as category membership or DB counts.

| Exact category key | Exact captured URL | Registry records | Unique page article links | HTTP |
| --- | --- | --- | --- | --- |
| `買樓攻略` | [買樓攻略](https://www.earnestproperty.com/blog?category=%E8%B2%B7%E6%A8%93%E6%94%BB%E7%95%A5) | 1 | 1 | 200 |
| `租樓攻略` | [租樓攻略](https://www.earnestproperty.com/blog?category=%E7%A7%9F%E6%A8%93%E6%94%BB%E7%95%A5) | 0 | 1 | 200 |
| `屋苑開箱` | [屋苑開箱](https://www.earnestproperty.com/blog?category=%E5%B1%8B%E8%8B%91%E9%96%8B%E7%AE%B1) | 110 | 111 | 200 |
| `屋苑比較` | [屋苑比較](https://www.earnestproperty.com/blog?category=%E5%B1%8B%E8%8B%91%E6%AF%94%E8%BC%83) | 1 | 2 | 200 |
| `成交分析` | [成交分析](https://www.earnestproperty.com/blog?category=%E6%88%90%E4%BA%A4%E5%88%86%E6%9E%90) | 0 | 1 | 200 |
| `社區生活` | [社區生活](https://www.earnestproperty.com/blog?category=%E7%A4%BE%E5%8D%80%E7%94%9F%E6%B4%BB) | 0 | 1 | 200 |
| `市場評論` | [市場評論](https://www.earnestproperty.com/blog?category=%E5%B8%82%E5%A0%B4%E8%A9%95%E8%AB%96) | 0 | 1 | 200 |

All eight pages have canonical `https://www.earnestproperty.com/blog`. Canonical query removal is observed behavior; requested category URLs remain distinct in the SourceBundle.

Observed shared public copy on all eight pages:

- Eyebrow: 市場分析 Blog
- H1: 深井 青山公路 汀九樓市分析
- Introduction: 整理屋苑比較、交通校網、成交走勢同最新放盤觀察，幫你更快判斷深井、青山公路及汀九樓市。

| Scope | Observed title | Observed meta description |
| --- | --- | --- |
| Main | 深井 青山公路 汀九樓市分析 Blog｜晉誠地產 | 深井、青山公路及汀九買樓租樓攻略：屋苑比較、校網交通、成交走勢分析，由紮根深井嘅持牌代理團隊撰寫，助你睇通區內樓市。 |
| 買樓攻略 | 深井 買樓攻略｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅買樓攻略文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 租樓攻略 | 深井 租樓攻略｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅租樓攻略文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 屋苑開箱 | 深井 屋苑開箱｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅屋苑開箱文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 屋苑比較 | 深井 屋苑比較｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅屋苑比較文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 成交分析 | 深井 成交分析｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅成交分析文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 社區生活 | 深井 社區生活｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅社區生活文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |
| 市場評論 | 深井 市場評論｜青山公路 汀九樓市文章｜晉誠地產 | 晉誠地產 Blog 嘅市場評論文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。 |

## Policy exclusion

`https://www.earnestproperty.com/blog/editorial-standards` occurs once in the sitemap and is linked from all eight presentation pages. It is an explicitly excluded non-article policy route under the existing import contract. Preserve its URL; do not create an article or infer a missing article body from it. Its own response was not fetched. The `SourceBundle.sitemap.articleCount` contract field is **113**, counting all saved `/blog/…` URLs including this policy route; normalized public article count is **112**.

## SourceBundle and normalization

Authoritative bundle: `.private-sync-evidence/blog-import/public-source-2026-11-05T06-53-02-556Z/normalized-main-navigation/source-bundle.json`. It includes the full 112-record registry, exact 113-URL sitemap subset and main-plus-seven-category presentation. Existing pure `inventoryFromSnapshots`, `buildImportPlan`, and `sanitizedSummary` contracts were reused without changes or DB adapters.

- Contract source fingerprint: `4e20ad54d5aa6a1621b59624134aa5da5c3f71090709679b1fbc2f5fca62096b` (canonical JSON fingerprint; distinct from the file-byte hash below).
- Complete public/source contract inputs: `registry`, `public`, `presentation`; no public/source normalization errors.
- Seven categories and eight settings scopes normalize successfully. `ready: false`; unresolved `source:database`; target `UNKNOWN_LIVE_DATABASE`; DB/live-row/revision counts are `null`.
- The planner’s 112 proposed inserts are provisional offline candidates, not approved dispositions and not evidence of missing database rows. No import manifest was approved or applied.
- Root-level first derived JSON files are retained but **superseded** by `normalized-main-navigation/`: the initial derivation used document-wide discovery order, which put a header 成交分析 shortcut first. The final bundle uses actual `main` category-navigation order. Raw responses and source bytes were unchanged; both derivations remain sealed.
- Remaining gaps: DB binding and schema capabilities, all database rows/revisions/authors/private drafts, editorial conflicts and dispositions, dynamic article rendering/media availability, all-writer fence, backup/restore and release readiness. Public/source matching establishes neither DB completeness nor whether a static fallback served the response.

## Raw evidence, attempts and hashes

All raw/derived observations are under ignored `.private-sync-evidence/blog-import/`, separate from environment files. Capture writes used exclusive create-new files; earlier attempts were retained distinctly. SHA-256 seals and read-only attributes protect the saved evidence from accidental edits; owners can override attributes, so this is not WORM storage. HTTP bodies are fetched response entity bytes after content decoding, not compressed wire packets. HTTP receipt headers are allowlisted; no cookies/credentials were sent or saved. Every final public request was GET, with no redirects observed.

| Capture directory | Result | Files including seal | Seal SHA-256 |
| --- | --- | --- | --- |
| `public-source-2026-11-05T06-51-39-844Z` | FAILED: 3 GET attempts; ENOTFOUND; HTTP status unknown | 20 | `ca003310a7109e9dfa5aacaf4763638a468f2cd33fb6ee91a829552de5ef7d31` |
| `public-source-2026-11-05T06-51-58-819Z` | PARTIAL SCOPE: 3 HTTP 200 responses; main + 成交分析 + sitemap | 23 | `27c6c43b43efa1a1b23c6ae3fd9271f679c27896b3acb4d3533b8fcd2071a351` |
| `public-source-2026-11-05T06-53-02-556Z` | COMPLETE REQUESTED PUBLIC SCOPE: 9 HTTP 200 responses; main + all 7 categories + sitemap | 47 | `749b0fe2bf491b27c97bcd96e0c7bbf22f84d57d0fae7b38faa70f2dd5d83bc2` |

All 90 files across the three capture directories were accounted for; every seal entry was re-read and matched. The failed sandbox DNS attempt is not an empty live inventory. The network-enabled GET retry succeeded.

Final response body SHA-256 values (all HTTP 200):

| Scope | Bytes | SHA-256 |
| --- | --- | --- |
| /blog | 299096 | `838ce755904281559de044bc09ff194b7ff058e8a3101aac558439712c12e920` |
| 成交分析 | 108198 | `c16e91cb056fea1b9c4dc9df988bf81cdde061d1707075e9be41be174560b73b` |
| /sitemap.xml | 88716 | `b44121ce3c011da9c75507403a0000c44da0057a5f21f453e9ba1e389538d0f6` |
| 買樓攻略 | 109577 | `3a12e8ae6dc1724af78250d85a32c4b25e9fda7d5b0bf5e008fa0ca785277c39` |
| 租樓攻略 | 108150 | `6b5463feaee2b5e5e9c5daac4c9019bf1d2a795f024b5eeb20ade2f8f0c16c30` |
| 屋苑開箱 | 295638 | `42833242cf561855c2843872a4b57e1082e03edaa6a4af5e3db00d773d97dc4f` |
| 屋苑比較 | 109582 | `3ddc4cdfa7775fd7abf2d32f0c0e51dc638c5a0a826b25dec15d38a7141e5b45` |
| 社區生活 | 108150 | `cdbc6a1277cab330cdc1cd6cf85cd7b4f9f823520776eec9d3d3afe7cf8bc202` |
| 市場評論 | 108150 | `df87bdbd34d3a258c4290fa6da6f94e040ff758c242c6f0b86b9a0a3cab0a012` |

Important artifacts below are relative to `.private-sync-evidence/blog-import/public-source-2026-11-05T06-53-02-556Z/`:

| Artifact | SHA-256 |
| --- | --- |
| `capture-manifest.json` | `d400983f581ffc3c784625bde6b3522784fbe26619e9c4b9048138d00343d19e` |
| `provider-deployment-receipt.json` | `4e3a756f061f478f495c7bd14f9c66875d532af3f548dc3351fa24885a84e1a8` |
| `source/src/content/blog-articles.ts` | `b4f17dfb55111ea3eb19610f835c8e6323c6db68c177ae990dc5263f974a2040` |
| `normalized-main-navigation/registry-full.json` | `10d2451209b998191c6118dfa98d732aa5f22e984144b133be24cfedb19b14d0` |
| `normalized-main-navigation/source-bundle.json` | `eee6265d7e2c107aa5d58ccfc7908528e709d3151784f5e8c7047bfefc9d15bf` |
| `normalized-main-navigation/source-associations.json` | `76acbc9bec52348841e65f7b90887cfc75491256a6853cd813669066e6df7178` |
| `normalized-main-navigation/contract-inventory.json` | `7b4fa69b281c8b938379189d9b6954e020409683efb5bbd8a02d6e8f69c8d534` |
| `normalized-main-navigation/inventory-analysis.json` | `36d15c26579bba19e8e112bb61ea63ae0f94712d675b3d221fce0988aacaffbe` |
| `derivation-provenance.json` | `fbe7df888b13461208448b43aa46831e214db3c0800eb0563a081bd6241aa5db` |
| `acl-audit.json` | `acc529d9afb84b92f42018e05aee41fe27353a626d4948760e7a7a76969c4ec6` |
| `sealed-file-manifest.json` | `749b0fe2bf491b27c97bcd96e0c7bbf22f84d57d0fae7b38faa70f2dd5d83bc2` |

The sealed manifest includes all remaining raw source-file and receipt hashes. `derivation-provenance.json` binds the reused local contract files and sidecar helpers independently of the deployed registry SHA. No existing application or script files were modified by this sidecar.

ACLs were inspected across each new capture tree without alteration: current user, SYSTEM, Administrators and the Codex sandbox identity only; no Everyone, BUILTIN Users, Authenticated Users or Anonymous allow grant was observed. Git ignore checks passed for all three seals. Exact local identities remain in private ACL receipts, not this report.

Collection/normalization scripts exist only under `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/`. The code graph inventory request was attempted but produced a delayed, oversized project listing; documented source/contract files were read directly. No crawler, product change, article-body fetch, DB access or production write was added.

**Controller handoff:** consume the bundle in `normalized-main-navigation/` and retain the deployment receipt and seal. Public/source work is complete within the requested scope. Continue database confirmation separately; do not treat these observations or the offline insert candidates as cutover acceptance.
