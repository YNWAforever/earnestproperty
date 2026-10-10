import { isValidWebsiteListingNo } from "../../lib/neon/website-inquiry.js";

export function getPropertyDecision({ dealType, price }) {
  const isRent = dealType === "rent";
  const mortgagePrice = Number(price);
  const hasMortgagePrice = !isRent && Number.isFinite(mortgagePrice) && mortgagePrice > 0;

  return {
    intent: isRent ? "renter" : "buyer",
    inquiryLabel: isRent ? "查詢此租盤" : "查詢此售盤",
    showMortgage: !isRent,
    hasMortgagePrice,
    mortgageHref: isRent
      ? null
      : hasMortgagePrice
        ? `/mortgage?price=${mortgagePrice}`
        : "/mortgage",
    mobileCommands: isRent ? ["致電", "WhatsApp"] : ["致電", "WhatsApp", "計月供"],
  };
}

export function buildPropertyInquiryPayload({ form, propertyId, listingNo, consentWhatsapp }) {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email,
    message: form.message,
    property_id: propertyId,
    // The public number the visitor saw (C-15); a malformed one is simply not sent.
    ...(isValidWebsiteListingNo(listingNo) ? { listingNo } : {}),
    consentWhatsapp,
  };
}
