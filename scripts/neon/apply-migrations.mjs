import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]),
  );
}

const env = {
  ...loadEnvFile(".env"),
  ...loadEnvFile(".env.local"),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required to apply Neon migrations.");
}

const migrationsDir = "neon/migrations";
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const sql = neon(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS app_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const applied = await sql.query("SELECT version FROM app_migrations");
const appliedVersions = new Set(applied.map((row) => row.version));

function splitSqlStatements(query) {
  const statements = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag = null;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    const next = query[index + 1];

    if (!singleQuoted && !doubleQuoted && !dollarTag && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }

    if (!doubleQuoted && !dollarTag && char === "'" && query[index - 1] !== "\\") {
      singleQuoted = !singleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && !dollarTag && char === '"') {
      doubleQuoted = !doubleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (!dollarTag) {
          dollarTag = tag;
        } else if (dollarTag === tag) {
          dollarTag = null;
        }
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }

    if (!singleQuoted && !doubleQuoted && !dollarTag && char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const results = [];
for (const file of migrationFiles) {
  if (appliedVersions.has(file)) {
    results.push({ file, status: "skipped" });
    continue;
  }

  const query = readFileSync(join(migrationsDir, file), "utf8");
  await sql.transaction((tx) => [
    ...splitSqlStatements(query).map((statement) => tx.query(statement)),
    tx.query("INSERT INTO app_migrations (version) VALUES ($1)", [file]),
  ]);
  results.push({ file, status: "applied" });
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
