import "@tanstack/react-start/server-only";

import { neon } from "@neondatabase/serverless";

export type DbRow = Record<string, unknown>;
export type TransactionStatement = { statement: string; params?: unknown[] };

export function getDatabaseUrl() {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
}

export function getSql() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required.");
  return neon(databaseUrl);
}

export async function queryRows<T extends DbRow = DbRow>(
  statement: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await getSql().query(statement, params)) as T[];
}

export async function transactionRows(
  statements: readonly TransactionStatement[],
  options: {
    isolationLevel?: "ReadUncommitted" | "ReadCommitted" | "RepeatableRead" | "Serializable";
  } = {},
) {
  const sql = getSql();
  return sql.transaction(
    (tx) => statements.map(({ statement, params = [] }) => tx.query(statement, params)),
    options,
  );
}

export function addParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

export function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function stringOrEmpty(value: unknown) {
  return stringOrNull(value) ?? "";
}

export function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function booleanOrFalse(value: unknown) {
  return value === true;
}

export function dateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function textArrayOrNull(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.map(String);
}
