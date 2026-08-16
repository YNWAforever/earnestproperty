import "@tanstack/react-start/server-only";

import { normalizeStaffEmail } from "./staff-lifecycle-policy.ts";
import { queryRows, transactionRows, type DbRow, type TransactionStatement } from "./db.server.ts";

export type IdentityActionType =
  | "invite"
  | "resend_invitation"
  | "password_reset"
  | "session_revocation";
export type IdentityActionState =
  | "pending"
  | "succeeded"
  | "retryable_failure"
  | "terminal_failure";

type QueryRows = <T extends DbRow = DbRow>(statement: string, params?: unknown[]) => Promise<T[]>;
type TransactionRows = (statements: readonly TransactionStatement[]) => Promise<unknown>;

type IdentityActionStoreDependencies = {
  queryRows?: QueryRows;
  transactionRows?: TransactionRows;
};

type IdentityActionRow = {
  id: unknown;
  state: unknown;
  inserted?: unknown;
};

type CooldownRow = {
  state: unknown;
  retry_after: unknown;
  provider_expires_at: unknown;
};

const identityActionStates = new Set<IdentityActionState>([
  "pending",
  "succeeded",
  "retryable_failure",
  "terminal_failure",
]);

export class IdentityActionStoreError extends Error {
  readonly code: "IDENTITY_ACTION_INVALID_TIMESTAMP" | "IDENTITY_ACTION_STORE_UNAVAILABLE";

  constructor(code: "IDENTITY_ACTION_INVALID_TIMESTAMP" | "IDENTITY_ACTION_STORE_UNAVAILABLE") {
    super(code);
    this.name = "IdentityActionStoreError";
    this.code = code;
  }
}

function stateOrThrow(value: unknown): IdentityActionState {
  if (typeof value === "string" && identityActionStates.has(value as IdentityActionState)) {
    return value as IdentityActionState;
  }
  throw new IdentityActionStoreError("IDENTITY_ACTION_STORE_UNAVAILABLE");
}

function timestampOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const timestamp = new Date(String(value));
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

function normalizedTimestamp(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const timestamp = timestampOrNull(value);
  if (!timestamp) throw new IdentityActionStoreError("IDENTITY_ACTION_INVALID_TIMESTAMP");
  return timestamp;
}

function safeErrorCode(value: string) {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : "IDENTITY_ACTION_FAILED";
}

function storeError(error: unknown): never {
  if (error instanceof IdentityActionStoreError) throw error;
  throw new IdentityActionStoreError("IDENTITY_ACTION_STORE_UNAVAILABLE");
}

export function createIdentityActionStore(dependencies: IdentityActionStoreDependencies = {}) {
  const runQuery = dependencies.queryRows ?? queryRows;
  const runTransaction = dependencies.transactionRows ?? transactionRows;

  return {
    async beginIdentityAction(input: {
      idempotencyKey: string;
      action: IdentityActionType;
      actorStaffId: string | null;
      targetStaffId: string | null;
      targetEmail: string;
      requestId: string;
    }): Promise<{ operationId: string; isExisting: boolean; state: IdentityActionState }> {
      try {
        const rows = await runQuery<IdentityActionRow>(
          `INSERT INTO staff_identity_actions
            (idempotency_key, action, actor_staff_id, target_staff_id, target_email, request_id)
           VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6::uuid)
           ON CONFLICT (idempotency_key) DO UPDATE
             SET updated_at = staff_identity_actions.updated_at
           RETURNING id::text AS id, state, (xmax = 0) AS inserted`,
          [
            input.idempotencyKey,
            input.action,
            input.actorStaffId,
            input.targetStaffId,
            normalizeStaffEmail(input.targetEmail),
            input.requestId,
          ],
        );
        const row = rows[0];
        if (!row || typeof row.id !== "string") {
          throw new IdentityActionStoreError("IDENTITY_ACTION_STORE_UNAVAILABLE");
        }
        return {
          operationId: row.id,
          isExisting: row.inserted !== true,
          state: stateOrThrow(row.state),
        };
      } catch (error) {
        return storeError(error);
      }
    },

    async markIdentityActionSucceeded(input: {
      operationId: string;
      providerExpiresAt?: string | null;
    }): Promise<void> {
      try {
        await runTransaction([
          {
            statement: `UPDATE staff_identity_actions
              SET state = 'succeeded',
                  safe_error_code = NULL,
                  retry_after = NULL,
                  provider_expires_at = COALESCE($2::timestamptz, provider_expires_at),
                  updated_at = now()
              WHERE id = $1::uuid
                AND state IN ('pending', 'retryable_failure')`,
            params: [input.operationId, normalizedTimestamp(input.providerExpiresAt)],
          },
        ]);
      } catch (error) {
        return storeError(error);
      }
    },

    async markIdentityActionRetryable(input: {
      operationId: string;
      safeErrorCode: string;
      retryAfter?: string | null;
    }): Promise<void> {
      try {
        await runTransaction([
          {
            statement: `UPDATE staff_identity_actions
              SET state = 'retryable_failure',
                  safe_error_code = $2,
                  retry_after = $3::timestamptz,
                  updated_at = now()
              WHERE id = $1::uuid
                AND state IN ('pending', 'retryable_failure')`,
            params: [
              input.operationId,
              safeErrorCode(input.safeErrorCode),
              normalizedTimestamp(input.retryAfter),
            ],
          },
        ]);
      } catch (error) {
        return storeError(error);
      }
    },

    async markIdentityActionTerminal(input: {
      operationId: string;
      safeErrorCode: string;
    }): Promise<void> {
      try {
        await runTransaction([
          {
            statement: `UPDATE staff_identity_actions
              SET state = 'terminal_failure',
                  safe_error_code = $2,
                  retry_after = NULL,
                  updated_at = now()
              WHERE id = $1::uuid
                AND state IN ('pending', 'retryable_failure')`,
            params: [input.operationId, safeErrorCode(input.safeErrorCode)],
          },
        ]);
      } catch (error) {
        return storeError(error);
      }
    },

    async findIdentityActionCooldown(input: {
      targetStaffId: string;
      action: IdentityActionType;
      now: string;
    }): Promise<{
      state: IdentityActionState;
      retryAfter: string | null;
      providerExpiresAt: string | null;
    } | null> {
      try {
        const rows = await runQuery<CooldownRow>(
          `SELECT state, retry_after, provider_expires_at
             FROM staff_identity_actions
            WHERE target_staff_id = $1::uuid
              AND action = $2
              AND created_at <= $3::timestamptz
              AND state IN ('pending', 'succeeded', 'retryable_failure')
            ORDER BY created_at DESC, id DESC
            LIMIT 1`,
          [input.targetStaffId, input.action, normalizedTimestamp(input.now)],
        );
        const row = rows[0];
        if (!row) return null;
        return {
          state: stateOrThrow(row.state),
          retryAfter: timestampOrNull(row.retry_after),
          providerExpiresAt: timestampOrNull(row.provider_expires_at),
        };
      } catch (error) {
        return storeError(error);
      }
    },
  };
}

const defaultStore = createIdentityActionStore();

export const beginIdentityAction = defaultStore.beginIdentityAction;
export const markIdentityActionSucceeded = defaultStore.markIdentityActionSucceeded;
export const markIdentityActionRetryable = defaultStore.markIdentityActionRetryable;
export const markIdentityActionTerminal = defaultStore.markIdentityActionTerminal;
export const findIdentityActionCooldown = defaultStore.findIdentityActionCooldown;
