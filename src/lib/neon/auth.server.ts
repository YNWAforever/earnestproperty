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

export async function getNeonSessionFromRequest(request: Request) {
  const authUrl = process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL;
  if (!authUrl) return null;
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  const res = await fetch(`${authUrl.replace(/\/$/, "")}/get-session`, {
    headers: {
      cookie,
      accept: "application/json",
    },
  }).catch(() => null);

  if (!res?.ok) return null;
  const body = asRecord(await res.json().catch(() => null));
  const data = asRecord(body.data ?? body);
  const user = asRecord(data.user);
  if (!user.id) return null;

  return {
    user: {
      id: stringOrEmpty(user.id),
      email: stringOrNull(user.email),
      name: stringOrNull(user.name),
    },
    session: data.session ?? null,
  };
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
  return {
    staffId: stringOrEmpty(row.id),
    authUserId: stringOrEmpty(row.auth_user_id) || authUserId,
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
