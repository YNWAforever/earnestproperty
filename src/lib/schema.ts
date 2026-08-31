import { SITE_LOGO_URL, SITE_URL } from "@/content/seo";

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
 * server-rendered, so the payload reaches anonymous visitors, and admin auth is
 * cookie-based with no CSP -- an XSS here escalates an agent-role account to
 * admin.
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
export function organizationSchema() {
  return {
    "@type": "RealEstateAgent",
    name: "晉誠地產 Earnest Property",
    description: "深井．青山公路．汀九物業專家",
    url: SITE_URL,
    logo: SITE_LOGO_URL,
    address: {
      "@type": "PostalAddress",
      streetAddress: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
      addressRegion: "新界",
      addressCountry: "HK",
    },
    areaServed: ["深井 Sham Tseng", "青山公路 Castle Peak Road", "汀九 Ting Kau"],
    identifier: "C-018613",
  };
}

export function agentPersonSchema(input: {
  name: string;
  jobTitle?: string | null;
  telephone?: string | null;
  image?: string | null;
  url: string;
}) {
  return {
    "@type": ["Person", "RealEstateAgent"],
    name: input.name,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
    ...(input.image ? { image: input.image } : {}),
    url: input.url,
    worksFor: { "@type": "RealEstateAgent", name: "晉誠地產 Earnest Property", url: SITE_URL },
  };
}

export function itemListSchema(input: { items: Array<{ url: string; name: string }> }) {
  return {
    "@type": "ItemList",
    itemListElement: input.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: item.url,
      name: item.name,
    })),
  };
}

export function branchLocalBusinessSchema(input: {
  name: string;
  address: string;
  telephone: string;
}) {
  return {
    "@type": "RealEstateAgent",
    name: `晉誠地產 ${input.name}`,
    address: { "@type": "PostalAddress", streetAddress: input.address, addressCountry: "HK" },
    telephone: input.telephone,
    parentOrganization: { "@type": "RealEstateAgent", name: "晉誠地產 Earnest Property" },
  };
}

export function videoObjectSchema(input: {
  name: string;
  description?: string | null;
  embedUrl: string;
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
    embedUrl: input.embedUrl,
    ...(input.uploadDate ? { uploadDate: input.uploadDate } : {}),
  };
}
