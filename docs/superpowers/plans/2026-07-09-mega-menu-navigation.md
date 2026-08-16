# Mega Menu Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact desktop header and `更多` dropdown with a clear three-group mega menu while keeping `搜尋放盤` and `WhatsApp` as direct high-intent actions.

**Architecture:** Keep the change focused in `src/components/site/SiteHeader.tsx` by moving navigation into typed menu data arrays and rendering desktop panels plus mobile grouped sections from the same data. Extend the existing source-level contact/navigation test so the approved labels, route entry points, and close/accessibility hooks are covered without adding a browser test framework.

**Tech Stack:** React 19, TanStack Router, Vite, Tailwind CSS utility classes, shadcn/Radix `Button` and `Sheet`, lucide-react icons, Node test runner.

## Global Constraints

- Preserve the exact desktop trigger labels: `地區與屋苑`, `買租服務`, `市場資訊`.
- Preserve direct desktop links: brand to `/`, `搜尋放盤` to `/listings`, and right-side `WhatsApp` CTA via the existing `whatsappUrl` helper.
- Desktop panels open on click, switch when another trigger is clicked, close on `Escape`, close on outside click, and close when a menu link is selected.
- Desktop panels are floating panels around `720-860px` wide and do not cause sticky-header layout shift.
- Mobile drawer uses grouped sections with the same three labels and keeps the WhatsApp CTA at the bottom.
- Menu triggers use `aria-expanded`, `aria-controls`, and stable panel ids.
- Do not create destination pages, change route behavior, apply the `cms_videos` migration, or redesign the footer.
- Use normal anchors for `/listings?deal=sale`, `/listings?deal=rent`, `/#owner-valuation`, and `/estate/bellagio`.

---

## File Structure

- Modify `src/components/site/SiteHeader.tsx`: replace primary/secondary/dropdown navigation with shared `megaMenus` data, desktop mega-menu rendering, outside-click/Escape close behavior, active trigger styling, and mobile grouped drawer rendering.
- Modify `src/config/site.test.mjs`: add source checks for the approved mega-menu labels, representative links, stable panel ids, and interaction/accessibility hooks.

### Task 1: Mega Menu Header

**Files:**
- Modify: `src/config/site.test.mjs`
- Modify: `src/components/site/SiteHeader.tsx`

**Interfaces:**
- Consumes: `Link` and `useRouterState` from `@tanstack/react-router`, `Button` from `@/components/ui/button`, `Sheet`, `SheetContent`, `SheetTrigger` from `@/components/ui/sheet`, and `whatsappUrl(message?: string)` from `@/config/site`.
- Produces: `megaMenus: MegaMenuGroup[]`, `listingNavItem: NavItem`, `HeaderNavLink`, `MegaMenuLink`, and `SiteHeader` rendering the approved navigation structure.

- [ ] **Step 1: Write the failing source coverage test**

  Add this test in `src/config/site.test.mjs` immediately after the existing `homepage and navigation include Ting Kau content entry points` test:

  ```js
  test("header exposes approved mega menu structure and controls", () => {
    const source = readFileSync("src/components/site/SiteHeader.tsx", "utf8");

    for (const text of [
      "地區與屋苑",
      "買租服務",
      "市場資訊",
      "深井買樓租樓",
      "汀九地區頁",
      "青山公路",
      "屋苑入口",
      "查看全部放盤",
      "買樓",
      "租樓",
      "業主放盤 / 免費估價",
      "代理團隊",
      "聯絡門市",
      "YouTube影片",
      "成交快訊",
      "屋苑開箱",
      "市場分析",
      "關於晉誠",
      "觀看最新影片",
      "/district/sham-tseng",
      "/district/ting-kau",
      "/castle-peak-road",
      "/estate/bellagio",
      "/listings?deal=sale",
      "/listings?deal=rent",
      "/#owner-valuation",
      "/videos",
      "/transactions",
    ]) {
      assert.equal(source.includes(text), true, `${text} should appear in the header source`);
    }

    for (const text of [
      "mega-menu-districts",
      "mega-menu-services",
      "mega-menu-market",
      "aria-expanded",
      "aria-controls",
      "activeMegaMenu",
      "setActiveMegaMenu(null)",
      "document.addEventListener",
      "Escape",
      "mousedown",
    ]) {
      assert.equal(source.includes(text), true, `${text} should be wired in the header source`);
    }
  });
  ```

- [ ] **Step 2: Run the contact/navigation test and verify it fails**

  Run:

  ```powershell
  npm run test:contact
  ```

  Expected: FAIL in `header exposes approved mega menu structure and controls` because `SiteHeader.tsx` does not yet contain `地區與屋苑`, `mega-menu-districts`, or the other new mega-menu source strings.

