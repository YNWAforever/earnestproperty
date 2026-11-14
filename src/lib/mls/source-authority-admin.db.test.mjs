import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  CURRENT_PUBLIC_OFFERING_ORDER,
  canonicalListingCte,
} from "../neon/public-listing-query.js";
import { withAuthorityDatabase } from "./source-authority-db-fixtures.mjs";

// The fixture starts its own verified loopback PostgreSQL and applies the real
// migration ledger. No environment-provided database target is accepted here.
test("owned PostgreSQL admin and handover select the same authoritative public offering", async (t) => {
  await withAuthorityDatabase(async ({ q, seedProperty }) => {
    const manager = randomUUID();
    const owner = randomUUID();
    const peerOwner = randomUUID();
    const replacement = randomUUID();
    const outsider = randomUUID();
    for (const [id, role] of [
      [manager, "manager"],
      [owner, "agent"],
      [peerOwner, "agent"],
      [replacement, "agent"],
      [outsider, "agent"],
    ]) {
      await q(
        "INSERT INTO staff_users(id,name_zh,active) VALUES($1,'Offline authority admin test',true)",
        [id],
      );
      await q("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2::staff_role)", [id, role]);
    }
    const version = async (ref) =>
      (await q("SELECT admin_property_group_version($1) AS version", [ref]))[0].version;
    const manage = async (ref, scope, patch, actor = manager, expected) =>
      q("SELECT admin_property_manage($1,$2,$3,$4::jsonb,$5::uuid) AS result", [
        ref,
        expected ?? (await version(ref)),
        scope,
        JSON.stringify(patch),
        actor,
      ]);
    const get = async (id) => (await q("SELECT * FROM properties WHERE id=$1", [id]))[0];
    const current = async (ref, deal = "sale") =>
      (
        await q(
          `SELECT p.* FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type=$2 ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1`,
          [ref, deal],
        )
      )[0];
    const aliases = (ref) =>
      q(
        "SELECT property_id,public_listing_no FROM property_public_members WHERE public_listing_no=$1 ORDER BY property_id",
        [ref],
      );
    const writer = async (work, handoverTo = null) => {
      await q("BEGIN");
      try {
        if (handoverTo)
          await q("SELECT set_config('app.staff_property_handover',$1,true)", [handoverTo]);
        else await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
        const result = await work();
        await q("COMMIT");
        return result;
      } catch (error) {
        await q("ROLLBACK").catch(() => {});
        throw error;
      }
    };
    const pair = async (ref, { authority = true, deal = "sale" } = {}) => {
      const primary = await seedProperty(ref, {
        listing_no: `ADMIN-AUTHORITY-${ref}-${deal}`,
        deal_type: deal,
        agent_id: owner,
        source_authority: authority ? "28hse" : null,
        source_updated_at: null,
      });
      const peer = await seedProperty(ref, {
        listing_no: `ADMIN-LEGACY-${ref}-${deal}`,
        deal_type: deal,
        agent_id: peerOwner,
        source_updated_at: "2026-12-01T00:00:00Z",
        source_authority: null,
      });
      await writer(() =>
        q(
          "UPDATE properties SET ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2' WHERE id=$1",
          [primary.id],
        ),
      );
      assert.equal(
        (await aliases(ref)).some((row) => row.property_id === primary.id),
        true,
      );
      assert.equal(
        (await aliases(ref)).some((row) => row.property_id === peer.id),
        true,
      );
      return { primary: await get(primary.id), peer: await get(peer.id) };
    };

    await t.test(
      "admin price and shared edits reach the flagged sale and rent rows with unknown source dates",
      async () => {
        const ref = "A940001";
        const sale = await pair(ref);
        const rent = await pair(ref, { deal: "rent" });
        const beforeAliases = await aliases(ref);
        assert.equal((await current(ref)).id, sale.primary.id);
        assert.equal((await current(ref, "rent")).id, rent.primary.id);
        // This is the former selector's counterexample: its dated peer wins.
        assert.equal(
          (
            await q(
              "SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type='sale' ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1",
              [ref],
            )
          )[0].id,
          sale.peer.id,
        );
        const reviewed = await version(ref);
        await manage(ref, "sale", { price: 8100000 }, manager, reviewed);
        assert.equal(Number((await get(sale.primary.id)).price), 8100000);
        assert.equal(Number((await get(sale.peer.id)).price), Number(sale.peer.price));
        await assert.rejects(
          manage(ref, "sale", { price: 8200000 }, manager, reviewed),
          /ADMIN_PROPERTY_CONFLICT/,
        );
        await manage(ref, "shared", { floor: "管理樓層" });
        assert.equal((await get(sale.primary.id)).floor, "管理樓層");
        assert.equal((await get(rent.primary.id)).floor, "管理樓層");
        assert.equal((await get(sale.primary.id)).source_updated_at, null);
        assert.equal((await get(rent.primary.id)).source_updated_at, null);
        assert.equal((await get(sale.peer.id)).floor, sale.peer.floor);
        assert.equal((await get(rent.peer.id)).floor, rent.peer.floor);
        assert.deepEqual(await aliases(ref), beforeAliases);
        const audit = (
          await q(
            "SELECT metadata FROM audit_logs WHERE action='property.manage' AND metadata->>'propertyNo'=$1 ORDER BY created_at DESC LIMIT 1",
            [ref],
          )
        )[0].metadata;
        assert.deepEqual(
          audit.after.map((row) => row.id).sort(),
          [sale.primary.id, rent.primary.id].sort(),
        );
      },
    );

    await t.test(
      "current-offer ownership checks use authority and still reject forbidden fields and actors",
      async () => {
        const ref = "A940002";
        const { primary, peer } = await pair(ref);
        await assert.rejects(manage(ref, "sale", { price: 1 }, peerOwner), /FORBIDDEN/);
        await assert.rejects(manage(ref, "sale", { price: 1 }, outsider), /FORBIDDEN/);
        await assert.rejects(
          manage(ref, "sale", { source_authority: null }),
          /INVALID_PROPERTY_PATCH/,
        );
        await manage(ref, "sale", { price: 8300000 }, owner);
        assert.equal(Number((await get(primary.id)).price), 8300000);
        assert.equal(Number((await get(peer.id)).price), Number(peer.price));
      },
    );

    await t.test(
      "handover stores the authoritative current agent override and protects it from later source imports",
      async () => {
        const ref = "A940003";
        const { primary, peer } = await pair(ref);
        const beforeAliases = await aliases(ref);
        await manage(ref, "sale", { agentId: owner });
        await writer(
          () => q("UPDATE properties SET agent_id=$2 WHERE id=$1", [primary.id, replacement]),
          replacement,
        );
        assert.equal((await get(primary.id)).agent_id, replacement);
        assert.equal((await get(peer.id)).agent_id, peerOwner);
        const override = (
          await q("SELECT sale FROM admin_property_overrides WHERE property_no=$1", [ref])
        )[0].sale;
        assert.equal(override.agent_id, replacement);
        await writer(() => q("UPDATE properties SET agent_id=$2 WHERE id=$1", [primary.id, owner]));
        assert.equal((await get(primary.id)).agent_id, replacement);
        assert.deepEqual(await aliases(ref), beforeAliases);
      },
    );

    await t.test(
      "handover of a noncurrent dated peer cannot seize the public agent override",
      async () => {
        const ref = "A940004";
        const { primary, peer } = await pair(ref);
        await writer(
          () => q("UPDATE properties SET agent_id=$2 WHERE id=$1", [peer.id, replacement]),
          replacement,
        );
        assert.equal((await get(peer.id)).agent_id, replacement);
        assert.equal((await get(primary.id)).agent_id, owner);
        assert.deepEqual(
          await q("SELECT * FROM admin_property_overrides WHERE property_no=$1", [ref]),
          [],
        );
      },
    );

    await t.test(
      "nullable authority leaves legacy date ranking and current-row management unchanged",
      async () => {
        const ref = "A940005";
        const { primary, peer } = await pair(ref, { authority: false });
        const beforeAliases = await aliases(ref);
        assert.equal((await current(ref)).id, peer.id);
        await manage(ref, "sale", { price: 8400000 });
        assert.equal(Number((await get(peer.id)).price), 8400000);
        assert.equal(Number((await get(primary.id)).price), Number(primary.price));
        await writer(
          () => q("UPDATE properties SET agent_id=$2 WHERE id=$1", [peer.id, replacement]),
          replacement,
        );
        assert.equal(
          (
            await q(
              "SELECT sale->>'agent_id' AS agent FROM admin_property_overrides WHERE property_no=$1",
              [ref],
            )
          )[0].agent,
          replacement,
        );
        assert.deepEqual(await aliases(ref), beforeAliases);
      },
    );

    await t.test(
      "reviewed inactive status stays on the authoritative row and cannot reveal the active legacy peer",
      async () => {
        const ref = "A940006";
        const { primary, peer } = await pair(ref);
        const beforeAliases = await aliases(ref);
        await manage(ref, "sale", { status: "inactive" });
        assert.equal((await get(primary.id)).status, "inactive");
        assert.equal((await get(peer.id)).status, "active");
        assert.equal((await current(ref)).id, primary.id);
        assert.deepEqual(
          await q(
            canonicalListingCte("current_offerings.public_listing_no=$1") +
              " SELECT * FROM canonical",
            [ref],
          ),
          [],
        );
        await manage(ref, "sale", { status: "active" });
        assert.equal((await get(primary.id)).status, "active");
        assert.equal((await get(peer.id)).status, "active");
        assert.deepEqual(await aliases(ref), beforeAliases);
      },
    );
    await t.test(
      "link batches accept the authoritative public row, reject its peer, and retain mapping and recovery guards",
      async () => {
        const ref = "A940007";
        const { primary, peer } = await pair(ref);
        const beforeAliases = await aliases(ref);
        const channel = "owned-source-authority-channel";
        await q(
          "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verified_at,verification_ref) VALUES($1,$2,'offline-inbox','offline-folder','offline-node',true,now(),'owned-authority-fixture')",
          [owner, channel],
        );
        const digest = (value) => createHash("sha256").update(value).digest("hex");
        const prepare = async (propertyId, actor = manager) => {
          const rowKey = randomUUID();
          const batch = randomUUID();
          const chunk = randomUUID();
          const row = {
            rowKey,
            placementId: "website:owned-authority-" + rowKey,
            placementKey: digest(rowKey),
            input: {
              placementSource: "website",
              entryPointType: "sales",
              publicListingNo: ref,
              propertyId,
              dealType: "sale",
              requestedStaffId: owner,
              placementVerified: true,
              enabled: true,
            },
          };
          const rows = [row];
          const tokenHash = digest("preview:" + rowKey);
          const chunkHash = digest(JSON.stringify(rows));
          const mappingVersion = (
            await q(
              "SELECT version FROM whatsapp_staff_channels WHERE staff_id=$1 AND channel_id=$2",
              [owner, channel],
            )
          )[0].version;
          await q(
            "INSERT INTO whatsapp_link_batch_previews(batch_id,actor_staff_id,channel_id,token_hash,payload_hash,rows,expires_at,mapping_versions) VALUES($1,$2,$3,$4,$5,$6::jsonb,now()+interval '15 minutes',$7::jsonb)",
            [
              batch,
              actor,
              channel,
              tokenHash,
              chunkHash,
              JSON.stringify(rows),
              JSON.stringify({ [rowKey]: mappingVersion }),
            ],
          );
          return {
            actor,
            batch,
            chunk,
            tokenHash,
            chunkHash,
            rows,
            codes: { [rowKey]: randomUUID().replaceAll("-", "") },
          };
        };
        const commit = async (batch) =>
          (
            await q(
              "SELECT wa_commit_link_batch_chunk($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb) AS result",
              [
                batch.actor,
                batch.batch,
                batch.chunk,
                batch.tokenHash,
                batch.chunkHash,
                JSON.stringify(batch.rows),
                channel,
                JSON.stringify(batch.codes),
              ],
            )
          )[0].result;
        const countLinks = async () =>
          (await q("SELECT count(*)::int AS count FROM whatsapp_tracking_links"))[0].count;
        const good = await prepare(primary.id);
        const accepted = await commit(good);
        assert.equal(accepted.state, "committed");
        assert.equal(accepted.rows[0].outcome, "created");
        assert.equal(
          (
            await q("SELECT property_id FROM whatsapp_tracking_link_versions WHERE link_id=$1", [
              accepted.rows[0].linkId,
            ])
          )[0].property_id,
          primary.id,
        );
        const linkCount = await countLinks();
        const rejected = await commit(await prepare(peer.id));
        assert.equal(rejected.state, "rejected");
        assert.equal(rejected.rows[0].reasonCode, "WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
        assert.equal(await countLinks(), linkCount);
        // The public mapping-lock wrapper must remain installed around the renamed
        // _v1 implementation; replacing it with the older body loses this check.
        const staleMapping = await prepare(primary.id);
        await q(
          "UPDATE whatsapp_staff_channels SET verification_ref='owned-authority-recheck' WHERE staff_id=$1 AND channel_id=$2",
          [owner, channel],
        );
        await assert.rejects(commit(staleMapping), /WA_LINK_MAPPING_CHANGED/);
        assert.equal(await countLinks(), linkCount);
        await assert.rejects(commit(await prepare(primary.id, outsider)), /FORBIDDEN/);
        assert.deepEqual(await commit(good), accepted);
        assert.equal(await countLinks(), linkCount);
        await assert.rejects(
          commit({ ...good, chunkHash: "a".repeat(64) }),
          /BATCH_PAYLOAD_CONFLICT/,
        );
        await manage(ref, "sale", { status: "inactive" });
        for (const id of [primary.id, peer.id]) {
          const withdrawn = await commit(await prepare(id));
          assert.equal(withdrawn.state, "rejected");
          assert.equal(withdrawn.rows[0].reasonCode, "WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
        }
        assert.equal(await countLinks(), linkCount);
        assert.deepEqual(await aliases(ref), beforeAliases);
      },
    );
  });
});
