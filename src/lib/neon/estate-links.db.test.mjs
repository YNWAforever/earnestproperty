import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

test(
  "estate identity backfill and future intake link exact named estates only",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
    const db = neon(process.env.ASTRA_TEST_DATABASE_URL),
      schema = "estate_link_" + randomUUID().replaceAll("-", "");
    const run = async (q, params = []) =>
      (
        await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema + ",public"]),
          tx.query(q, params),
        ])
      )[1];
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await run("CREATE TABLE estates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name_zh text)");
      await run(
        "CREATE TABLE properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title_zh text,estate_id uuid)",
      );
      await run("INSERT INTO estates(name_zh) VALUES('滿名山'),('海韻臺'),('海韻花園')");
      await run(
        "INSERT INTO properties(title_zh) VALUES('滿名山 名庭 售盤 #A'),('海韻台 租盤 #R'),('其他樓盤')",
      );
      const f = "neon/migrations/20260906110000_estate_listing_links.sql";
      if (existsSync(f)) for (const q of splitSqlStatements(readFileSync(f, "utf8"))) await run(q);
      assert.equal(
        Number(
          (await run("SELECT count(*) AS n FROM properties WHERE estate_id IS NOT NULL"))[0].n,
        ),
        2,
      );
      await run("INSERT INTO properties(title_zh) VALUES('海韻花園 第02座 售盤 #B')");
      assert.equal(
        (
          await run(
            "SELECT e.name_zh FROM properties p JOIN estates e ON e.id=p.estate_id WHERE p.title_zh LIKE '海韻花園%'",
          )
        )[0].name_zh,
        "海韻花園",
      );
      await run("UPDATE properties SET title_zh='其他樓盤' WHERE title_zh LIKE '滿名山%'");
      assert.equal(
        Number(
          (await run("SELECT count(*) AS n FROM properties WHERE estate_id IS NOT NULL"))[0].n,
        ),
        3,
        "existing explicit links are preserved",
      );
    } finally {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  },
);
