import type { ReactNode } from "react";
import { BadgeCheck, ExternalLink, MapPin, Phone } from "lucide-react";

import { earnestPublicTrust } from "@/content/estate-pages";

const publicLicenceNo = "C-018613";

export function TrustProofPanel() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold text-coral">本區地舖團隊</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">晉誠地產 Earnest Property</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              以公開可核實資料展示公司身份、牌照、地址和深井青山公路盤源覆蓋；即時可睇盤源以代理回覆為準。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Proof
              icon={<BadgeCheck className="h-4 w-4" />}
              label="公司牌照"
              value={publicLicenceNo}
            />
            <Proof
              icon={<Phone className="h-4 w-4" />}
              label="公司電話"
              value={earnestPublicTrust.phoneDisplay}
            />
            <Proof
              icon={<MapPin className="h-4 w-4" />}
              label="地舖地址"
              value={earnestPublicTrust.address}
            />
            <a
              href={earnestPublicTrust.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border bg-background p-4 text-sm hover:border-primary"
            >
              <span className="flex items-center gap-2 font-semibold text-primary">
                公開代理資料
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
              <span className="mt-1 block text-muted-foreground">28Hse agent profile</span>
            </a>
          </div>
        </div>
        <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          {earnestPublicTrust.observedListingFootprint}。
          {earnestPublicTrust.coverageNotes.join(" ")}
        </p>
      </div>
    </section>
  );
}

function Proof({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-4 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="mt-1 block font-semibold text-primary">{value}</span>
    </div>
  );
}
