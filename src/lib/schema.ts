import { SITE_CONTACT, SITE_YOUTUBE_CHANNEL } from "@/config/site";
import { SITE_LOGO_URL, SITE_OG_IMAGE, SITE_URL } from "@/content/seo";
import { districtLabelForSlug } from "@/lib/listing-seo";

/**
 * Shared schema.org JSON-LD node builders. Every existing page inlined its own
 * JSON-LD ad hoc (see index.tsx's RealEstateAgent/FAQPage, blog_.$slug.tsx's
 * Article/BreadcrumbList, property.$listingNo.tsx's Offer) -- these builders
 * cover the gaps the audit named: Person/RealEstateAgent on agent pages,
 * ItemList on /agents and /listings, LocalBusiness per branch on /contact,
 * VideoObject on /videos. Callers still render their own
 * `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html:
 * jsonLdScript(...) }} />`, usually wrapping the result in an `@graph`
 * alongside a page-specific BreadcrumbList -- these just return the node.
 */

/**
 * Serialise a value for embedding inside `<script type="application/ld+json">`.
 *
 * Bare `JSON.stringify` is NOT safe here. `dangerouslySetInnerHTML` bypasses
 * React's escaping entirely, and JSON.stringify escapes neither `<` nor `/`, so
 * any string reaching the graph that contains `</script>` closes the element
 * early and everything after it is parsed as HTML. The values are not
 * hypothetical: listing title_zh/address/description come from the admin CMS and
 * from the scraped legacy site (src/lib/mls/), FAQ and article bodies come from
 * the CMS, and agent names/job titles come from staff profiles. Pages are
 * server-rendered, so the payload reaches anonymous visitors, and staff auth is
 * a bearer token held by the admin client; the site's CSP is report-only until
 * FX-14's follow-up enforces it -- an XSS here escalates an agent-role account
 * to admin.
 *
 * Escaping `<` and `>` as </> is valid JSON and valid JSON-LD (the
 * parser unescapes them back to the original characters), so consumers such as
 * Google's Rich Results test see the intended values. `&` is escaped too so the
 * output cannot be reinterpreted through HTML entity decoding.
 */
export function jsonLdScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * P7a: the sitewide Organization/RealEstateAgent identity, rendered once in
 * __root.tsx (gated to public pages) rather than only on the homepage. Fields
 * reproduced exactly from index.tsx's former inline block -- not
 * re-derived, since address/areaServed/identifier are real facts, not
 * boilerplate to paraphrase.
 */
/**
 * Stable node id for the business. Every other node that mentions the company
 * (Article publisher, Person worksFor, branch parentOrganization, listing
 * seller) references this id instead of re-declaring an inline Organization,
 * so a parser sees one entity rather than four competing ones on /contact.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export function organizationRef() {
  return { "@type": "RealEstateAgent", "@id": ORGANIZATION_ID } as const;
}

/**
 * Hong Kong landline/mobile digits ("26882988") to the E.164-style form schema
 * consumers expect ("+852 2688 2988"). Anything that isn't 8 bare digits is
 * passed through unchanged so an already-formatted value is never mangled.
 */
export function formatHkTelephone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return `+852 ${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length === 11 && digits.startsWith("852")) {
    return `+852 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return value;
}

export function organizationSchema() {
  const telephone = formatHkTelephone(SITE_CONTACT.phoneTel || SITE_CONTACT.phoneDisplay);
  return {
    "@type": "RealEstateAgent",
    "@id": ORGANIZATION_ID,
    name: "晉誠地產 Earnest Property",
    alternateName: "Earnest Property",
    description: "深井．青山公路．汀九物業專家",
    url: SITE_URL,
    logo: SITE_LOGO_URL,
    image: SITE_OG_IMAGE,
    ...(telephone ? { telephone } : {}),
    email: SITE_CONTACT.email,
    sameAs: [SITE_YOUTUBE_CHANNEL.url],
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE_CONTACT.address,
      addressLocality: "深井",
      addressRegion: "新界",
      addressCountry: "HK",
    },
    areaServed: ["深井 Sham Tseng", "青山公路 Castle Peak Road", "汀九 Ting Kau"],
    // EAA licence number. Kept as the bare string (not a PropertyValue) because
    // that is the form Google's Rich Results test reads without complaint.
    identifier: "C-018613",
  };
}

