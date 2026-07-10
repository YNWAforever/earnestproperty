export type PropertyDecision = {
  intent: "buyer" | "renter";
  inquiryLabel: "查詢此售盤" | "查詢此租盤";
  showMortgage: boolean;
  mortgageHref: string | null;
  mobileCommands: string[];
};

export function getPropertyDecision(input: {
  dealType: "sale" | "rent";
  price: number | null;
}): PropertyDecision;

export function buildPropertyInquiryPayload(input: {
  form: {
    name: string;
    phone: string;
    email: string;
    message: string;
    [key: string]: unknown;
  };
  propertyId: string;
  consentWhatsapp: boolean;
}): {
  name: string;
  phone: string;
  email: string;
  message: string;
  property_id: string;
  consentWhatsapp: boolean;
};
