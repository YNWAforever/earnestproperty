import "@tanstack/react-start/server-only";

import { queryRows, stringOrEmpty, stringOrNull } from "./db.server";
import { shouldBootstrapFirstAdmin } from "./staff-security-policy";

export type StaffRole = "admin" | "manager" | "agent";

export type StaffAccess = {
  staffId: string;
  authUserId: string;
  email: string | null;
  name: string | null;
  roles: StaffRole[];
  bootstrap: boolean;
};

type StaffLookup = StaffAccess & {
  matchedProfileOnly: boolean;
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

function staffRolesFromValue(value: unknown): StaffRole[] {
  if (Array.isArray(value)) return value.map(String) as StaffRole[];
  if (typeof value !== "string") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value).map(String) as StaffRole[];
    } catch {
      return [];
    }
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((role) => role.replace(/^"|"$/g, "").trim())
      .filter(Boolean) as StaffRole[];
  }
  return [];
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
  // A positive future `exp` is ALWAYS required: a missing/zero/past exp is rejected.
  if (exp === null || exp <= now) return false;
  if (nbf !== null && nbf > now) return false;
  return true;
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

  // Validate issuer/audience when configured (env unset = skip that specific check).
  const expectedIssuer = process.env.NEON_AUTH_ISSUER;
  if (expectedIssuer && payload.iss !== expectedIssuer) return null;
  const expectedAudience = process.env.NEON_AUTH_AUDIENCE;
  if (expectedAudience) {
    const aud = payload.aud;
    const audiences = Array.isArray(aud) ? aud.map(String) : typeof aud === "string" ? [aud] : [];
    if (!audiences.includes(expectedAudience)) return null;
  }

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

async function bootstrapStaffRows() {
  const rows = await queryRows(`
    SELECT
      s.auth_user_id,
      COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    GROUP BY s.id
  `);
  return rows.map((row) => ({
    authUserId: stringOrNull(row.auth_user_id),
    roles: staffRolesFromValue(row.roles),
  }));
}

/**
 * Whether Neon Auth considers this account's email address verified.
 *
 * Load-bearing for the email-match branch in findStaff. staff_users rows are
 * routinely seeded with an email and a blank auth_user_id ("add the colleague,
 * they log in later" -- see saveAdminAgentProfile), and /auth/sign-up is
 * publicly reachable. Without this gate, anyone who knew a not-yet-activated
 * staff address could register it and permanently inherit that row's roles, up
 * to admin.
 *
 * Returns false rather than throwing when the column or row cannot be read:
 * this decides whether to hand out staff roles, so an unreadable answer must
 * fail closed. auth_user_id matches are unaffected -- only first-time binding
 * by email needs the check.
 */
async function isNeonAuthEmailVerified(authUserId: string) {
  try {
    const rows = await queryRows(
      `
      SELECT "emailVerified" AS email_verified
      FROM neon_auth."user"
      WHERE id::text = $1
      LIMIT 1
      `,
      [authUserId],
    );
    return rows[0]?.email_verified === true;
  } catch (error) {
    // Fail closed, but LOUDLY. If neon_auth."user"."emailVerified" is ever
    // absent or renamed, every first-time staff activation by email stops
    // working -- and silently, because the caller just sees "no match" and falls
    // through to the no-staff path. That is indistinguishable from a genuinely
    // unrecognised account, so without this line the cause would be invisible.
    console.error(
      '[auth] Could not read neon_auth."user"."emailVerified"; ' +
        "email-based staff activation is disabled until this is resolved.",
      error,
    );
    return false;
  }
}

async function findStaff(authUserId: string, email: string | null): Promise<StaffLookup | null> {
  const rows = await queryRows(
    `
    SELECT
      s.id,
      s.auth_user_id,
      s.email,
      COALESCE(s.name_zh, s.name_en) AS name,
      COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    WHERE s.active = true
      AND (
        s.auth_user_id = $1
        OR ($2::text IS NOT NULL AND lower(s.email) = lower($2::text) AND s.auth_user_id IS NULL)
      )
    GROUP BY s.id
    LIMIT 1
    `,
    [authUserId, email],
  );
  const row = rows[0];
  if (!row) return null;
  const matchedProfileOnly = stringOrNull(row.auth_user_id) === null;
  if (matchedProfileOnly) {
    // Email verification is checked HERE, not before the query, because it only
    // matters on this branch: matching on auth_user_id is already proof of
    // identity. Checking up-front cost every authenticated admin request an
    // extra serial round-trip for a condition that is false on all but the very
    // first request a staff member ever makes.
    //
    // Without it, /auth/sign-up being public plus staff rows seeded with an
    // email and a blank auth_user_id (saveAdminAgentProfile) meant anyone who
    // knew a not-yet-activated staff address could register it and permanently
    // inherit that row's roles, up to admin.
    if (!(await isNeonAuthEmailVerified(authUserId))) return null;

    await queryRows(
      `
      UPDATE staff_users
      SET auth_user_id = $1, updated_at = now()
      WHERE id = $2
        AND auth_user_id IS NULL
      `,
      [authUserId, row.id],
    ).catch(() => []);
  }
  return {
    staffId: stringOrEmpty(row.id),
    authUserId,
    email: stringOrNull(row.email),
    name: stringOrNull(row.name),
    roles: staffRolesFromValue(row.roles),
    bootstrap: false,
    matchedProfileOnly,
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

// ADMIN_BOOTSTRAP_EMAILS: comma-separated allowlist of emails permitted to become the
// first admin when staff_users is empty. If unset/empty, first-login bootstrap is disabled
// and access stays null (403) until staff are seeded out-of-band.
export function bootstrapAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Owner accounts. An email on ADMIN_BOOTSTRAP_EMAILS cannot have its admin role
 * removed or its account deactivated through the admin UI, by anyone --
 * including another admin.
 *
 * Without this, a second admin could demote the owner and take over the system,
 * and the owner would have no way back in short of SQL against production. The
 * list is env-driven rather than hardcoded so it can hold more than one person
 * and never puts a personal address in shipped source.
 */
export function isProtectedStaffEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return bootstrapAllowlist().has(normalized);
}

export async function requireStaffAccess(request: Request, allowed: StaffRole[] = ["admin"]) {
  const session = await getNeonSessionFromRequest(request);
  if (!session) throw new Response("Unauthorized", { status: 401 });

  const email = session.user.email?.trim().toLowerCase() ?? "";
  const allowlist = bootstrapAllowlist();
  const bootstrapRows = email && allowlist.has(email) ? await bootstrapStaffRows() : [];
  const staff = await findStaff(session.user.id, session.user.email);
  let access: StaffAccess | null = staff;
  if (
    shouldBootstrapFirstAdmin({
      email,
      allowlistedEmails: allowlist,
      access: staff,
      staffRows: bootstrapRows,
    })
  ) {
    access = await bootstrapFirstStaff({
      authUserId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
  }

  if (!access) throw new Response("Forbidden", { status: 403 });
  if (!allowed.some((role) => access.roles.includes(role))) {
    throw new Response("Forbidden", { status: 403 });
  }
  return access;
}
