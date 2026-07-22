import { Link } from "@tanstack/react-router";
import { MapPin, Phone, Mail } from "lucide-react";
import { SITE_BRANCHES, SITE_CONTACT } from "@/config/site";
import logoMark from "@/assets/logo-earnest-mark.png";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={logoMark} alt="" className="h-10 w-10 object-contain" />
              <div className="flex flex-col leading-none">
                <span className="text-base font-bold">晉誠地產</span>
                <span className="text-[10px] tracking-widest opacity-70">EARNEST PROPERTY</span>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed opacity-80">
              深井．青山公路．汀九我哋比你更熟。
              <br />
              Your Sham Tseng Property Expert.
            </p>
            <p className="mt-4 text-xs opacity-60">牌照號 Licence No.: C-018613</p>
            <p className="mt-3 text-xs opacity-60">
              <Link to="/agents" className="underline underline-offset-2">
                查看持牌代理團隊
              </Link>
            </p>
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
                <Link to="/castle-peak-road" className="opacity-80 hover:opacity-100">
                  青山公路 Castle Peak Road
                </Link>
              </li>
              <li>
                <Link to="/district/ting-kau" className="opacity-80 hover:opacity-100">
                  汀九 Ting Kau
                </Link>
              </li>
              <li>
                <Link
                  to="/estate/$slug"
                  params={{ slug: "bellagio" }}
                  className="opacity-80 hover:opacity-100"
                >
                  碧堤半島
                </Link>
              </li>
              <li>
                <Link
                  to="/estate/$slug"
                  params={{ slug: "sea-crest-villa" }}
                  className="opacity-80 hover:opacity-100"
                >
                  浪翠園
                </Link>
              </li>
              <li>
                <Link
                  to="/estate/$slug"
                  params={{ slug: "hong-kong-garden" }}
                  className="opacity-80 hover:opacity-100"
                >
                  豪景花園
                </Link>
              </li>
              <li>
                <Link
                  to="/estate/$slug"
                  params={{ slug: "rhine-garden" }}
                  className="opacity-80 hover:opacity-100"
                >
                  海韻花園
                </Link>
              </li>
              <li>
                <Link
                  to="/estate/$slug"
                  params={{ slug: "lido-garden" }}
                  className="opacity-80 hover:opacity-100"
                >
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
                <Link to="/mortgage" className="opacity-80 hover:opacity-100">
                  按揭計算機
                </Link>
              </li>
              <li>
                <Link to="/blog" className="opacity-80 hover:opacity-100">
                  市場分析
                </Link>
              </li>
              <li>
                <Link to="/videos" className="opacity-80 hover:opacity-100">
                  YouTube影片
                </Link>
              </li>
              <li>
                <Link to="/estate-reviews" className="opacity-80 hover:opacity-100">
                  屋苑開箱
                </Link>
              </li>
              <li>
                <Link to="/transactions" className="opacity-80 hover:opacity-100">
                  成交快訊
                </Link>
              </li>
              <li>
                <a href="/#owner-valuation" className="opacity-80 hover:opacity-100">
                  業主放盤 / 免費估價
                </a>
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
              {SITE_BRANCHES.map((branch) => (
                <li key={branch.phone} className="space-y-1 opacity-80">
                  <p className="font-semibold text-background">{branch.name}</p>
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    <span>{branch.address}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-gold" />
                    <a href={`tel:${branch.phone}`}>{branch.phone}</a>
                  </p>
                </li>
              ))}
              <li className="flex items-center gap-2 opacity-80">
                <Mail className="h-4 w-4 text-gold" />
                <a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-background/15 pt-6 text-xs opacity-70 md:flex-row">
          <p>© {new Date().getFullYear()} Earnest Property 晉誠地產. All rights reserved.</p>
          <p>Licence {SITE_CONTACT.licenceNo} · Estate Agents Authority HK</p>
        </div>
      </div>
    </footer>
  );
}
