import { Link } from "@tanstack/react-router";
import { MapPin, Phone, Mail, Facebook, Instagram } from "lucide-react";
import { SITE_CONTACT } from "@/config/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-primary">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-base font-bold">晉誠地產</span>
                <span className="text-[10px] tracking-widest opacity-70">EARNEST PROPERTY</span>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed opacity-80">
              深井．青山公路．我哋比你更熟。
              <br />
              Your Sham Tseng Property Expert.
            </p>
            <p className="mt-4 text-xs opacity-60">牌照號 Licence No.: C-018613</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              地區 Districts
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/district/sham-tseng" className="opacity-80 hover:opacity-100">
                  深井 Sham Tseng
                </Link>
              </li>
              <li>
                <Link to="/district/tsuen-wan" className="opacity-80 hover:opacity-100">
                  荃灣 Tsuen Wan
                </Link>
              </li>
              <li>
                <Link to="/estate/bellagio" className="opacity-80 hover:opacity-100">
                  碧堤半島
                </Link>
              </li>
              <li>
                <Link to="/estate/sea-crest-villa" className="opacity-80 hover:opacity-100">
                  浪翠園
                </Link>
              </li>
              <li>
                <Link to="/estate/hong-kong-garden" className="opacity-80 hover:opacity-100">
                  豪景花園
                </Link>
              </li>
              <li>
                <Link to="/estate/rhine-garden" className="opacity-80 hover:opacity-100">
                  海韻花園
                </Link>
              </li>
              <li>
                <Link to="/estate/lido-garden" className="opacity-80 hover:opacity-100">
                  麗都花園
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              公司 Company
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/about" className="opacity-80 hover:opacity-100">
                  關於晉誠
                </Link>
              </li>
              <li>
                <Link to="/agents" className="opacity-80 hover:opacity-100">
                  代理團隊
                </Link>
              </li>
              <li>
                <Link to="/blog" className="opacity-80 hover:opacity-100">
                  市場分析
                </Link>
              </li>
              <li>
                <Link to="/contact" className="opacity-80 hover:opacity-100">
                  聯絡我們
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              聯絡 Contact
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex items-start gap-2 opacity-80">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                <span>{SITE_CONTACT.address}</span>
              </li>
              <li className="flex items-center gap-2 opacity-80">
                <Phone className="h-4 w-4 text-gold" />
                <a href={SITE_CONTACT.phoneTel ? `tel:${SITE_CONTACT.phoneTel}` : "/contact"}>
                  {SITE_CONTACT.phoneDisplay || "聯絡我們"}
                </a>
              </li>
              <li className="flex items-center gap-2 opacity-80">
                <Mail className="h-4 w-4 text-gold" />
                <a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
              </li>
            </ul>
            <div className="mt-5 flex gap-3">
              <a
                href="#"
                className="rounded-full bg-primary-foreground/10 p-2 hover:bg-primary-foreground/20"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="rounded-full bg-primary-foreground/10 p-2 hover:bg-primary-foreground/20"
              >
                <Instagram className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-primary-foreground/15 pt-6 text-xs opacity-70 md:flex-row">
          <p>© {new Date().getFullYear()} Earnest Property 晉誠地產. All rights reserved.</p>
          <p>Licence {SITE_CONTACT.licenceNo} · Estate Agents Authority HK</p>
        </div>
      </div>
    </footer>
  );
}
