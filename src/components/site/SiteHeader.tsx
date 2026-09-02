import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, MessageCircle, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AppImage } from "@/components/media/AppImage";
import { SiteLink } from "@/components/site/SiteLink";
import { hrefPathname } from "@/lib/site-links";
import { whatsappUrl } from "@/config/site";
import logoMark from "@/assets/logo-earnest-mark.png";

type RouteTo =
  | "/about"
  | "/agents"
  | "/blog"
  | "/castle-peak-road"
  | "/contact"
  | "/district/sham-tseng"
  | "/estate-reviews"
  | "/listings"
  | "/mortgage"
  | "/transactions"
  | "/videos";

type NavItem =
  | {
      to: RouteTo;
      label: string;
      description?: string;
      // Extra pathname prefixes this entry "owns" for the active state, e.g.
      // 搜尋放盤 also lights up on a listing detail page.
      ownsPrefixes?: string[];
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
  featured: NavItem[];
  links: NavItem[];
  cta: NavItem;
  // True when `cta` is the same general WhatsApp enquiry already rendered as
  // the header's own WhatsApp button, so the mobile sheet must not repeat it.
  // This used to be inferred by directly comparing the two built href strings,
  // which only ever worked because both happened to be built from the
  // identical hardcoded message string and so produced byte-identical URLs
  // (wa.me or "/contact") by coincidence -- any
  // future change to either message (e.g. adding a distinct `source` tag)
  // would silently reintroduce a duplicate mobile menu entry with no error.
  // Declaring it explicitly can't drift.
  ctaMirrorsGlobalWhatsapp?: boolean;
  // Pathname prefixes that light this trigger up as "you are here". Declared
  // per group rather than derived from the items above because param routes
  // (/estate/$slug, /agents/$slug, /blog/$slug …) are reached from cards, not
  // from the menu, yet still belong to a section -- and because 屋苑開箱 is
  // listed under two groups but should light only one.
  ownsPrefixes: string[];
};

const listingNavItem: NavItem = {
  to: "/listings",
  label: "搜尋放盤",
  ownsPrefixes: ["/listings", "/property"],
};

const megaMenus: MegaMenuGroup[] = [
  {
    id: "districts",
    label: "地區與屋苑",
    // Client pruned the district entries to 深井 / 青山公路 / 汀九, so all three
    // sit in `featured` and `links` carries estate entry points only — an estate
    // is not a district.
    featured: [
      {
        to: "/district/sham-tseng",
        label: "深井區買樓租樓",
        description: "集中瀏覽深井區內買賣、租盤及生活配套。",
      },
      {
        to: "/castle-peak-road",
        label: "青山公路區買樓租樓",
        description: "沿線屋苑與生活圈樓市資訊。",
      },
      {
        // Param route, so it goes through href like the estate links below.
        href: "/castle-peak-road/ting-kau",
        label: "汀九豪宅區買樓租樓",
        description: "查看汀九筍盤、海景屋苑及區內成交資訊。",
      },
    ],
    // Direct estate entry points (the client's homepage order, the five with
    // a detail page first). This replaced a single generic 屋苑入口 link that
    // opened one estate -- redundant next to the district pages, and its
    // description only restated the label.
    links: [
      { href: "/estate/bellagio", label: "碧堤半島" },
      { href: "/estate/sea-crest-villa", label: "浪翠園" },
      { href: "/estate/lido-garden", label: "麗都花園" },
      { href: "/estate/rhine-garden", label: "海韻花園" },
      { href: "/estate/hong-kong-garden", label: "豪景花園" },
      { to: "/estate-reviews", label: "屋苑開箱", description: "用開箱內容比較屋苑特色。" },
    ],
    cta: { to: "/listings", label: "查看全部放盤" },
    ownsPrefixes: ["/district", "/castle-peak-road", "/estate"],
  },
  {
    id: "services",
    label: "買租服務",
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
      { to: "/mortgage", label: "按揭計算機", description: "預覽供款、壓力測試及置業開支。" },
      { to: "/agents", label: "代理團隊", description: "認識熟悉區內屋苑的前線代理。" },
      { to: "/contact", label: "聯絡門市", description: "查看麗都、海韻及青山公路豪景分行資料。" },
    ],
    cta: { href: whatsappUrl("你好，我想查詢深井／青山公路／汀九物業"), label: "WhatsApp 查詢" },
    ctaMirrorsGlobalWhatsapp: true,
    ownsPrefixes: ["/mortgage", "/agents", "/contact"],
  },
  {
    id: "market",
    label: "市場資訊",
    featured: [
      {
        to: "/videos",
        label: "YouTube影片",
        description: "觀看晉誠地產頻道及樓盤影片。",
      },
      {
        to: "/transactions",
        label: "晉誠地產最新成交",
        description: "追蹤近期成交及區內價格走勢。",
      },
    ],
    links: [
      { to: "/estate-reviews", label: "屋苑開箱", description: "以實地內容了解屋苑優劣。" },
      { to: "/blog", label: "市場分析", description: "閱讀深井、青山公路、汀九樓市觀察。" },
    ],
    cta: { to: "/videos", label: "觀看最新影片" },
    ownsPrefixes: ["/videos", "/transactions", "/blog", "/estate-reviews"],
  },
];

