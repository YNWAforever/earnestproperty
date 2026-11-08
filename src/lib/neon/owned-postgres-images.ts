/** Fixed local rehearsal pins only. Never select an image from the environment. */
export const PINNED_POSTGRES_17 =
  "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0";
// PostgreSQL 18, linux/amd64; explicitly opt in at the owned-container call site.
export const PINNED_POSTGRES_18 =
  "pgvector/pgvector@sha256:2547711f871f5d4c02b2dfc7ff86f3eddc438d00a23854cd449513f4ef1af79b";

export function isOwnedPostgresImage(
  image: unknown,
): image is typeof PINNED_POSTGRES_17 | typeof PINNED_POSTGRES_18 {
  return image === PINNED_POSTGRES_17 || image === PINNED_POSTGRES_18;
}
