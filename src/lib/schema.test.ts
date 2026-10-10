import { describe, expect, test } from "bun:test";

import { SITE_BRANCHES } from "@/config/site-branches.js";
import { SITE_URL } from "@/content/seo";

import {
  agentPersonSchema,
  branchLocalBusinessSchema,
  jsonLdScript,
  listingOffersSchema,
  organizationSchema,
  residenceSchema,
} from "./schema";

// Behavioural counterpart to schema.test.mjs, which can only regex the source.
// These assert what jsonLdScript actually produces, because the whole point of
// the helper is that its output is inert inside a <script> element.
describe("jsonLdScript", () => {
  test("neutralises a </script> breakout in a string value", () => {
    const payload = { name: "</script><img src=x onerror=alert(1)>" };
    const out = jsonLdScript(payload);

    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("\\u003c");
  });

  test("escapes angle brackets and ampersands wherever they appear", () => {
    const out = jsonLdScript({ a: "<", b: ">", c: "&" });

    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toBe('{"a":"\\u003c","b":"\\u003e","c":"\\u0026"}');
  });

  test("escapes breakouts hidden in object keys, not just values", () => {
    const out = jsonLdScript({ "</script>": 1 });

    expect(out).not.toContain("</script>");
  });

  test("escapes breakouts nested in arrays and sub-objects", () => {
    const out = jsonLdScript({
      "@graph": [{ itemListElement: [{ name: "</script>" }] }],
    });

    expect(out).not.toContain("</script>");
  });

  // The escapes must survive a round-trip: Google's parsers unescape \uXXXX
  // back to the original characters, so structured data still reads correctly.
  test("round-trips to the original value through JSON.parse", () => {
    const payload = {
      name: "深井 <Villa> & 海濱花園",
      description: "</script> should survive as text",
    };

    expect(JSON.parse(jsonLdScript(payload))).toEqual(payload);
  });

  test("produces valid JSON for the shapes the routes actually emit", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", itemListElement: [] },
        { "@type": "RealEstateAgent", name: "晉誠地產 Earnest Property" },
      ],
    };

    expect(() => JSON.parse(jsonLdScript(graph))).not.toThrow();
  });
});

