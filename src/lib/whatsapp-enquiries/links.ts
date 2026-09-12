import { randomBytes } from "node:crypto";
/** 192 random bits; this token attributes a placement, never authenticates a customer. */
export function mintReference() {
  return randomBytes(24).toString("base64url");
}
export function extractReferences(text: string) {
  const candidates = Array.from(text.slice(0, 16000).matchAll(/EPWA:([^\s]+)/g), (m) => m[1]);
  return {
    references: [...new Set(candidates.filter((x) => /^[A-Za-z0-9_-]{32}$/.test(x)))],
    invalid: candidates.some((x) => !/^[A-Za-z0-9_-]{32}$/.test(x)),
  };
}
export function shouldMintReference(request: Request) {
  return (
    request.method === "GET" &&
    !/prefetch|prerender/i.test(
      [
        request.headers.get("purpose"),
        request.headers.get("sec-purpose"),
        request.headers.get("x-purpose"),
      ].join(" "),
    )
  );
}
export function companyWhatsappHref(phone: string, text: string) {
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("WA_COMPANY_PHONE_REQUIRED");
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
export function chooseEpisode(
  open: { id: string; propertyId: string | null }[],
  propertyId: string | null,
  invalid: boolean,
) {
  if (invalid) return { inquiryId: null, review: true };
  const matches = propertyId ? open.filter((x) => x.propertyId === propertyId) : open;
  return { inquiryId: matches.length === 1 ? matches[0].id : null, review: matches.length > 1 };
}
