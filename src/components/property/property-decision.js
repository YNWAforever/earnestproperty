export function getPropertyDecision({ dealType, price }) {
  const isRent = dealType === "rent";
  const mortgagePrice = Number(price);
  const hasMortgagePrice = Number.isFinite(mortgagePrice) && mortgagePrice > 0;

  return {
    intent: isRent ? "renter" : "buyer",
    inquiryLabel: isRent ? "查詢此租盤" : "查詢此售盤",
    showMortgage: !isRent,
    mortgageHref: !isRent && hasMortgagePrice ? `/mortgage?price=${mortgagePrice}` : null,
    mobileCommands: isRent ? ["致電", "WhatsApp"] : ["致電", "WhatsApp", "計月供"],
  };
}

export function buildPropertyInquiryPayload({ form, propertyId, consentWhatsapp }) {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email,
    message: form.message,
    property_id: propertyId,
    consentWhatsapp,
  };
}