/**
 * F-12: an individual agent is a `Person` who works for the agency. The old
 * Person-plus-RealEstateAgent multi-type made each agent a LocalBusiness
 * with no address or hours of its own. The EAA licence is stated only when the
 * profile has one -- the page prints the same value as 牌照.
 */
export function agentPersonSchema(input: {
  name: string;
  jobTitle?: string | null;
  telephone?: string | null;
  image?: string | null;
  url: string;
  licenceNo?: string | null;
}) {
  const telephone = formatHkTelephone(input.telephone);
  const licenceNo = input.licenceNo?.trim();
  return {
    "@type": "Person" as const,
    name: input.name,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    ...(telephone ? { telephone } : {}),
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
    url: input.url,
    "@id": input.url,
    worksFor: organizationRef(),
    ...(licenceNo
      ? {
          hasCredential: {
            "@type": "EducationalOccupationalCredential" as const,
            credentialCategory: "license" as const,
            identifier: licenceNo,
            recognizedBy: {
              "@type": "GovernmentOrganization" as const,
              name: "地產代理監管局" as const,
            },
          },
        }
      : {}),
  };
}

export function itemListSchema(input: {
  items: Array<{ url: string; name: string; image?: string | null }>;
  numberOfItems?: number;
}) {
  return {
    "@type": "ItemList",
    numberOfItems: input.numberOfItems ?? input.items.length,
    itemListElement: input.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: item.url,
      name: item.name,
      ...(item.image ? { image: item.image } : {}),
    })),
  };
}

export function branchLocalBusinessSchema(input: {
  id: string;
  name: string;
  address: string;
  telephone: string;
  /** The locality named in the branch's own address (site-branches.js). */
  addressLocality: string;
  /** District labels the branch covers; omitted when empty. */
  areaServed?: string[] | null;
  image?: string | null;
}) {
  return {
    "@type": "RealEstateAgent",
    "@id": `${SITE_URL}/contact#branch-${input.id}`,
    name: `晉誠地產 ${input.name}`,
    url: `${SITE_URL}/contact`,
    address: {
      "@type": "PostalAddress",
      streetAddress: input.address,
      addressLocality: input.addressLocality,
      addressRegion: "新界",
      addressCountry: "HK",
    },
    telephone: formatHkTelephone(input.telephone) ?? input.telephone,
    ...(input.areaServed?.length ? { areaServed: input.areaServed } : {}),
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
    parentOrganization: organizationRef(),
  };
}

const LEASE_OUT = "http://purl.org/goodrelations/v1#LeaseOut";
const SELL = "http://purl.org/goodrelations/v1#Sell";

/** A positive price, or null. `Number(null) || null` keeps 0 and NaN out. */
function offerPrice(value: number | string | null | undefined): number | null {
  return Number(value) || null;
}

/**
 * The listing's `Offer` nodes. Sale offers keep the shape the route emitted
 * before F-12. A rent offer also states that its price is per month, through a
 * `UnitPriceSpecification` with the UN/CEFACT code `MON` in `unitCode`, which
 * is the property schema.org documents for that code. A sold or rented listing
 * has no active offering, so its last known deal is described as SoldOut
 * rather than emitting `offers: []`, which is invalid.
 */
export function listingOffersSchema(input: {
  propertyUrl: string;
  residenceId: string;
  offerings: Array<{ deal_type: "sale" | "rent"; price: number | null; rent: number | null }>;
  fallback: { isRent: boolean; price: number | null; rent: number | null };
}): Array<Record<string, unknown>> {
  const common = {
    url: input.propertyUrl,
    seller: organizationRef(),
    itemOffered: { "@id": input.residenceId },
  };
  if (!input.offerings.length) {
    const price = offerPrice(input.fallback.isRent ? input.fallback.rent : input.fallback.price);
    return [
      {
        "@type": "Offer",
        ...(price ? { price } : {}),
        priceCurrency: "HKD",
        availability: "https://schema.org/SoldOut",
        ...common,
      },
    ];
  }
  return input.offerings.map((offer) => {
    const isRent = offer.deal_type === "rent";
    const price = offerPrice(isRent ? offer.rent : offer.price);
    return {
      "@type": "Offer",
      ...(price ? { price } : {}),
      priceCurrency: "HKD",
      ...(isRent && price
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price,
              priceCurrency: "HKD",
              unitCode: "MON",
              referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
            },
          }
        : {}),
      businessFunction: isRent ? LEASE_OUT : SELL,
      availability: "https://schema.org/InStock",
      ...common,
    };
  });
}

