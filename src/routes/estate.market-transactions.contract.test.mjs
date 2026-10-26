import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const route = read("src/routes/estate.$slug.tsx");

test("estate route passes the static market snapshot to its own section, separate from agency data", () => {
  assert.match(route, /marketTransactions: getEstateRegisteredTransactions\(estate\.slug\)/);
  assert.match(route, /<EstateRegisteredTransactions market=\{marketTransactions\}/);
  assert.match(route, /fetchEstateTransactions\(estate\.id, 8\)/);
  assert.match(route, /<EstateMarketSnapshot[\s\S]*?transactions=\{transactions\}/);
  assert.doesNotMatch(
    route,
    /transactions:\s*marketTransactions|transactions\.concat|transactions\.push/,
  );
});

test("EPRC fixture/module and agency queries/admin stay on independent dependency paths", () => {
  for (const path of [
    "src/lib/queries.ts",
    "src/lib/neon/public-data.ts",
    "src/lib/neon/public-data.server.ts",
    "src/lib/neon/admin-data.ts",
    "src/lib/neon/admin-data.server.ts",
    "src/components/site/EstateMarketSnapshot.tsx",
  ]) {
    assert.doesNotMatch(read(path), /eprc|RegisteredTransactions|marketTransactions/i, path);
  }
  for (const path of [
    "src/content/eprc-transactions.ts",
    "src/content/eprc-transactions-snapshot.ts",
    "src/components/site/EstateRegisteredTransactions.tsx",
  ]) {
    assert.doesNotMatch(
      read(path),
      /from ["'][^"']*(?:queries|neon|admin)|fetchEstateTransactions|createServerFn|queryRows/,
      path,
    );
  }
  const snapshot = read("src/content/eprc-transactions-snapshot.ts");
  assert.match(snapshot, /eprc-transactions-22-estates-20261027\.csv\?raw/);
  assert.match(snapshot, /buildEprcSnapshot\(csv\)/);
});
