import "@tanstack/react-start/server-only";

import type { StaffAccess, StaffRole } from "./auth.server.ts";
import { queryRows, type DbRow } from "./db.server.ts";
import type {
  AdminTeamFilterState,
  AdminTeamInvitationState,
  AdminTeamList,
  AdminTeamListInput,
  AdminTeamMember,
  AdminTeamMemberDetail,
} from "./admin-team.types.ts";

type QueryRows = <T extends DbRow = DbRow>(statement: string, params?: unknown[]) => Promise<T[]>;
type Cursor = { createdAt: string; id: string };
type FetchStaffAccessSummary = (
  input: { staffId: string },
  actor: StaffAccess,
) => Promise<{
  owned: Record<string, number>;
  ownedTotal: number;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staffRoles = new Set<StaffRole>(["admin", "manager", "agent"]);
const filterStates = new Set<AdminTeamFilterState>(["active", "suspended", "invited", "attention"]);
const actionTypes = new Set([
  "invite",
  "resend_invitation",
  "password_reset",
  "session_revocation",
]);
const actionStates = new Set(["pending", "succeeded", "retryable_failure", "terminal_failure"]);
const base64urlPattern = /^[A-Za-z0-9_-]+$/;

// Internal lifecycle orchestration needs only these safe local identity fields.
// Keep this mapper here so staff-lifecycle never grows a second, incompatible
// Team-row interpretation or reaches credential/provider tables.
export function staffLifecycleMemberFromRow(row: Record<string, unknown> | undefined) {
  if (!row || typeof row.id !== "string" || !uuidPattern.test(row.id)) return null;
  if (typeof row.email !== "string" || !row.email.trim()) return null;
  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    authUserId:
      typeof row.auth_user_id === "string" && row.auth_user_id.trim() ? row.auth_user_id : null,
    active: row.active === true,
  };
}

function invalid(message = "Invalid Team query."): never {
  throw new Response(message, { status: 400 });
}

function dateString(value: unknown) {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function requiredDate(value: unknown) {
  return dateString(value) ?? invalid("Invalid Team timestamp.");
}

function safeRoles(value: unknown): StaffRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (role): role is StaffRole => typeof role === "string" && staffRoles.has(role as StaffRole),
  );
}

function safeAction(value: unknown) {
  return typeof value === "string" && actionTypes.has(value) ? value : null;
}

function safeActionState(value: unknown) {
  return typeof value === "string" && actionStates.has(value) ? value : null;
}

function safeErrorCode(value: unknown) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : null;
}

export function encodeAdminTeamCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function isRealUtcMicrosecondTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

export function decodeAdminTeamCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    if (!base64urlPattern.test(cursor)) return invalid("Invalid Team cursor.");
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== cursor) {
      return invalid("Invalid Team cursor.");
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      !isRealUtcMicrosecondTimestamp(parsed.createdAt) ||
      typeof parsed.id !== "string" ||
      !uuidPattern.test(parsed.id)
    ) {
      return invalid("Invalid Team cursor.");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return invalid("Invalid Team cursor.");
  }
}

function normalizedInput(input: AdminTeamListInput) {
  const q = input.q?.trim().toLowerCase();
  if (q && q.length > 200) invalid();
  if (input.role && !staffRoles.has(input.role)) invalid();
  if (input.state && !filterStates.has(input.state)) invalid();
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
  return {
    q: q || null,
    role: input.role ?? null,
    state: input.state ?? null,
    cursor: decodeAdminTeamCursor(input.cursor),
    limit,
  };
}

function invitationState(input: {
  action: string | null;
  state: string | null;
  expiresAt: string | null;
}): AdminTeamInvitationState {
  if (input.action !== "invite" && input.action !== "resend_invitation") return "none";
  if (input.state === "pending") return "pending";
  if (input.state === "retryable_failure" || input.state === "terminal_failure") return "failed";
  if (input.expiresAt && new Date(input.expiresAt).valueOf() <= Date.now()) return "expired";
  return "sent";
}

