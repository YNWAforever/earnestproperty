import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test("EP-13 owned saved shared media order, independent sale/rent, CAS and revoked writer readback", async (t) => {
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(mock, query, transaction);
    const { saveAdminPropertyManagement } = await import("./admin-property-management.server.ts");
    const { getAdminManagedProperty } = await import("./admin-properties.server.ts");
    const [staff] = await query(
      "INSERT INTO staff_users(auth_user_id) VALUES('qa-property-manager') RETURNING id",
    );
    await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [staff.id]);
    const actor = {
      staffId: staff.id,
      authUserId: "qa-property-manager",
      roles: ["manager"],
      email: null,
      name: null,
      bootstrap: false,
    };
    const [sale, rent] = await query(
      "INSERT INTO properties(listing_no,title_zh,deal_type,district_slug,status,price,rent,agent_id) VALUES('QA-MAINT-SALE','合成維護盤','sale','sham-tseng','active',9000000,null,$1),('QA-MAINT-RENT','合成維護盤','rent','sham-tseng','active',null,26000,$1) RETURNING id",
      [staff.id],
    );
    const [identity] = await query(
      "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
      [sale.id],
    );
    const propertyNo = identity.public_listing_no;
    await query("UPDATE property_public_members SET public_listing_no=$1 WHERE property_id=$2", [
      propertyNo,
      rent.id,
    ]);
    const read = () => getAdminManagedProperty(propertyNo, actor);
    await t.test("text and photo metadata order survive a fresh reader", async () => {
      const before = await read();
      const images = [
        "https://example.invalid/owned-second.jpg",
        "https://example.invalid/owned-first.jpg",
      ];
      await saveAdminPropertyManagement(
        {
          propertyNo,
          expectedVersion: before.version,
          scope: "shared",
          payload: {
            title_zh: "已保存合成中英文長標題 Saved synthetic title",
            description: "人工 protected 文字",
            images,
          },
        },
        actor,
      );
      const rows = await query(
        "SELECT title_zh,description,images FROM properties WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[sale.id, rent.id]],
      );
      assert.ok(
        rows.every(
          (row) => row.title_zh.includes("已保存") && row.description === "人工 protected 文字",
        ),
      );
      assert.ok(rows.every((row) => JSON.stringify(row.images) === JSON.stringify(images)));
      assert.deepEqual((await read()).shared.images, images);
      assert.equal(
        (
          await query("SELECT count(*)::int n FROM admin_property_overrides WHERE property_no=$1", [
            propertyNo,
          ])
        )[0].n,
        1,
      );
    });
    await t.test("sale-only price change leaves rent unchanged", async () => {
      const before = await read();
      await saveAdminPropertyManagement(
        { propertyNo, expectedVersion: before.version, scope: "sale", payload: { price: 8800000 } },
        actor,
      );
      assert.equal(
        (await query("SELECT price::text FROM properties WHERE id=$1", [sale.id]))[0].price,
        "8800000",
      );
      assert.equal(
        (await query("SELECT rent::text FROM properties WHERE id=$1", [rent.id]))[0].rent,
        "26000",
      );
      assert.equal((await read()).offerings.sale.price, 8800000);
      assert.equal((await read()).offerings.rent.rent, 26000);
    });
    await t.test(
      "simultaneous versioned saves have one winner, losing input has no partial write",
      async () => {
        const before = await read();
        const results = await Promise.allSettled(
          [8700000, 8600000].map((price) =>
            saveAdminPropertyManagement(
              { propertyNo, expectedVersion: before.version, scope: "sale", payload: { price } },
              actor,
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.ok(
          results.some(
            (r) =>
              r.status === "rejected" && r.reason instanceof Response && r.reason.status === 409,
          ),
        );
        assert.equal((await read()).offerings.rent.rent, 26000);
      },
    );
    await t.test("deactivated actor cannot use a cached manager capability to write", async () => {
      const before = await read();
      await query("UPDATE staff_users SET active=false WHERE id=$1", [staff.id]);
      await assert.rejects(
        saveAdminPropertyManagement(
          { propertyNo, expectedVersion: before.version, scope: "sale", payload: { price: 1 } },
          actor,
        ),
        (e) => e instanceof Response && e.status === 403,
      );
      assert.notEqual(
        (await query("SELECT price::text FROM properties WHERE id=$1", [sale.id]))[0].price,
        "1",
      );
    });
  });
});