// F-12 (FX-16 Task 3): the JSON-LD builders state only what the data says.
describe("truthful structured data", () => {
  const propertyUrl = `${SITE_URL}/property/R076194`;
  const residenceId = `${propertyUrl}#residence`;

  const roundTrip = (value: unknown) => JSON.parse(jsonLdScript(value)) as Record<string, unknown>;

  test("agent node is a Person; hasCredential appears only with a licence number", () => {
    const base = { name: "代理甲", url: `${SITE_URL}/agents/agent-a` };

    const unlicensed = agentPersonSchema(base);
    expect(unlicensed["@type"]).toBe("Person");
    expect("hasCredential" in unlicensed).toBe(false);
    expect("hasCredential" in agentPersonSchema({ ...base, licenceNo: "   " })).toBe(false);
    expect("hasCredential" in agentPersonSchema({ ...base, licenceNo: null })).toBe(false);

    const licensed = agentPersonSchema({ ...base, licenceNo: "S-123456" });
    expect(licensed["@type"]).toBe("Person");
    expect(licensed.hasCredential).toEqual({
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "license",
      identifier: "S-123456",
      recognizedBy: { "@type": "GovernmentOrganization", name: "地產代理監管局" },
    });
  });

  test("agent image is absolute and telephone is +852 formatted", () => {
    const node = agentPersonSchema({
      name: "代理甲",
      url: `${SITE_URL}/agents/agent-a`,
      image: "/team/agent-a.jpg",
      telephone: "66442444",
    });
    expect(node.image).toBe(`${SITE_URL}/team/agent-a.jpg`);
    expect(node.telephone).toBe("+852 6644 2444");
  });

  test("rent offer carries a monthly UnitPriceSpecification and a sale offer none", () => {
    const [rent] = listingOffersSchema({
      propertyUrl,
      residenceId,
      offerings: [{ deal_type: "rent", price: null, rent: 18000 }],
      fallback: { isRent: true, price: null, rent: 18000 },
    });
    expect(rent.price).toBe(18000);
    expect(rent.priceCurrency).toBe("HKD");
    expect(rent.businessFunction).toBe("http://purl.org/goodrelations/v1#LeaseOut");
    expect(rent.priceSpecification).toEqual({
      "@type": "UnitPriceSpecification",
      price: 18000,
      priceCurrency: "HKD",
      unitCode: "MON",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    });
    expect(JSON.stringify(rent)).not.toContain("unitText");

    const [sale] = listingOffersSchema({
      propertyUrl,
      residenceId,
      offerings: [{ deal_type: "sale", price: 8800000, rent: null }],
      fallback: { isRent: false, price: 8800000, rent: null },
    });
    // Unchanged from the shape the route emitted inline before F-12.
    expect(roundTrip(sale)).toEqual({
      "@type": "Offer",
      price: 8800000,
      priceCurrency: "HKD",
      businessFunction: "http://purl.org/goodrelations/v1#Sell",
      availability: "https://schema.org/InStock",
      url: propertyUrl,
      seller: { "@type": "RealEstateAgent", "@id": `${SITE_URL}/#organization` },
      itemOffered: { "@id": residenceId },
    });

    const soldOut = listingOffersSchema({
      propertyUrl,
      residenceId,
      offerings: [],
      fallback: { isRent: false, price: 8800000, rent: null },
    });
    expect(soldOut).toHaveLength(1);
    expect(soldOut[0].availability).toBe("https://schema.org/SoldOut");
    expect(soldOut[0].price).toBe(8800000);
  });

  type ResidenceInput = Parameters<typeof residenceSchema>[0];
  const residenceInput: ResidenceInput = {
    residenceId,
    propertyUrl,
    name: "香港黃金海岸 2房",
    images: [],
    streetAddress: null,
    districtSlug: "castle-peak-road",
    estate: { name_zh: "香港黃金海岸", lat: null, lng: null },
    saleableArea: null,
    bedrooms: null,
    bathrooms: null,
  };

  test("addressLocality is the district label, never the estate name", () => {
    const node = residenceSchema(residenceInput);
    expect(node.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "青山公路",
      addressRegion: "新界",
      addressCountry: "HK",
    });
    expect(JSON.stringify(node.address)).not.toContain("香港黃金海岸");
    expect(node.containedInPlace).toEqual({ "@type": "ApartmentComplex", name: "香港黃金海岸" });
  });

  test("an unknown district slug omits addressLocality and addressRegion", () => {
    const node = residenceSchema({ ...residenceInput, districtSlug: "青山公路18號" });
    expect(node.address).toEqual({ "@type": "PostalAddress", addressCountry: "HK" });
    const noSlug = residenceSchema({ ...residenceInput, districtSlug: null, estate: null });
    expect(noSlug.address).toEqual({ "@type": "PostalAddress", addressCountry: "HK" });
    expect("containedInPlace" in noSlug).toBe(false);
  });

  test("geo appears only when the estate has both lat and lng", () => {
    const both = residenceSchema({
      ...residenceInput,
      estate: { name_zh: "香港黃金海岸", lat: 22.37, lng: 113.99 },
    });
    expect(both.containedInPlace).toEqual({
      "@type": "ApartmentComplex",
      name: "香港黃金海岸",
      geo: { "@type": "GeoCoordinates", latitude: 22.37, longitude: 113.99 },
    });
    const one = residenceSchema({
      ...residenceInput,
      estate: { name_zh: "香港黃金海岸", lat: 22.37, lng: null },
    });
    expect(JSON.stringify(one)).not.toContain("geo");
  });

  test("no builder emits aggregateRating, review, openingHours, geo or priceRange without a source value", () => {
    const outputs = [
      organizationSchema(),
      agentPersonSchema({
        name: "代理甲",
        url: `${SITE_URL}/agents/agent-a`,
        jobTitle: null,
        telephone: null,
        image: null,
        licenceNo: null,
      }),
      ...listingOffersSchema({
        propertyUrl,
        residenceId,
        offerings: [
          { deal_type: "rent", price: null, rent: null },
          { deal_type: "sale", price: null, rent: null },
        ],
        fallback: { isRent: true, price: null, rent: null },
      }),
      ...listingOffersSchema({
        propertyUrl,
        residenceId,
        offerings: [],
        fallback: { isRent: true, price: null, rent: null },
      }),
      residenceSchema({ ...residenceInput, districtSlug: null, estate: null }),
      residenceSchema(residenceInput),
      branchLocalBusinessSchema({
        id: "x",
        name: "測試分行",
        address: "地址",
        telephone: "26882988",
        addressLocality: "深井",
        areaServed: [],
        image: null,
      }),
    ];
    const forbidden = new Set([
      "aggregateRating",
      "review",
      "openingHours",
      "openingHoursSpecification",
      "geo",
      "priceRange",
    ]);
    const problems: string[] = [];
    const scan = (value: unknown, path: string) => {
      if (value === null || value === "") problems.push(`${path} is empty`);
      if (Array.isArray(value)) {
        if (value.length === 0) problems.push(`${path} is an empty array`);
        value.forEach((item, index) => scan(item, `${path}[${index}]`));
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (forbidden.has(key)) problems.push(`${path}.${key} has no source`);
          scan(child, `${path}.${key}`);
        }
      }
    };
    outputs.forEach((output, index) => scan(roundTrip(output), `#${index}`));
    expect(problems).toEqual([]);
  });

  test("branch nodes carry addressLocality and areaServed from config", () => {
    expect(SITE_BRANCHES.map((branch) => [branch.id, branch.addressLocality])).toEqual([
      ["lido", "深井"],
      ["rhine", "深井"],
      ["hong-kong-garden", "青龍頭"],
    ]);
    // Fact 13: each locality is read off the branch's own address, not invented.
    for (const branch of SITE_BRANCHES) {
      expect(branch.address.startsWith(branch.addressLocality)).toBe(true);
    }

    const lido = branchLocalBusinessSchema({
      id: "lido",
      name: "麗都分行",
      address: "深井麗都花園地下5A舖",
      telephone: "26882988",
      addressLocality: "深井",
      areaServed: ["深井"],
    });
    expect(lido.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "深井麗都花園地下5A舖",
      addressLocality: "深井",
      addressRegion: "新界",
      addressCountry: "HK",
    });
    expect(lido.areaServed).toEqual(["深井"]);

    const rhine = branchLocalBusinessSchema({
      id: "rhine",
      name: "海韻分行",
      address: "深井海韻花園地下G3舖",
      telephone: "26886996",
      addressLocality: "深井",
      areaServed: [],
    });
    expect("areaServed" in rhine).toBe(false);
  });
});
