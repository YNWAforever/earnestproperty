import { Link } from "@tanstack/react-router";
import { MapPin, Phone, Mail } from "lucide-react";
import { AppImage } from "@/components/media/AppImage";
import { SITE_BRANCHES, SITE_CONTACT } from "@/config/site";
import logoMark from "@/assets/logo-earnest-mark.png";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <AppImage
                src={logoMark}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
              />
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
            <p className="mt-4 text-xs opacity-60">牌照號 Licence No.: {SITE_CONTACT.licenceNo}</p>
            <p className="mt-3 text-xs opacity-60">
              <Link to="/agents" className="underline underline-offset-2">
                查看持牌代理團隊
              </Link>
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-brand-bright">
              地區 Districts
            </h3>
            {/*
              Client kept only 深井 / 青山公路 / 汀九 here. The estate links that
              used to share this column are not districts, so they moved to their
              own group below rather than being deleted — deleting them would
              leave /estate/rhine-garden and friends with no site-wide entry point.
            */}
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/district/sham-tseng" className="opacity-80 hover:opacity-100">
                  深井區買樓租樓
                </Link>
              </li>
              <li>
                <Link to="/castle-peak-road" className="opacity-80 hover:opacity-100">
                  青山公路區買樓租樓
                </Link>
              </li>
              <li>
                <Link
                  to="/castle-peak-road/$segment"
                  params={{ segment: "ting-kau" }}
                  className="opacity-80 hover:opacity-100"
                >
                  汀九豪宅區買樓租樓
                </Link>
              </li>
            </ul>

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-wider text-brand-bright">
              屋苑 Estates
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
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
            <h3 className="text-sm font-semibold uppercase tracking-wider text-brand-bright">
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
                  晉誠地產最新成交
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

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-wider text-brand-bright">
              法律 Legal
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/privacy" className="opacity-80 hover:opacity-100">
                  私隱政策
                </Link>
              </li>
              <li>
                <Link to="/disclaimer" className="opacity-80 hover:opacity-100">
                  免責聲明
                </Link>
              </li>
              <li>
                <Link to="/terms" className="opacity-80 hover:opacity-100">
                  使用條款
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-brand-bright">
              聯絡 Contact
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              {SITE_BRANCHES.map((branch) => (
                <li key={branch.phone} className="space-y-1 opacity-80">
                  <p className="font-semibold text-background">{branch.name}</p>
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-bright" />
                    <span>{branch.address}</span>
                  </p>
                  {/* A bare inline <a> here rendered as a ~69x20px tap target,
                      well under the 44px guideline -- inline-flex + min-h-11
                      expands the tappable box without changing the visual size
                      of the text itself. */}
                  <a
                    href={`tel:${branch.phone}`}
                    className="inline-flex min-h-11 items-center gap-2"
                  >
                    <Phone className="h-4 w-4 text-brand-bright" />
                    {branch.phone}
                  </a>
                </li>
              ))}
              <li className="opacity-80">
                <a
                  href={`mailto:${SITE_CONTACT.email}`}
                  className="inline-flex min-h-11 items-center gap-2"
                >
                  <Mail className="h-4 w-4 text-brand-bright" />
                  {SITE_CONTACT.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-background/15 pt-6 text-xs opacity-70 md:flex-row">
          <p>© {new Date().getFullYear()} Earnest Property 晉誠地產. All rights reserved.</p>
          <p>
            Licence {SITE_CONTACT.licenceNo} ·{" "}
            <a
              href="https://www.eaa.org.hk/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Estate Agents Authority HK
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
