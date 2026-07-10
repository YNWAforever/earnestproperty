import { Calculator, MapPin, MessageCircle, Phone } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PropertyBranchContact } from "@/config/site";
import { calculateMortgage } from "@/lib/mortgage";

import { getPropertyDecision } from "./property-decision.js";

type PublicAgent = {
  name_zh: string | null;
  name_en: string | null;
  phone: string | null;
  whatsapp: string | null;
  licence_no: string | null;
  avatar_url: string | null;
  branch: string | null;
};

type PropertyDecisionActionsProps = {
  agent: PublicAgent | null;
  branchContact: PropertyBranchContact;
  fallbackWhatsapp: string;
  listingNo: string;
  title: string;
  dealType: "sale" | "rent";
  price: number | null;
  onInquiry: () => void;
};

function digits(value: string) {
  return value.replace(/[^\d]/g, "");
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString("zh-HK")}`;
}

export function PropertyDecisionActions({
  agent,
  branchContact,
  fallbackWhatsapp,
  listingNo,
  title,
  dealType,
  price,
  onInquiry,
}: PropertyDecisionActionsProps) {
  const decision = getPropertyDecision({ dealType, price });
  const branchPhone = "phone" in branchContact ? branchContact.phone : branchContact.phoneTel;
  const phone = agent?.phone || branchPhone;
  const whatsapp = agent?.whatsapp || fallbackWhatsapp;
  const phoneHref = phone ? `tel:${digits(phone)}` : "/contact";
  const whatsappHref = whatsapp
    ? `https://wa.me/${digits(whatsapp)}?text=${encodeURIComponent(`你好，我想查詢編號 ${listingNo} ${title}`)}`
    : "/contact";
  const mortgage = decision.showMortgage && price ? calculateMortgage({ price }) : null;
  const callLabel = decision.mobileCommands[0];
  const whatsappLabel = decision.mobileCommands[1];
  const mortgageLabel = decision.mobileCommands[2];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{agent ? "負責經紀" : "負責分行"}</CardTitle>
        </CardHeader>
        <CardContent>
          {agent ? (
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14">
                <AvatarImage src={agent.avatar_url ?? undefined} alt={agent.name_zh ?? ""} />
                <AvatarFallback>
                  {(agent.name_zh ?? agent.name_en ?? "經").slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{agent.name_zh ?? agent.name_en}</p>
                {agent.licence_no ? (
                  <p className="text-xs text-muted-foreground">牌照 {agent.licence_no}</p>
                ) : null}
                {agent.branch ? (
                  <p className="text-xs text-muted-foreground">{agent.branch}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div>
              <p className="font-semibold">{branchContact.name}</p>
              <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {branchContact.address}
              </p>
              {phone ? <p className="mt-2 text-sm font-medium">{phone}</p> : null}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button asChild variant="outline">
              <a href={phoneHref}>
                <Phone className="mr-2 h-4 w-4" />
                致電
              </a>
            </Button>
            <Button asChild>
              <a
                href={whatsappHref}
                target={whatsapp ? "_blank" : undefined}
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                WhatsApp
              </a>
            </Button>
          </div>
          <Button
            className="mt-2 w-full"
            variant={dealType === "rent" ? "default" : "secondary"}
            onClick={onInquiry}
          >
            {decision.inquiryLabel}
          </Button>
        </CardContent>
      </Card>

      {mortgage && decision.mortgageHref ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" />
              按揭預算
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">以七成按揭、30 年期及現行預設利率估算</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">每月供款</p>
                <p className="text-xl font-semibold">{formatMoney(mortgage.monthlyPayment)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">首期</p>
                <p className="font-medium">{formatMoney(mortgage.deposit)}</p>
              </div>
            </div>
            <Button asChild className="mt-4 w-full" variant="outline">
              <a href={decision.mortgageHref}>詳細計算</a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background/95 px-3 py-2 shadow-lg backdrop-blur lg:hidden">
        <div
          className={`mx-auto grid max-w-6xl gap-2 ${decision.showMortgage ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <Button asChild variant="outline" size="sm">
            <a href={phoneHref}>
              <Phone className="mr-1 h-4 w-4" />
              {callLabel}
            </a>
          </Button>
          <Button asChild size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe57]">
            <a
              href={whatsappHref}
              target={whatsapp ? "_blank" : undefined}
              rel="noopener noreferrer"
            >
              <MessageCircle className="mr-1 h-4 w-4" />
              {whatsappLabel}
            </a>
          </Button>
          {decision.showMortgage && decision.mortgageHref ? (
            <Button asChild size="sm" variant="secondary">
              <a href={decision.mortgageHref}>
                <Calculator className="mr-1 h-4 w-4" />
                {mortgageLabel}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
