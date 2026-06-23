import "@tanstack/react-start/server-only";

import { queryRows, stringOrEmpty, stringOrNull } from "./db.server";

export type StaffRole = "admin" | "manager" | "agent";

export type StaffAccess = {
  staffId: string;
  authUserId: string;
  email: string | null;
  name: string | null;
  roles: StaffRole[];
  bootstrap: boolean;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function getAuthBaseUrl() {
  return process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL || null;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function claimAsString(payload: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function base64UrlToJson(value: string) {
  return asRecord(JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))));
}

function isTokenTimeValid(payload: AnyRecord) {
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : null;
  return (!exp || exp > now) && (!nbf || nbf <= now);
}

async function listNeonAuthJwks() {
  const rows = await queryRows(
    `
    SELECT "publicKey"
    FROM neon_auth.jwks
    WHERE "expiresAt" IS NULL OR "expiresAt" > now()
    ORDER BY "createdAt" DESC
    `,
  ).catch(() => []);
  return rows
    .map((row) => {
      if (typeof row.publicKey !== "string") return null;
      return JSON.parse(row.publicKey) as JsonWebKey;
    })
    .filter((jwk): jwk is JsonWebKey => Boolean(jwk));
}

async function verifyNeonJwt(token: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const header = base64UrlToJson(encodedHeader);
  if (header.alg !== "EdDSA") return null;

  const payload = base64UrlToJson(encodedPayload);
  if (!isTokenTimeValid(payload)) return null;

  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  for (const jwk of await listNeonAuthJwks()) {
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") continue;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
    if (await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signedData)) {
      return payload;
    }
  }

  return null;
}

async function findNeonAuthUser(authUserId: string) {
  const rows = await queryRows(
    `
    SELECT id::text AS id, email, name
    FROM neon_auth."user"
    WHERE id::text = $1
    LIMIT 1
    `,
    [authUserId],
  ).catch(() => []);
  return rows[0] ?? null;
}

async function findNeonAuthSession(token: string) {
  const rows = await queryRows(
    `
    SELECT u.id::text AS id, u.email, u.name
    FROM neon_auth.session s
    INNER JOIN neon_auth."user" u ON u.id = s."userId"
    WHERE s.token = $1
      AND s."expiresAt" > now()
    LIMIT 1
    `,
    [token],
  ).catch(() => []);
  return rows[0] ?? null;
}

async function getNeonSessionFromBearerToken(token: string) {
  const payload = await verifyNeonJwt(token).catch(() => null);
  if (!payload) {
    const authSession = await findNeonAuthSession(token);
    if (!authSession?.id) return null;

    return {
      user: {
        id: stringOrEmpty(authSession.id),
        email: stringOrNull(authSession.email),
        name: stringOrNull(authSession.name),
      },
      session: { token },
    };
  }

  const authUserId = claimAsString(payload, ["sub", "userId", "user_id", "id"]);
  if (!authUserId) return null;

  const authUser = await findNeonAuthUser(authUserId);
  const email = stringOrNull(authUser?.email) ?? claimAsString(payload, ["email"]);
  const name = stringOrNull(authUser?.name) ?? claimAsString(payload, ["name"]);

  return {
    user: {
      id: authUserId,
      email,
      name,
    },
    session: { token },
  };
}

export async function getNeonSessionFromRequest(request: Request) {
  const authUrl = getAuthBaseUrl();
  if (!authUrl) return null;
  const cookie = request.headers.get("cookie");
  const bearerToken = getBearerToken(request);

  if (cookie) {
    const res = await fetch(`${authUrl.replace(/\/$/, "")}/get-session`, {
      headers: {
        cookie,
        accept: "application/json",
      },
    }).catch(() => null);

    if (res?.ok) {
      const body = asRecord(await res.json().catch(() => null));
      const data = asRecord(body.data ?? body);
      const user = asRecord(data.user);
      if (user.id) {
        return {
          user: {
            id: stringOrEmpty(user.id),
            email: stringOrNull(user.email),
            name: stringOrNull(user.name),
          },
          session: data.session ?? null,
        };
      }
    }
  }

  return bearerToken ? getNeonSessionFromBearerToken(bearerToken) : null;
}

async function staffCount() {
  const rows = await queryRows("SELECT count(*)::int AS total FROM staff_users");
  return Number(rows[0]?.total ?? 0);
}

async function findStaff(authUserId: string, email: string | null): Promise<StaffAccess | null> {
  const rows = await queryRows(
    `
    SELECT
      s.id,
      s.auth_user_id,
      s.email,
      COALESCE(s.name_zh, s.name_en) AS name,
      COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}'::staff_role[]) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    WHERE s.active = true
      AND (s.auth_user_id = $1 OR ($2::text IS NOT NULL AND lower(s.email) = lower($2::text)))
    GROUP BY s.id
    LIMIT 1
    `,
    [authUserId, email],
  );
  const row = rows[0];
  if (!row) return null;
  if (stringOrEmpty(row.auth_user_id) !== authUserId) {
    await queryRows(
      `
      UPDATE staff_users
      SET auth_user_id = $1, updated_at = now()
      WHERE id = $2
        AND (auth_user_id IS NULL OR auth_user_id <> $1)
      `,
      [authUserId, row.id],
    ).catch(() => []);
  }
  return {
    staffId: stringOrEmpty(row.id),
    authUserId,
    email: stringOrNull(row.email),
    name: stringOrNull(row.name),
    roles: Array.isArray(row.roles) ? (row.roles.map(String) as StaffRole[]) : [],
    bootstrap: false,
  };
}

async function bootstrapFirstStaff(input: {
  authUserId: string;
  email: string | null;
  name: string | null;
}): Promise<StaffAccess> {
  const rows = await queryRows(
    `
    INSERT INTO staff_users (auth_user_id, email, name_en, active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (auth_user_id) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, staff_users.email),
      updated_at = now()
    RETURNING id, auth_user_id, email, COALESCE(name_zh, name_en) AS name
    `,
    [input.authUserId, input.email, input.name],
  );
  const staff = rows[0];
  await queryRows(
    `
    INSERT INTO staff_roles (staff_user_id, role)
    VALUES ($1, 'admin')
    ON CONFLICT DO NOTHING
    `,
    [staff.id],
  );
  return {
    staffId: stringOrEmpty(staff.id),
    authUserId: stringOrEmpty(staff.auth_user_id),
    email: stringOrNull(staff.email),
    name: stringOrNull(staff.name),
    roles: ["admin"],
    bootstrap: true,
  };
}

export async function requireStaffAccess(request: Request, allowed: StaffRole[] = ["admin"]) {
  const session = await getNeonSessionFromRequest(request);
  if (!session) throw new Response("Unauthorized", { status: 401 });

  const staff = await findStaff(session.user.id, session.user.email);
  const access =
    staff ??
    ((await staffCount()) === 0
      ? await bootstrapFirstStaff({
          authUserId: session.user.id,
          email: session.user.email,
          name: session.user.name,
        })
      : null);

  if (!access) throw new Response("Forbidden", { status: 403 });
  if (!allowed.some((role) => access.roles.includes(role))) {
    throw new Response("Forbidden", { status: 403 });
  }
  return access;
}
