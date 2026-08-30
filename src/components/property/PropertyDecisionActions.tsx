import { Calculator, MapPin, MessageCircle, Phone } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { propertyEnquiryMessage, type PropertyBranchContact } from "@/config/site";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";
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

type PropertyMobileContactSummaryProps = PropertyDecisionActionsProps;

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString("zh-HK")}`;
}

export function PropertyMobileContactSummary({
  agent,
  branchContact,
  fallbackWhatsapp,
  listingNo,
  title,
  dealType,
  price,
  onInquiry,
}: PropertyMobileContactSummaryProps) {
  const decision = getPropertyDecision({ dealType, price });
  const branchPhone = "phone" in branchContact ? branchContact.phone : branchContact.phoneTel;
  const phone = agent?.phone || branchPhone;
  // Branch WhatsApp numbers are all null until the client confirms them (the
  // phone numbers on file are landlines that cannot receive WhatsApp), so this
  // resolves exactly like before -- agent's own number, then the company
  // fallback -- until that data lands, at which point it becomes agent →
  // branch → company automatically with no further code change.
  const branchWhatsapp = "phone" in branchContact ? branchContact.whatsapp : null;
  const enquiryMessage = propertyEnquiryMessage({ title, dealType, price });
  const phoneHref = toTelHref(phone) ?? "/contact";
  const whatsappHref = toWhatsAppHref(
    agent?.whatsapp || branchWhatsapp || fallbackWhatsapp,
    enquiryMessage,
  );
  const hasWhatsapp = whatsappHref !== null;

  return (
    <Card data-listing-no={listingNo}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{agent ? "負責經紀" : "負責分行"}</CardTitle>
      </CardHeader>
      <CardContent>
        {agent ? (
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
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
              href={whatsappHref ?? "/contact"}
              target={hasWhatsapp ? "_blank" : undefined}
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
  );
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
  // Branch WhatsApp numbers are all null until the client confirms them (the
  // phone numbers on file are landlines that cannot receive WhatsApp), so this
  // resolves exactly like before -- agent's own number, then the company
  // fallback -- until that data lands, at which point it becomes agent →
  // branch → company automatically with no further code change.
  const branchWhatsapp = "phone" in branchContact ? branchContact.whatsapp : null;
  const enquiryMessage = propertyEnquiryMessage({ title, dealType, price });
  const phoneHref = toTelHref(phone) ?? "/contact";
  const whatsappHref = toWhatsAppHref(
    agent?.whatsapp || branchWhatsapp || fallbackWhatsapp,
    enquiryMessage,
  );
  const hasWhatsapp = whatsappHref !== null;
  const mortgage =
    decision.hasMortgagePrice && price !== null ? calculateMortgage({ price }) : null;
  const callLabel = decision.mobileCommands[0];
  const whatsappLabel = decision.mobileCommands[1];
  const mortgageLabel = decision.mobileCommands[2];

  return (
    <>
      <div className="hidden lg:block" data-listing-no={listingNo}>
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
                  href={whatsappHref ?? "/contact"}
                  target={hasWhatsapp ? "_blank" : undefined}
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

        {decision.showMortgage && decision.mortgageHref ? (
          <Card className="mt-4" data-property-mortgage-card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4" />
                按揭預算
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mortgage ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    以七成按揭、30 年期及現行預設利率估算
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">每月供款</p>
                      <p className="text-xl font-semibold">
                        {formatMoney(mortgage.monthlyPayment)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">首期</p>
                      <p className="font-medium">{formatMoney(mortgage.deposit)}</p>
                    </div>
                  </div>
                  {/* Purely additive: sums calculateMortgage's already-computed
                      deposit + stampDuty fields -- no agency fee or legal fee
                      estimate invented, since no verified source for those exists
                      in this codebase. */}
                  <div
                    className="mt-3 flex items-center justify-between border-t pt-3 text-sm"
                    data-property-cash-required
                  >
                    <span className="text-muted-foreground">預計上會現金需求（首期＋印花稅）</span>
                    <span className="font-semibold">
                      {formatMoney(mortgage.deposit + mortgage.stampDuty)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  輸入樓價、按揭成數及年期，快速估算置業預算。
                </p>
              )}
              <Button asChild className="mt-4 w-full" variant="outline">
                <a href={decision.mortgageHref}>{mortgage ? "詳細計算" : "開啟按揭計算機"}</a>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div
        className="fixed inset-x-0 bottom-16 z-40 border-t bg-background/95 px-3 py-2 shadow-lg backdrop-blur lg:hidden"
        data-property-mobile-actions
      >
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
              href={whatsappHref ?? "/contact"}
              target={hasWhatsapp ? "_blank" : undefined}
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