/**
 * The listing's `Residence` node. `addressLocality` is the district (深井,
 * 青山公路 ...) from the listing's district slug, never the estate name; an
 * unrecognised slug omits the locality and the region rather than printing an
 * address fragment. The estate is the `ApartmentComplex` the flat is part of,
 * with coordinates only when the estate row has both.
 */
export function residenceSchema(input: {
  residenceId: string;
  propertyUrl: string;
  name: string;
  images: string[];
  streetAddress: string | null;
  districtSlug: string | null;
  estate: { name_zh: string; lat: number | null; lng: number | null } | null;
  saleableArea: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}): Record<string, unknown> {
  const locality = districtLabelForSlug(input.districtSlug);
  const estate = input.estate;
  const hasGeo = estate !== null && Number.isFinite(estate.lat) && Number.isFinite(estate.lng);
  return {
    "@type": "Residence",
    "@id": input.residenceId,
    name: input.name,
    url: input.propertyUrl,
    ...(input.images.length ? { image: input.images } : {}),
    address: {
      "@type": "PostalAddress",
      ...(input.streetAddress ? { streetAddress: input.streetAddress } : {}),
      // Every slug districtLabelForSlug recognises is in the New Territories.
      ...(locality ? { addressLocality: locality, addressRegion: "新界" } : {}),
      addressCountry: "HK",
    },
    ...(estate?.name_zh
      ? {
          containedInPlace: {
            "@type": "ApartmentComplex",
            name: estate.name_zh,
            ...(hasGeo
              ? { geo: { "@type": "GeoCoordinates", latitude: estate.lat, longitude: estate.lng } }
              : {}),
          },
        }
      : {}),
    ...(input.saleableArea
      ? {
          floorSize: { "@type": "QuantitativeValue", value: input.saleableArea, unitCode: "FTK" },
        }
      : {}),
    ...(input.bedrooms != null ? { numberOfRooms: input.bedrooms } : {}),
    ...(input.bathrooms != null ? { numberOfBathroomsTotal: input.bathrooms } : {}),
  };
}

export function videoObjectSchema(input: {
  name: string;
  description?: string | null;
  embedUrl: string;
  // Required by Google's VideoObject guidelines. Callers derive it from the
  // YouTube id (getYouTubeThumbnailUrl), which exists for every upload.
  thumbnailUrl: string;
  contentUrl?: string | null;
  // Neither CmsVideo nor VideoListing know the video's real upload date (this
  // repo only embeds existing YouTube videos, it doesn't own their metadata).
  // Google's VideoObject guidelines want an uploadDate; rather than fabricate
  // one, pass the CMS row's created_at where available (it's a real
  // timestamp, just "when this entry was added here", not "when filmed") and
  // omit the field entirely otherwise.
  uploadDate?: string | null;
}) {
  return {
    "@type": "VideoObject",
    name: input.name,
    description: input.description || input.name,
    thumbnailUrl: input.thumbnailUrl,
    embedUrl: input.embedUrl,
    ...(input.contentUrl ? { contentUrl: input.contentUrl } : {}),
    ...(input.uploadDate ? { uploadDate: input.uploadDate } : {}),
    publisher: organizationRef(),
  };
}

/**
 * Article node for blog posts. `image` and `dateModified` are what Google's
 * Article rich result requires beyond headline/date; the publisher carries a
 * logo and both author and publisher resolve to the sitewide Organization.
 */
export function articleSchema(input: {
  url: string;
  headline: string;
  description?: string | null;
  image?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
  authorName?: string | null;
  articleSection?: string | null;
}) {
  const image = input.image
    ? input.image.startsWith("http")
      ? input.image
      : `${SITE_URL}${input.image}`
    : SITE_OG_IMAGE;
  return {
    "@type": "Article",
    "@id": `${input.url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    headline: input.headline,
    ...(input.description ? { description: input.description } : {}),
    image: [image],
    inLanguage: "zh-HK",
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    dateModified: input.dateModified ?? input.datePublished ?? undefined,
    ...(input.articleSection ? { articleSection: input.articleSection } : {}),
    author: input.authorName
      ? { "@type": "Organization", name: input.authorName, url: SITE_URL, "@id": ORGANIZATION_ID }
      : organizationRef(),
    publisher: {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "晉誠地產 Earnest Property",
      logo: { "@type": "ImageObject", url: SITE_LOGO_URL },
    },
  };
}

/** Absolute URL for a possibly site-relative asset path. */
export function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
