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
  | "/mortgage"
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
      { to: "/mortgage", label: "按揭計算機", description: "預覽供款、壓力測試及置業開支。" },
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

function itemMatchesLocation(item: NavItem, href: string) {
  return itemHref(item) === href;
}

function menuMatchesLocation(menu: MegaMenuGroup, href: string) {
  return [...menu.featured, ...menu.links].some((item) => itemMatchesLocation(item, href));
}

function menuMobileItems(menu: MegaMenuGroup, whatsappHref: string) {
  return [
    ...menu.featured,
    ...menu.links,
    ...("href" in menu.cta && menu.cta.href === whatsappHref ? [] : [menu.cta]),
  ];
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
    <Link
      to={item.to}
      onClick={onClick}
      className={baseClassName}
      activeProps={{ className: activeClassName }}
    >
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
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {item.description}
        </span>
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

function MegaMenuPanel({ menu, onLinkClick }: { menu: MegaMenuGroup; onLinkClick: () => void }) {
  return (
    <div
      id={getMegaMenuId(menu.id)}
      className="absolute left-1/2 top-full z-50 mt-3 w-[min(860px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border/70 bg-background shadow-xl"
    >
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div>
          <p className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {menu.purpose}
          </p>
          <div className="mt-2 grid gap-1">
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
  const location = useRouterState({ select: (state) => state.location });
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
          <HeaderNavLink
            item={listingNavItem}
            onClick={() => setActiveMegaMenu(null)}
            className="whitespace-nowrap"
          />
          {megaMenus.map((menu) => {
            const isActive = activeMegaMenu === menu.id || menuMatchesLocation(menu, location.href);

            return (
              <Button
                key={menu.id}
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={activeMegaMenu === menu.id}
                aria-controls={getMegaMenuId(menu.id)}
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
          {activeMenu ? (
            <MegaMenuPanel menu={activeMenu} onLinkClick={() => setActiveMegaMenu(null)} />
          ) : null}
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
                          {menuMobileItems(menu, WHATSAPP_URL).map((item) => (
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