- [ ] **Step 3: Replace `src/components/site/SiteHeader.tsx` with the mega-menu implementation**

  Replace the full file with:

  ```tsx
  import { Link, useRouterState } from "@tanstack/react-router";
  import { ChevronDown, MessageCircle, Menu } from "lucide-react";
  import { useEffect, useRef, useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
  import { whatsappUrl } from "@/config/site";

  type RouteTo =
    | "/about"
    | "/agents"
    | "/blog"
    | "/castle-peak-road"
    | "/contact"
    | "/district/sham-tseng"
    | "/district/ting-kau"
    | "/estate-reviews"
    | "/listings"
    | "/transactions"
    | "/videos";

  type NavItem =
    | {
        to: RouteTo;
        label: string;
        description?: string;
      }
    | {
        href: string;
        label: string;
        description?: string;
      };

  type MegaMenuId = "districts" | "services" | "market";

  type MegaMenuGroup = {
    id: MegaMenuId;
    label: string;
    purpose: string;
    featured: NavItem[];
    links: NavItem[];
    cta: NavItem;
  };

  const listingNavItem: NavItem = { to: "/listings", label: "搜尋放盤" };

  const megaMenus: MegaMenuGroup[] = [
    {
      id: "districts",
      label: "地區與屋苑",
      purpose: "按深井、青山公路、汀九或屋苑入口瀏覽。",
      featured: [
        {
          to: "/district/sham-tseng",
          label: "深井買樓租樓",
          description: "集中瀏覽深井區內買賣、租盤及生活配套。",
        },
        {
          to: "/district/ting-kau",
          label: "汀九地區頁",
          description: "查看汀九筍盤、海景屋苑及區內成交資訊。",
        },
      ],
      links: [
        { to: "/castle-peak-road", label: "青山公路", description: "沿線屋苑與分段樓市資訊。" },
        { href: "/estate/bellagio", label: "屋苑入口", description: "直接前往重點屋苑頁面。" },
        { to: "/estate-reviews", label: "屋苑開箱", description: "用開箱內容比較屋苑特色。" },
      ],
      cta: { to: "/listings", label: "查看全部放盤" },
    },
    {
      id: "services",
      label: "買租服務",
      purpose: "由買樓、租樓、放盤估價到聯絡門市。",
      featured: [
        {
          href: "/listings?deal=sale",
          label: "買樓",
          description: "用售盤條件快速篩選深井、青山公路、汀九盤源。",
        },
        {
          href: "/listings?deal=rent",
          label: "租樓",
          description: "查看即時租盤，配合預算、面積及屋苑需要。",
        },
      ],
      links: [
        {
          href: "/#owner-valuation",
          label: "業主放盤 / 免費估價",
          description: "提交物業資料，獲取深井業主估價報告。",
        },
        { to: "/agents", label: "代理團隊", description: "認識熟悉區內屋苑的前線代理。" },
        { to: "/contact", label: "聯絡門市", description: "查看麗都、海韻及青山公路豪景分行資料。" },
      ],
      cta: { href: whatsappUrl("你好，我想查詢深井／青山公路／汀九物業"), label: "WhatsApp 查詢" },
    },
    {
      id: "market",
      label: "市場資訊",
      purpose: "影片、成交、屋苑開箱與市場分析集中入口。",
      featured: [
        {
          to: "/videos",
          label: "YouTube影片",
          description: "觀看晉誠地產頻道及樓盤影片。",
        },
        {
          to: "/transactions",
          label: "成交快訊",
          description: "追蹤近期成交及區內價格走勢。",
        },
      ],
      links: [
        { to: "/estate-reviews", label: "屋苑開箱", description: "以實地內容了解屋苑優劣。" },
        { to: "/blog", label: "市場分析", description: "閱讀深井、青山公路、汀九樓市觀察。" },
        { to: "/about", label: "關於晉誠", description: "了解晉誠地產服務背景。" },
      ],
      cta: { to: "/videos", label: "觀看最新影片" },
    },
  ];

  function itemKey(item: NavItem) {
    return "href" in item ? item.href : item.to;
  }

  function itemPath(item: NavItem) {
    const rawPath = "href" in item ? item.href : item.to;
    return rawPath.split("?")[0].split("#")[0];
  }

  function itemMatchesPath(item: NavItem, pathname: string) {
    const path = itemPath(item);
    return path !== "/" && pathname === path;
  }

  function menuMatchesPath(menu: MegaMenuGroup, pathname: string) {
    return [...menu.featured, ...menu.links, menu.cta].some((item) =>
      itemMatchesPath(item, pathname),
    );
  }

  function HeaderNavLink({
    item,
    onClick,
    className = "",
  }: {
    item: NavItem;
    onClick?: () => void;
    className?: string;
  }) {
    const baseClassName = [
      "inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const activeClassName = [
      "inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-primary",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    if ("href" in item) {
      return (
        <a href={item.href} onClick={onClick} className={baseClassName}>
          {item.label}
        </a>
      );
    }

    return (
      <Link to={item.to} onClick={onClick} className={baseClassName} activeProps={{ className: activeClassName }}>
        {item.label}
      </Link>
    );
  }

  function MegaMenuLink({
    item,
    variant = "link",
    onClick,
  }: {
    item: NavItem;
    variant?: "featured" | "link" | "cta";
    onClick: () => void;
  }) {
    const className =
      variant === "cta"
        ? "inline-flex w-full items-center justify-between rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
        : variant === "featured"
          ? "block rounded-md px-3 py-3 transition-colors hover:bg-accent"
          : "block rounded-md px-3 py-2.5 transition-colors hover:bg-accent";

    const content = (
      <>
        <span className={variant === "cta" ? "text-sm" : "text-sm font-semibold text-foreground"}>
          {item.label}
        </span>
        {item.description ? (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
        ) : null}
      </>
    );

    if ("href" in item) {
      return (
        <a href={item.href} onClick={onClick} className={className}>
          {content}
        </a>
      );
    }

    return (
      <Link to={item.to} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }

  function MegaMenuPanel({
    menu,
    onLinkClick,
  }: {
    menu: MegaMenuGroup;
    onLinkClick: () => void;
  }) {
    return (
      <div
        id={`mega-menu-${menu.id}`}
        className="absolute left-1/2 top-full z-50 mt-3 w-[min(860px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border/70 bg-background shadow-xl"
      >
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
          <div>
            <p className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {menu.purpose}
            </p>
            <div className="mt-2 grid gap-1">
              {menu.featured.map((item) => (
                <MegaMenuLink key={itemKey(item)} item={item} variant="featured" onClick={onLinkClick} />
              ))}
            </div>
          </div>
          <div className="grid content-start gap-1">
            {menu.links.map((item) => (
              <MegaMenuLink key={itemKey(item)} item={item} onClick={onLinkClick} />
            ))}
          </div>
        </div>
        <div className="border-t border-border/70 bg-muted/35 px-5 py-3">
          <MegaMenuLink item={menu.cta} variant="cta" onClick={onLinkClick} />
        </div>
      </div>
    );
  }

  export function SiteHeader() {
    const [open, setOpen] = useState(false);
    const [activeMegaMenu, setActiveMegaMenu] = useState<MegaMenuId | null>(null);
    const headerRef = useRef<HTMLElement | null>(null);
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const WHATSAPP_URL = whatsappUrl("你好，我想查詢深井／青山公路／汀九物業");
    const activeMenu = megaMenus.find((menu) => menu.id === activeMegaMenu);

    useEffect(() => {
      if (!activeMegaMenu) {
        return;
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setActiveMegaMenu(null);
        }
      }

      function handlePointerDown(event: MouseEvent) {
        if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
          setActiveMegaMenu(null);
        }
      }

      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handlePointerDown);

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("mousedown", handlePointerDown);
      };
    }, [activeMegaMenu]);

    return (
      <header
        ref={headerRef}
        className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setActiveMegaMenu(null)}>
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d="M2 18c3-1 5-1 7 0s4 1 7 0 5-1 6 0"
                  strokeLinecap="round"
                  className="text-gold"
                  stroke="currentColor"
                />
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-base font-bold tracking-tight text-primary">晉誠地產</span>
              <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
                EARNEST PROPERTY
              </span>
            </div>
          </Link>

          <nav className="relative hidden items-center gap-1 lg:flex" aria-label="主選單">
            <HeaderNavLink item={listingNavItem} onClick={() => setActiveMegaMenu(null)} className="whitespace-nowrap" />
            {megaMenus.map((menu) => {
              const isActive = activeMegaMenu === menu.id || menuMatchesPath(menu, pathname);

              return (
                <Button
                  key={menu.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={activeMegaMenu === menu.id}
                  aria-controls={`mega-menu-${menu.id}`}
                  className={[
                    "gap-1 whitespace-nowrap px-3 text-sm font-medium text-foreground/80 hover:text-foreground",
                    isActive ? "bg-accent text-primary" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveMegaMenu(activeMegaMenu === menu.id ? null : menu.id)}
                >
                  {menu.label}
                  <ChevronDown
                    className={[
                      "h-3.5 w-3.5 transition-transform",
                      activeMegaMenu === menu.id ? "rotate-180" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                </Button>
              );
            })}
            {activeMenu ? <MegaMenuPanel menu={activeMenu} onLinkClick={() => setActiveMegaMenu(null)} /> : null}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex"
              onClick={() => setActiveMegaMenu(null)}
            >
              <Button size="sm" className="bg-coral text-coral-foreground hover:bg-coral/90">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </a>

            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="開啟主選單"
                  onClick={() => setActiveMegaMenu(null)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 max-w-[calc(100vw-2rem)]">
                <div className="flex h-full flex-col">
                  <div className="mt-8 flex-1 overflow-y-auto pr-1">
                    <HeaderNavLink
                      item={listingNavItem}
                      onClick={() => setOpen(false)}
                      className="mb-3 flex w-full justify-start px-3 py-2.5 text-base"
                    />
                    <div className="space-y-5">
                      {megaMenus.map((menu) => (
                        <section key={menu.id} aria-labelledby={`mobile-menu-${menu.id}`}>
                          <h2
                            id={`mobile-menu-${menu.id}`}
                            className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                          >
                            {menu.label}
                          </h2>
                          <div className="mt-2 grid gap-1">
                            {[...menu.featured, ...menu.links, menu.cta].map((item) => (
                              <MegaMenuLink
                                key={`${menu.id}-${itemKey(item)}`}
                                item={item}
                                onClick={() => setOpen(false)}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4"
                    onClick={() => setOpen(false)}
                  >
                    <Button className="w-full bg-coral text-coral-foreground hover:bg-coral/90">
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp 查詢
                    </Button>
                  </a>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    );
  }
  ```