const aboutNavItem: NavItem = { to: "/about", label: "關於晉誠" };

const megaMenuIds = {
  districts: "mega-menu-districts",
  services: "mega-menu-services",
  market: "mega-menu-market",
} as const;

function getMegaMenuId(menuId: MegaMenuId) {
  return megaMenuIds[menuId];
}

function itemKey(item: NavItem) {
  return "href" in item ? item.href : item.to;
}

function itemHref(item: NavItem) {
  return "href" in item ? item.href : item.to;
}

function pathnameOwnedBy(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Active state compares pathnames, not full hrefs: the old exact compare
// against `location.href` never matched `/listings?deal=sale&page=2`, and
// could not light a section for a page reached from a card (/estate/bellagio).
function itemMatchesLocation(item: NavItem, href: string) {
  const pathname = hrefPathname(href);
  if ("to" in item && item.ownsPrefixes) {
    return pathnameOwnedBy(pathname, item.ownsPrefixes);
  }
  return hrefPathname(itemHref(item)) === pathname;
}

function menuMatchesLocation(menu: MegaMenuGroup, href: string) {
  return pathnameOwnedBy(hrefPathname(href), menu.ownsPrefixes);
}

function menuMobileItems(menu: MegaMenuGroup) {
  const base = [...menu.featured, ...menu.links];
  // Skip the cta if it points to the same route as an item already listed
  // above (e.g. market's "/videos" featured item and cta) to avoid duplicate
  // React keys and a redundant link.
  const ctaIsDuplicate = base.some((item) => itemKey(item) === itemKey(menu.cta));
  return menu.ctaMirrorsGlobalWhatsapp || ctaIsDuplicate ? base : [...base, menu.cta];
}

function HeaderNavLink({
  item,
  currentHref,
  onClick,
  className = "",
}: {
  item: NavItem;
  currentHref: string;
  onClick?: () => void;
  className?: string;
}) {
  const active = itemMatchesLocation(item, currentHref);
  const linkClassName = [
    "inline-flex items-center rounded-md px-3 py-2 text-sm transition-colors",
    active
      ? "bg-accent font-semibold text-primary"
      : "font-medium text-foreground/80 hover:bg-accent hover:text-foreground",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SiteLink
      href={itemHref(item)}
      onClick={onClick}
      className={linkClassName}
      aria-current={active ? "page" : undefined}
    >
      {item.label}
    </SiteLink>
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
      ? "inline-flex w-full items-center justify-between rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover sm:w-auto"
      : variant === "featured"
        ? "block rounded-md px-3 py-3 transition-colors hover:bg-accent"
        : "block rounded-md px-3 py-2.5 transition-colors hover:bg-accent";

  const content = (
    <>
      <span className={variant === "cta" ? "text-sm" : "text-sm font-semibold text-foreground"}>
        {item.label}
      </span>
      {item.description ? (
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {item.description}
        </span>
      ) : null}
    </>
  );

  // SiteLink turns every internal href (including `/listings?deal=sale`,
  // `/castle-peak-road/ting-kau` and `/#owner-valuation`) into a typed router
  // Link, so no menu item is a full document reload any more; wa.me stays a
  // plain anchor opening in a new tab.
  return (
    <SiteLink href={itemHref(item)} onClick={onClick} className={className}>
      {content}
    </SiteLink>
  );
}

function MegaMenuPanel({ menu, onLinkClick }: { menu: MegaMenuGroup; onLinkClick: () => void }) {
  return (
    <div
      id={getMegaMenuId(menu.id)}
      className="absolute left-1/2 top-full z-50 mt-3 w-[min(860px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border/70 bg-background shadow-xl"
    >
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div>
          <div className="grid gap-1">
            {menu.featured.map((item) => (
              <MegaMenuLink
                key={itemKey(item)}
                item={item}
                variant="featured"
                onClick={onLinkClick}
              />
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
  const triggerRefs = useRef<Map<MegaMenuId, HTMLButtonElement>>(new Map());
  const location = useRouterState({ select: (state) => state.location });
  const WHATSAPP_URL = whatsappUrl("你好，我想查詢深井／青山公路／汀九物業");
  const activeMenu = megaMenus.find((menu) => menu.id === activeMegaMenu);

  // Closing via Escape or an outside click must not strand focus on a
  // removed panel -- return it to the trigger the panel came from, the same
  // as any WCAG-conformant disclosure widget (2.4.3 Focus Order).
  function closeMegaMenu() {
    setActiveMegaMenu((current) => {
      if (current) triggerRefs.current.get(current)?.focus();
      return null;
    });
  }

  useEffect(() => {
    if (!activeMegaMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMegaMenu();
      }
    }

    function handlePointerDown(event: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        closeMegaMenu();
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
          {/* 公司logo要大啲 (docx p1): 40px -> 56px on mobile (+40%) and 60px from sm
              up (+50%), the range the brief asked for, set separately per breakpoint.
              width/height carry the largest rendered size so the box is reserved
              before CSS lands — the header grows a little but nothing shifts. */}
          <AppImage
            src={logoMark}
            alt=""
            width={60}
            height={60}
            loading="eager"
            className="h-14 w-14 object-contain sm:h-[60px] sm:w-[60px]"
          />
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight text-primary">晉誠地產</span>
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
              EARNEST PROPERTY
            </span>
          </div>
        </Link>

        <nav className="relative hidden items-center gap-1 lg:flex" aria-label="主選單">
          <HeaderNavLink
            item={listingNavItem}
            currentHref={location.href}
            onClick={() => setActiveMegaMenu(null)}
            className="whitespace-nowrap"
          />
          {megaMenus.map((menu) => {
            const isCurrentSection = menuMatchesLocation(menu, location.href);
            const isActive = activeMegaMenu === menu.id || isCurrentSection;

            return (
              <Button
                key={menu.id}
                ref={(el) => {
                  if (el) triggerRefs.current.set(menu.id, el);
                  else triggerRefs.current.delete(menu.id);
                }}
                type="button"
                variant="ghost"
                size="sm"
                aria-haspopup="true"
                aria-expanded={activeMegaMenu === menu.id}
                aria-controls={getMegaMenuId(menu.id)}
                aria-current={isCurrentSection ? "true" : undefined}
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
          <HeaderNavLink
            item={aboutNavItem}
            currentHref={location.href}
            onClick={() => setActiveMegaMenu(null)}
            className="whitespace-nowrap"
          />
          {activeMenu ? <MegaMenuPanel menu={activeMenu} onLinkClick={closeMegaMenu} /> : null}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex"
            onClick={() => setActiveMegaMenu(null)}
          >
            <Button size="sm" variant="brand">
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
                aria-label={open ? "關閉主選單" : "開啟主選單"}
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
                    currentHref={location.href}
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
                          {menuMobileItems(menu).map((item) => (
                            <MegaMenuLink
                              key={`${menu.id}-${itemKey(item)}`}
                              item={item}
                              onClick={() => setOpen(false)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                    <HeaderNavLink
                      item={aboutNavItem}
                      currentHref={location.href}
                      onClick={() => setOpen(false)}
                      className="flex w-full justify-start px-3 py-2.5 text-base"
                    />
                  </div>
                </div>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4"
                  onClick={() => setOpen(false)}
                >
                  <Button variant="brand" className="w-full">
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
