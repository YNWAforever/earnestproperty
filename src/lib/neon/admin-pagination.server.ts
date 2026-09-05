import type { StaffAccess } from "./auth.server";
import { queryRows } from "./db.server";
import {
  finishAdminPage,
  type AdminPageInput,
  type AdminPageResource,
  type AdminPageRows,
  type CursorPage,
} from "./admin-pagination";
import { buildAdminPageQuery } from "./admin-pagination-query";
export { buildAdminPageQuery } from "./admin-pagination-query";
export async function readAdminPage<R extends AdminPageResource>(
  input: AdminPageInput & { resource: R },
  actor: StaffAccess,
): Promise<CursorPage<AdminPageRows[R]>> {
  const query = buildAdminPageQuery(input, actor);
  const [result] = await queryRows(query.statement, query.params);
  const rows = (result?.rows ?? []) as Array<{ id: string; _cursor_at: string }>;
  const page = finishAdminPage(rows, query.input.limit, query.binding, Number(result?.total ?? 0));
  // Newer pages advance from their last ascending row; initial/older pages expose their newest edge.
  if (query.ascending)
    page.newestCursor = rows.length
      ? finishAdminPage(
          rows.slice(0, query.input.limit).reverse(),
          query.input.limit,
          query.binding,
          0,
        ).newestCursor
      : null;
  return page as unknown as CursorPage<AdminPageRows[R]>;
}