- [ ] **Step 4: Run the focused source coverage test**

  Run:

  ```powershell
  npm run test:contact
  ```

  Expected: PASS for all tests in `src/config/site.test.mjs`.

- [ ] **Step 5: Run targeted ESLint**

  Run:

  ```powershell
  .\node_modules\.bin\eslint.cmd src/components/site/SiteHeader.tsx src/config/site.test.mjs
  ```

  Expected: exit code `0` with no lint errors.

- [ ] **Step 6: Run the production build**

  Run:

  ```powershell
  npm run build
  ```

  Expected: Vite/TanStack build completes with exit code `0`.

- [ ] **Step 7: Manually verify desktop and mobile navigation**

  Start the dev server:

  ```powershell
  npm run dev -- --host 127.0.0.1
  ```

  Open the printed local URL and verify:

  ```text
  Desktop width 1280px:
  - Top bar shows brand, 搜尋放盤, 地區與屋苑, 買租服務, 市場資訊, and WhatsApp without wrapping.
  - Clicking 地區與屋苑 opens a floating panel containing 深井買樓租樓, 汀九地區頁, 青山公路, 屋苑入口, 屋苑開箱, and 查看全部放盤.
  - Clicking 買租服務 switches the same panel area to 買樓, 租樓, 業主放盤 / 免費估價, 代理團隊, 聯絡門市, and WhatsApp 查詢.
  - Clicking 市場資訊 switches the panel to YouTube影片, 成交快訊, 屋苑開箱, 市場分析, 關於晉誠, and 觀看最新影片.
  - Escape closes the panel.
  - Clicking page content outside the header closes the panel.
  - Clicking a menu link closes the panel and navigates.

  Mobile width 390px:
  - Header shows brand, WhatsApp when space allows, and the menu icon.
  - Drawer shows 搜尋放盤 first, then grouped sections 地區與屋苑, 買租服務, 市場資訊.
  - Drawer links do not overflow horizontally.
  - WhatsApp 查詢 stays easy to reach at the bottom.
  ```

  Stop the dev server after verification.

- [ ] **Step 8: Commit the implementation**

  Run:

  ```powershell
  git add src/components/site/SiteHeader.tsx src/config/site.test.mjs
  git commit -m "feat: redesign header as mega menu"
  ```

  Expected: commit succeeds and only the two implementation files are staged for this commit.

## Self-Review

- Spec coverage: Task 1 covers the direct `搜尋放盤` link, exact three top-level labels, full desktop mega panels, mobile grouped drawer, WhatsApp CTA retention, close behavior, accessibility attributes, and source-level tests for representative routes.
- Placeholder scan: The plan contains no deferred implementation steps and no unspecified code blocks.
- Type consistency: `NavItem`, `MegaMenuGroup`, `MegaMenuId`, `listingNavItem`, and `megaMenus` are defined before use; helper names match the JSX that consumes them.
