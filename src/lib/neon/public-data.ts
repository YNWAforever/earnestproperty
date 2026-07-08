import { createServerFn } from "@tanstack/react-start";

import type {
  NeonCorridorInventoryInput,
  NeonListingFiltersInput,
  NeonSimilarListingsInput,
} from "./public-data.types";

export const searchNeonListings = createServerFn({ method: "GET" })
  .inputValidator((data: NeonListingFiltersInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.searchListings(data);
  });

export const fetchNeonCorridorInventory = createServerFn({ method: "GET" })
  .inputValidator((data: NeonCorridorInventoryInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchCorridorInventory(data);
  });

export const fetchNeonFeaturedProperties = createServerFn({ method: "GET" })
  .inputValidator((data: { limit: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchFeaturedProperties(data.limit);
  });

export const fetchNeonListingsForEstate = createServerFn({ method: "GET" })
  .inputValidator((data: { estateSlug: string; limit: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchListingsForEstate(data);
  });

export const fetchNeonPropertyByListingNo = createServerFn({ method: "GET" })
  .inputValidator((data: { listingNo: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchPropertyByListingNo(data);
  });

export const fetchNeonPropertyByLegacyDetailId = createServerFn({ method: "GET" })
  .inputValidator((data: { oldId: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchPropertyByLegacyDetailId(data);
  });

export const fetchNeonSimilarListings = createServerFn({ method: "GET" })
  .inputValidator((data: NeonSimilarListingsInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchSimilarListings(data);
  });

export const fetchNeonListingCountsByEstate = createServerFn({ method: "GET" }).handler(
  async () => {
    const neonData = await import("./public-data.server");
    return neonData.fetchListingCountsByEstate();
  },
);

export const fetchNeonEstateOptions = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.fetchEstateOptions();
});

export const fetchNeonEstates = createServerFn({ method: "GET" })
  .inputValidator((data: { districtSlug?: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchEstates(data);
  });

export const fetchNeonEstateBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchEstateBySlug(data);
  });

export const fetchNeonFaqs = createServerFn({ method: "GET" })
  .inputValidator((data: { scope: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchFaqs(data);
  });

export const fetchNeonCmsVideos = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.fetchCmsVideos();
});

export const fetchNeonDistrictTransactions = createServerFn({ method: "GET" })
  .inputValidator((data: { districtSlug: string; monthsBack: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchDistrictTransactions(data);
  });

export const fetchNeonEstateTransactions = createServerFn({ method: "GET" })
  .inputValidator((data: { estateId: string; limit: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchEstateTransactions(data);
  });

export const fetchNeonPublishedArticles = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.fetchPublishedArticles();
});

export const fetchNeonArticleBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchArticleBySlug(data);
  });
