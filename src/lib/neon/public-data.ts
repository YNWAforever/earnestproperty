import { createServerFn } from "@tanstack/react-start";

import type {
  NeonCorridorInventoryInput,
  NeonListingFiltersInput,
  NeonRecentTransactionsInput,
  NeonSimilarListingsInput,
} from "./public-data.types";

export const fetchNeonPublicAgentProfiles = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.listPublicAgentProfiles();
});

export const fetchNeonPublicAgentProfileBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchPublicAgentProfileBySlug(data);
  });

export const fetchNeonBranches = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.listBranches();
});

export const searchNeonListings = createServerFn({ method: "GET" })
  .inputValidator((data: NeonListingFiltersInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    const result = await neonData.searchListings(data);
    return (await import("../media/remote-variants.server")).attachRemoteVariantsToSearch(result);
  });

export const fetchNeonCorridorInventory = createServerFn({ method: "GET" })
  .inputValidator((data: NeonCorridorInventoryInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    const result = await neonData.fetchCorridorInventory(data);
    const { attachRemoteVariants } = await import("../media/remote-variants.server");
    const [saleRows, rentRows] = await Promise.all([
      attachRemoteVariants(result.saleRows),
      attachRemoteVariants(result.rentRows),
    ]);
    return { ...result, saleRows, rentRows };
  });

export const fetchNeonFeaturedProperties = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      limit: number;
      order?: "newest" | "promotion";
      districtSlugs?: string[];
      estateSlugs?: string[];
      textAliases?: string[];
      outOfScopeTextAliases?: string[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return (await import("../media/remote-variants.server")).attachRemoteVariants(
      await neonData.fetchFeaturedProperties(data),
    );
  });

export const fetchNeonListingsForEstate = createServerFn({ method: "GET" })
  .inputValidator((data: { estateSlug: string; limit: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return (await import("../media/remote-variants.server")).attachRemoteVariants(
      await neonData.fetchListingsForEstate(data),
    );
  });

export const fetchNeonListingsForAgent = createServerFn({ method: "GET" })
  .inputValidator((data: { agentId: string; limit: number }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return (await import("../media/remote-variants.server")).attachRemoteVariants(
      await neonData.fetchListingsForAgent(data),
    );
  });

export const fetchNeonPropertyByListingNo = createServerFn({ method: "GET" })
  .inputValidator((data: { listingNo: string }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    const property = await neonData.fetchPropertyByListingNo(data);
    if (!property) return null;
    return (await import("../media/remote-variants.server"))
      .attachRemoteVariants([property])
      .then((rows) => rows[0]);
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
    return (await import("../media/remote-variants.server")).attachRemoteVariants(
      await neonData.fetchSimilarListings(data),
    );
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

export const fetchNeonEstatesBySlugs = createServerFn({ method: "GET" })
  .inputValidator((data: { slugs: string[] }) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchEstatesBySlugs(data);
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

export const fetchNeonRecentTransactions = createServerFn({ method: "GET" })
  .inputValidator((data: NeonRecentTransactionsInput) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchRecentTransactions(data);
  });

export const fetchNeonRecentTransactionsCount = createServerFn({ method: "GET" })
  .inputValidator((data: Omit<NeonRecentTransactionsInput, "limit" | "offset">) => data)
  .handler(async ({ data }) => {
    const neonData = await import("./public-data.server");
    return neonData.fetchRecentTransactionsCount(data);
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

export const fetchNeonEstateDirectory = createServerFn({ method: "GET" }).handler(async () => {
  const neonData = await import("./public-data.server");
  return neonData.fetchEstateDirectory();
});