function memberFromRow(row: Record<string, unknown>): AdminTeamMember {
  const expiresAt = dateString(row.latest_provider_expires_at);
  const action = safeAction(row.latest_action);
  const state = safeActionState(row.latest_action_state);
  const stateLabel = invitationState({ action, state, expiresAt });
  return {
    id:
      typeof row.id === "string" && uuidPattern.test(row.id)
        ? row.id
        : invalid("Invalid Team member."),
    name: typeof row.name === "string" ? row.name.trim() || null : null,
    email: typeof row.email === "string" ? row.email : null,
    roles: safeRoles(row.roles),
    accessState: row.active === true ? "active" : "suspended",
    invitationState: stateLabel,
    invitationRetryAfter: dateString(row.latest_retry_after),
    invitationExpiresAt: expiresAt,
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
    needsAttention:
      state === "retryable_failure" || state === "terminal_failure" || stateLabel === "expired",
  };
}

const latestActionSql = `
  LEFT JOIN LATERAL (
    SELECT action, state, safe_error_code, retry_after, provider_expires_at
    FROM staff_identity_actions
    WHERE target_staff_id = s.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) latest_action ON TRUE`;

export function createAdminTeamReadModel(
  dependencies: {
    queryRows?: QueryRows;
    fetchStaffAccessSummary?: FetchStaffAccessSummary;
  } = {},
) {
  const runQuery = dependencies.queryRows ?? queryRows;
  const readAccess = dependencies.fetchStaffAccessSummary;

  return {
    async listAdminTeam(input: AdminTeamListInput, _actor: StaffAccess): Promise<AdminTeamList> {
      const filter = normalizedInput(input);
      const rows = await runQuery<Record<string, unknown>>(
        `WITH team_base AS (
           SELECT s.id::text AS id,
                  COALESCE(NULLIF(s.name_zh, ''), NULLIF(s.name_en, '')) AS name,
                  s.email,
                  s.active,
                  s.created_at,
                  s.updated_at,
                  to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
                  COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles,
                  latest_action.action AS latest_action,
                  latest_action.state AS latest_action_state,
                  latest_action.retry_after AS latest_retry_after,
                  latest_action.provider_expires_at AS latest_provider_expires_at
             FROM staff_users s
             LEFT JOIN staff_roles r ON r.staff_user_id = s.id
             ${latestActionSql}
            WHERE ($1::text IS NULL
                    OR COALESCE(NULLIF(s.name_zh, ''), NULLIF(s.name_en, '')) ILIKE '%' || $1 || '%'
                    OR s.email ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR EXISTS (
                    SELECT 1 FROM staff_roles team_role
                    WHERE team_role.staff_user_id = s.id AND team_role.role = $2
                  ))
              AND ($3::text IS NULL
                    OR ($3 = 'active' AND s.active = true)
                    OR ($3 = 'suspended' AND s.active = false)
                    OR ($3 = 'invited' AND latest_action.action IN ('invite', 'resend_invitation')
                        AND latest_action.state IN ('pending', 'succeeded'))
                    OR ($3 = 'attention' AND (
                         latest_action.state IN ('retryable_failure', 'terminal_failure')
                         OR (latest_action.action IN ('invite', 'resend_invitation')
                             AND latest_action.provider_expires_at <= now())
                       )))
              AND ($4::timestamptz IS NULL OR (s.created_at, s.id) < ($4::timestamptz, $5::uuid))
            GROUP BY s.id, latest_action.action, latest_action.state, latest_action.retry_after,
                     latest_action.provider_expires_at
         ), team_counts AS (
           SELECT COUNT(*) FILTER (WHERE active) AS active_count,
                  COUNT(*) FILTER (WHERE NOT active) AS suspended_count,
                  COUNT(*) FILTER (WHERE latest_action IN ('invite', 'resend_invitation')
                                   AND latest_action_state IN ('pending', 'succeeded')) AS invited_count,
                  COUNT(*) FILTER (WHERE latest_action_state IN ('retryable_failure', 'terminal_failure')
                                   OR (latest_action IN ('invite', 'resend_invitation')
                                       AND latest_provider_expires_at <= now())) AS attention_count
           FROM team_base
         ), team_page AS (
           SELECT * FROM team_base
           ORDER BY created_at DESC, id DESC
           LIMIT $6
         )
         SELECT team_page.*, team_counts.active_count, team_counts.invited_count,
                team_counts.suspended_count, team_counts.attention_count
         FROM team_counts
         LEFT JOIN team_page ON TRUE
         ORDER BY team_page.created_at DESC NULLS LAST, team_page.id DESC NULLS LAST`,
        [
          filter.q,
          filter.role,
          filter.state,
          filter.cursor?.createdAt ?? null,
          filter.cursor?.id ?? null,
          filter.limit + 1,
        ],
      );
      const sourceRows = rows.filter((row) => typeof row.id === "string");
      const page = sourceRows.slice(0, filter.limit);
      const countsRow = rows[0] ?? {};
      const count = (value: unknown) =>
        Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
      const last = page.at(-1);
      return {
        members: page.map(memberFromRow),
        counts: {
          active: count(countsRow.active_count),
          invited: count(countsRow.invited_count),
          suspended: count(countsRow.suspended_count),
          attention: count(countsRow.attention_count),
        },
        nextCursor:
          sourceRows.length > filter.limit &&
          last &&
          typeof last.created_at_cursor === "string" &&
          typeof last.id === "string"
            ? encodeAdminTeamCursor({ createdAt: last.created_at_cursor, id: last.id })
            : null,
      };
    },

    async getAdminTeamMember(
      input: { staffId: string },
      actor: StaffAccess,
    ): Promise<AdminTeamMemberDetail> {
      if (!uuidPattern.test(input.staffId)) invalid("Invalid Team member.");
      const rows = await runQuery<Record<string, unknown>>(
        `SELECT s.id::text AS id,
                COALESCE(NULLIF(s.name_zh, ''), NULLIF(s.name_en, '')) AS name,
                s.email, s.auth_user_id, s.active, s.created_at, s.updated_at,
                COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles,
                latest_action.action AS latest_action, latest_action.state AS latest_action_state,
                latest_action.safe_error_code AS latest_safe_error_code,
                latest_action.retry_after AS latest_retry_after,
                latest_action.provider_expires_at AS latest_provider_expires_at,
                COALESCE((
                  SELECT json_agg(activity ORDER BY activity.created_at DESC, activity.id DESC)
                  FROM (
                    SELECT id::text AS id, action, outcome, created_at
                    FROM ops_audit_logs
                    WHERE resource_id = s.id::text
                    ORDER BY created_at DESC, id DESC
                    LIMIT 10
                  ) activity
                ), '[]'::json) AS activity
           FROM staff_users s
           LEFT JOIN staff_roles r ON r.staff_user_id = s.id
           ${latestActionSql}
          WHERE s.id = $1::uuid
          GROUP BY s.id, latest_action.action, latest_action.state, latest_action.safe_error_code,
                   latest_action.retry_after, latest_action.provider_expires_at`,
        [input.staffId],
      );
      const row = rows[0];
      if (!row) throw new Response("Team member not found.", { status: 404 });
      const member = memberFromRow(row);
      const access = readAccess
        ? await readAccess({ staffId: input.staffId }, actor)
        : await (
            await import("./admin-data.server.ts")
          ).fetchStaffAccessSummary({ staffId: input.staffId }, actor);
      const rawActivity = Array.isArray(row.activity) ? row.activity : [];
      const recentActivity = rawActivity
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : "",
          action: typeof item.action === "string" ? item.action.slice(0, 100) : "",
          outcome: typeof item.outcome === "string" ? item.outcome.slice(0, 30) : "",
          createdAt: dateString(item.createdAt ?? item.created_at) ?? "",
        }))
        .filter((item) => item.id && item.action && item.outcome && item.createdAt);
      return {
        member,
        identity: {
          authUserLinked: typeof row.auth_user_id === "string" && row.auth_user_id.length > 0,
        },
        ownership: { counts: access.owned, total: access.ownedTotal },
        latestOperation: {
          action: safeAction(
            row.latest_action,
          ) as AdminTeamMemberDetail["latestOperation"]["action"],
          state: safeActionState(
            row.latest_action_state,
          ) as AdminTeamMemberDetail["latestOperation"]["state"],
          safeErrorCode: safeErrorCode(row.latest_safe_error_code),
          retryAfter: dateString(row.latest_retry_after),
        },
        recentActivity,
        version: member.updatedAt,
      };
    },
  };
}

const defaultReadModel = createAdminTeamReadModel();
export const listAdminTeam = defaultReadModel.listAdminTeam;
export const getAdminTeamMember = defaultReadModel.getAdminTeamMember;
