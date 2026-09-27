export function classifyWebsiteCoverage(row) {
  const candidateCount = Number(row.candidateCount ?? 0);
  return {
    propertyId: String(row.propertyId),
    publicListingNo: String(row.publicListingNo),
    dealType: row.dealType,
    status: candidateCount > 1 ? "conflicted" : candidateCount === 1 ? "covered" : "missing",
    code: candidateCount === 1 && row.code ? String(row.code) : null,
  };
}

export function summarizeWebsiteCoverage(rows) {
  return {
    eligibleOffers: rows.length,
    coveredOffers: rows.filter((row) => row.status === "covered").length,
    missingOffers: rows.filter((row) => row.status === "missing").length,
    conflictedOffers: rows.filter((row) => row.status === "conflicted").length,
  };
}
