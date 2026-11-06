export type BlogErrorCode =
  | "BLOG_VALIDATION"
  | "BLOG_REVISION_CONFLICT"
  | "BLOG_SLUG_LOCKED"
  | "BLOG_IDEMPOTENCY_CONFLICT"
  | "BLOG_FEATURE_INELIGIBLE"
  | "BLOG_NOT_FOUND"
  | "BLOG_FORBIDDEN"
  | "BLOG_UNAVAILABLE";
export class BlogRepositoryError extends Error {
  code: BlogErrorCode;
  status: number;
  constructor(code: BlogErrorCode, status: number) {
    super(code);
    this.name = "BlogRepositoryError";
    this.code = code;
    this.status = status;
  }
}
export function blogError(error: unknown): never {
  if (error instanceof BlogRepositoryError || error instanceof Response) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/IDEMPOTENCY/.test(message)) throw new BlogRepositoryError("BLOG_IDEMPOTENCY_CONFLICT", 409);
  if (/CONFLICT/.test(message)) throw new BlogRepositoryError("BLOG_REVISION_CONFLICT", 409);
  if (/SLUG_LOCKED/.test(message)) throw new BlogRepositoryError("BLOG_SLUG_LOCKED", 409);
  if (/INELIGIBLE/.test(message)) throw new BlogRepositoryError("BLOG_FEATURE_INELIGIBLE", 422);
  if (/FORBIDDEN/.test(message)) throw new BlogRepositoryError("BLOG_FORBIDDEN", 403);
  if (/NOT_FOUND/.test(message)) throw new BlogRepositoryError("BLOG_NOT_FOUND", 404);
  if (/VALIDATION|RESERVED/.test(message) || (error as { code?: string })?.code?.match(/^(22|23)/))
    throw new BlogRepositoryError("BLOG_VALIDATION", 422);
  throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
}
export function parseBlog<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new BlogRepositoryError("BLOG_VALIDATION", 422);
  }
}
