export function visibleCategoryChips(
  videos: ReadonlyArray<{ category?: string | null }>,
  categories: ReadonlyArray<string>,
  selected: string | undefined,
): Array<{ category: string; count: number }>;
