import { Link } from "@tanstack/react-router";
import { MessageCircle, Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

const WHATSAPP_URL = "https://wa.me/852XXXXXXXX?text=你好，我想查詢深井物業";

const navItems = [
  { to: "/listings", label: "搜尋放盤" },
  { to: "/district/sham-tseng", label: "深井" },
  { to: "/estate/belvedere-garden", label: "屋苑" },
  { to: "/agents", label: "代理" },
  { to: "/blog", label: "市場分析" },
  { to: "/about", label: "關於" },
  { to: "/contact", label: "聯絡" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 18c3-1 5-1 7 0s4 1 7 0 5-1 6 0" strokeLinecap="round" className="text-gold" stroke="currentColor" />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight text-primary">晉誠地產</span>
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground">EARNEST PROPERTY</span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "rounded-md px-3 py-2 text-sm font-semibold text-primary bg-accent" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex"
          >
            <Button size="sm" className="bg-coral text-coral-foreground hover:bg-coral/90">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </Button>
          </a>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="mt-8 flex flex-col gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 text-base font-medium text-foreground/85 hover:bg-accent"
                  >
                    {item.label}
                  </Link>
                ))}
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4"
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
