import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { NAV_ENTRIES, roleCanOpen, visibleNavEntries } from "./admin-nav-roles.ts";
import { hasPermission } from "../../lib/control-plane/role-permissions.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const ROLES = ["admin", "manager", "agent", "viewer"];

// Each sidebar entry's FIRST server read, as the page makes it on arrival, and where its guard
// lives. `anchor` locates the server function; the first role array after it is the guard.
// `permission` is used where the guard is a control-plane permission rather than a role list.
const FIRST_READ = {
  "/admin": { file: "src/lib/neon/admin-data.ts", anchor: "const fetchAdminOverviewServer" },
  "/admin/leads": { file: "src/lib/neon/admin-data.ts", anchor: "const fetchAdminLeadsServer" },
  "/admin/whatsapp": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchAdminConversationsServer",
  },
  "/admin/leads/command-center": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchCommandCenterServer",
  },
  "/admin/listings": {
    file: "src/lib/neon/admin-properties.ts",
    anchor: "async function staff()",
  },
  "/admin/property-sync": {
    file: "src/lib/neon/admin-property-sync.ts",
    anchor: "const readServer",
  },
  "/admin/transactions": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchAdminTransactionsFilteredServer",
  },
  "/admin/cms": { file: "src/lib/neon/admin-data.ts", anchor: "const fetchAdminCmsServer" },
  "/admin/estates": { file: "src/lib/neon/admin-data.ts", anchor: "const fetchAdminCmsServer" },
  "/admin/segments": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchAdminCrmSegmentsServer",
  },
  "/admin/whatsapp-links": {
    file: "src/lib/neon/whatsapp-link-management.ts",
    anchor: "const page = createServerFn",
  },
  "/admin/whatsapp-settings": {
    file: "src/lib/neon/whatsapp-assignment.ts",
    anchor: "const settingsServer",
  },
  "/admin/blasts": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchAdminCampaignsServer",
  },
  "/admin/team": { file: "src/lib/neon/admin-team.ts", anchor: "async function withReadAccess" },
  "/admin/agents": {
    file: "src/lib/neon/admin-data.ts",
    anchor: "const fetchAdminAgentProfilesServer",
  },
  "/admin/analytics": {
    file: "src/lib/analytics/reporting.server.ts",
    anchor: "export async function fetchOperationalAnalytics",
  },
  "/admin/operations": {
    file: "src/routes/api.admin.control-plane.health.ts",
    permission: "system.health.read",
  },
};

const GUARD = /require\w*\((?:getRequest\(\)|request)?,?\s*\[([^\]]*)\]/;

function rolesAcceptedByServer(spec) {
  const source = read(spec.file);
  if (spec.permission) {
    assert.ok(source.includes(`requireStaffPermission(request, "${spec.permission}")`));
    return ROLES.filter((role) => hasPermission([role], spec.permission));
  }
  const start = spec.anchor ? source.indexOf(spec.anchor) : 0;
  assert.notEqual(start, -1, `${spec.anchor} not found in ${spec.file}`);
  const match = GUARD.exec(source.slice(start));
  assert.ok(match, `no role guard after ${spec.anchor || "file start"} in ${spec.file}`);
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

test("the table names every sidebar entry exactly once", () => {
  assert.deepEqual(Object.keys(FIRST_READ).sort(), NAV_ENTRIES.map((e) => e.to).sort());
  const shell = read("src/components/admin/AdminShell.tsx");
  const shellTargets = [...shell.matchAll(/\bto: "(\/admin[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...shellTargets].sort(), NAV_ENTRIES.map((e) => e.to).sort());
});

test("an agent sees exactly the entries whose first read accepts agent, and none is locked", () => {
  const expected = NAV_ENTRIES.filter((e) =>
    rolesAcceptedByServer(FIRST_READ[e.to]).includes("agent"),
  ).map((e) => e.to);
  assert.deepEqual(
    visibleNavEntries(["agent"]).map((e) => e.to),
    expected,
  );
  assert.deepEqual(expected, [
    "/admin",
    "/admin/leads",
    "/admin/whatsapp",
    "/admin/listings",
    "/admin/transactions",
    "/admin/operations",
  ]);
  // Hidden, not greyed: the shell no longer has a locked rendering at all.
  const shell = read("src/components/admin/AdminShell.tsx");
  for (const gone of ["navDisabledClassName", "requiredRoleLabel", "aria-disabled", "Lock"]) {
    assert.ok(!shell.includes(gone), `AdminShell still mentions ${gone}`);
  }
  assert.match(shell, /visibleNavEntries\(roles\)/);
});

test("every hidden entry's first server read rejects that role", () => {
  for (const role of ROLES) {
    const visible = new Set(visibleNavEntries([role]).map((e) => e.to));
    for (const entry of NAV_ENTRIES) {
      const accepted = rolesAcceptedByServer(FIRST_READ[entry.to]);
      if (visible.has(entry.to)) {
        assert.ok(
          accepted.includes(role),
          `${entry.to} is shown to ${role} but the server rejects it`,
        );
      } else {
        assert.ok(
          !accepted.includes(role),
          `${entry.to} is hidden from ${role} but the server accepts it`,
        );
      }
    }
  }
});

test("a failed session lookup (null roles) still renders every entry", () => {
  assert.equal(visibleNavEntries(null).length, NAV_ENTRIES.length);
  assert.equal(roleCanOpen(null, ["admin"]), true);
  assert.equal(roleCanOpen([], ["admin"]), false);
});
