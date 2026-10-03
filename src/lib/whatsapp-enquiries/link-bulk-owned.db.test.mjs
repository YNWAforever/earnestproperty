import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { batchResultCsv } from "../admin/whatsapp-link-batch-client.ts";
const id = (n) => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test(
  "fifty-row batch actual SQL independently preserves results, revalidation and zero sends",
  { timeout: 120000 },
  async (t) => {
    const previous = process.env.EP_WA_COMPANY_CHANNEL_ID;
    process.env.EP_WA_COMPANY_CHANNEL_ID = "owned-bulk-company";
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("Provider/network request forbidden in owned batch acceptance");
    });
    try {
      await withOwnedPostgres(async ({ query, migrationCount }) => {
        assert.equal(migrationCount, 85);
        const {
          previewWhatsappLinkBatch: preview,
          commitWhatsappLinkChunk: commit,
          getWhatsappLinkBatchResult: read,
        } = await import("../neon/whatsapp-link-batches.server.ts");
        for (const [n, role] of [
          [100, "manager"],
          [101, "manager"],
          [102, "agent"],
        ]) {
          await query("INSERT INTO staff_users(id,auth_user_id,name_zh) VALUES($1,$2,$3)", [
            id(n),
            `owned-bulk-${n}`,
            `合成同事 ${n}`,
          ]);
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2::staff_role)", [
            id(n),
            role,
          ]);
        }
        const actor = { staffId: id(100), roles: ["manager"] };
        await query(
          "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verified_at,verification_ref) VALUES($1,'owned-bulk-company','owned-inbox','owned-folder','owned-route',true,now(),'owned-evidence')",
          [id(102)],
        );
        const rows = [];
        for (let i = 0; i < 50; i++) {
          const deal = i % 2 ? "rent" : "sale";
          await query(
            "INSERT INTO properties(id,listing_no,title_zh,deal_type,district_slug,status) VALUES($1,$2,$3,$4::deal_type,'owned','active')",
            [id(i + 1), `A${String(i + 1).padStart(6, "0")}`, `合成中文盤 ${i + 1}`, deal],
          );
          const [member] = await query(
            "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
            [id(i + 1)],
          );
          assert.match(member.public_listing_no, /^A\d{6}$/);
          rows.push({
            rowKey: id(i + 300),
            placementId: i % 2 ? String(4000001 + i) : "website:primary",
            input: {
              placementSource: i % 2 ? "28hse" : "website",
              entryPointType: "sales",
              publicListingNo: member.public_listing_no,
              propertyId: id(i + 1),
              dealType: deal,
              requestedStaffId: id(102),
              referenceMappingId: null,
              externalListingId: i % 2 ? String(4000001 + i) : null,
              videoId: null,
              placementVerified: true,
              enabled: true,
            },
          });
        }
        const count = async (table) => (await query(`SELECT count(*)::int n FROM ${table}`))[0].n;
        const batchId = randomUUID(),
          chunkId = randomUUID();
        let first;
        await t.test(
          "preview is read-only; fifty sale/rent rows commit once and replay exact receipt",
          async () => {
            const p = await preview({ batchId, rows }, actor, query);
            assert.deepEqual(p.counts, { create: 50, reuse: 0, blocked: 0 });
            assert.equal(await count("whatsapp_tracking_links"), 0);
            const input = { batchId, chunkId, previewToken: p.previewToken, rows };
            first = await commit(input, actor, query);
            assert.equal(first.state, "committed");
            assert.deepEqual(
              first.rows.map((r) => r.rowKey),
              rows.map((r) => r.rowKey),
            );
            assert.ok(
              first.rows.every((r) => r.outcome === "created" && r.code && r.version === 1),
            );
            assert.deepEqual(await commit(input, actor, query), first);
            assert.equal(await count("whatsapp_tracking_links"), 50);
            assert.equal(await count("whatsapp_tracking_link_versions"), 50);
            assert.equal(await count("whatsapp_link_batch_operations"), 1);
            const raw = await query(
              "SELECT v.property_id,v.public_listing_no,v.deal_type,v.placement_source,v.requested_staff_id,p.title_zh FROM whatsapp_tracking_link_versions v JOIN properties p ON p.id=v.property_id ORDER BY p.listing_no",
            );
            assert.equal(raw.filter((r) => r.deal_type === "sale").length, 25);
            assert.equal(raw.filter((r) => r.deal_type === "rent").length, 25);
            assert.equal(raw.filter((r) => r.placement_source === "28hse").length, 25);
            assert.ok(
              raw.every(
                (r) => r.requested_staff_id === id(102) && r.title_zh.startsWith("合成中文盤"),
              ),
            );
            assert.deepEqual(
              (await read(batchId, actor, query)).operations.map((o) => ({
                batchId: o.batchId,
                chunkId: o.chunkId,
                state: o.state,
                rows: o.rows,
              })),
              [first],
            );
          },
        );
        await t.test(
          "fresh matching preview reuses all fifty without creating links or versions",
          async () => {
            const nextRows = rows.map((r, i) => ({ ...r, rowKey: id(i + 400) }));
            const p = await preview({ batchId: randomUUID(), rows: nextRows }, actor, query);
            assert.deepEqual(p.counts, { create: 0, reuse: 50, blocked: 0 });
            const result = await commit(
              {
                batchId: p.batchId,
                chunkId: randomUUID(),
                previewToken: p.previewToken,
                rows: nextRows,
              },
              actor,
              query,
            );
            assert.ok(result.rows.every((r) => r.outcome === "reused"));
            assert.deepEqual(
              result.rows.map((r) => r.code),
              first.rows.map((r) => r.code),
            );
            assert.equal(await count("whatsapp_tracking_links"), 50);
            assert.equal(await count("whatsapp_tracking_link_versions"), 50);
          },
        );
        await t.test(
          "foreign owner and forged elevated roles cannot read or write the batch",
          async () => {
            await assert.rejects(
              read(batchId, { staffId: id(101), roles: ["manager"] }, query),
              (e) => e instanceof Response && e.status === 404,
            );
            await assert.rejects(
              read(batchId, { staffId: id(102), roles: ["agent"] }, query),
              (e) => e instanceof Response && e.status === 403,
            );
            await assert.rejects(
              preview(
                { batchId: randomUUID(), rows },
                { staffId: id(102), roles: ["manager"] },
                query,
              ),
              (e) => e instanceof Response && e.status === 403,
            );
            assert.equal(await count("whatsapp_tracking_links"), 50);
          },
        );
        await t.test(
          "post-preview withdrawal rejects the whole chunk with fifty independently exportable failures",
          async () => {
            const nextRows = rows.map((r, i) => ({
              ...r,
              rowKey: id(i + 500),
              placementId:
                r.input.placementSource === "website"
                  ? `website:withdrawn-${i}`
                  : String(9000000 + i),
              input: {
                ...r.input,
                externalListingId: r.input.placementSource === "28hse" ? String(9000000 + i) : null,
              },
            }));
            const p = await preview({ batchId: randomUUID(), rows: nextRows }, actor, query);
            assert.deepEqual(p.counts, { create: 50, reuse: 0, blocked: 0 });
            await query("UPDATE properties SET status='offline' WHERE id=$1", [id(1)]);
            const cid = randomUUID();
            const result = await commit(
              { batchId: p.batchId, chunkId: cid, previewToken: p.previewToken, rows: nextRows },
              actor,
              query,
            );
            assert.equal(result.state, "rejected");
            assert.equal(result.rows.filter((r) => r.outcome === "blocked").length, 1);
            assert.equal(result.rows.filter((r) => r.outcome === "failed").length, 49);
            assert.equal(result.rows[0].reasonCode, "WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
            assert.ok(result.rows.slice(1).every((r) => r.reasonCode === "CHUNK_NOT_COMMITTED"));
            const progress = {
              batchId: p.batchId,
              rows: nextRows,
              chunkIds: [cid],
              completed: [result],
              nextChunk: 1,
              uncertain: false,
              preview: p,
            };
            assert.equal(batchResultCsv(progress).trim().split("\r\n").length, 1);
            const failures = batchResultCsv(progress, undefined, "failure");
            assert.equal(failures.trim().split("\r\n").length, 51);
            for (const row of nextRows) assert.ok(failures.includes(row.rowKey));
            assert.ok(!failures.includes("/w/"));
            assert.equal(await count("whatsapp_tracking_links"), 50);
            assert.deepEqual((await read(batchId, actor, query)).operations[0].rows, first.rows);
            await query("UPDATE properties SET status='active' WHERE id=$1", [id(1)]);
          },
        );
        await t.test(
          "duplicate placement and changed or denied staff mapping never provision new links",
          async () => {
            await assert.rejects(
              preview(
                {
                  batchId: randomUUID(),
                  rows: [
                    { ...rows[0], rowKey: randomUUID() },
                    { ...rows[0], rowKey: randomUUID() },
                  ],
                },
                actor,
                query,
              ),
              /WA_LINK_DUPLICATE_PLACEMENT/,
            );
            const p = await preview({ batchId: randomUUID(), rows }, actor, query);
            await query("UPDATE whatsapp_staff_channels SET version=version+1 WHERE staff_id=$1", [
              id(102),
            ]);
            await assert.rejects(
              commit(
                { batchId: p.batchId, chunkId: randomUUID(), previewToken: p.previewToken, rows },
                actor,
                query,
              ),
              (e) => e instanceof Response && e.status === 409,
            );
            await query("UPDATE whatsapp_staff_channels SET eligible=false WHERE staff_id=$1", [
              id(102),
            ]);
            const denied = await preview({ batchId: randomUUID(), rows }, actor, query);
            assert.deepEqual(denied.counts, { create: 0, reuse: 0, blocked: 50 });
            assert.ok(
              denied.rows.every((r) => r.reasons.some((x) => x.code === "WA_LINK_STAFF_NOT_READY")),
            );
            assert.equal(await count("whatsapp_tracking_links"), 50);
            assert.equal(await count("whatsapp_outbound_intents"), 0);
            assert.equal(await count("whatsapp_conversations"), 0);
            assert.equal(network.mock.calls.length, 0);
          },
        );
        await t.test(
          "manual other placement keeps Chinese quoted text literal in actual stored result CSV",
          async () => {
            const row = {
              ...rows[0],
              rowKey: randomUUID(),
              placementId: '=中文,"測試"',
              input: {
                ...rows[0].input,
                placementSource: "other",
                requestedStaffId: null,
                referenceMappingId: null,
              },
            };
            const p = await preview({ batchId: randomUUID(), rows: [row] }, actor, query);
            assert.deepEqual(p.counts, { create: 1, reuse: 0, blocked: 0 });
            const cid = randomUUID();
            const result = await commit(
              { batchId: p.batchId, chunkId: cid, previewToken: p.previewToken, rows: [row] },
              actor,
              query,
            );
            assert.equal(result.state, "committed");
            const [raw] = await query(
              "SELECT l.code,v.public_listing_no,x.placement_id FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version JOIN whatsapp_tracking_link_placements x ON x.link_id=l.id WHERE l.id=$1",
              [result.rows[0].linkId],
            );
            assert.equal(raw.public_listing_no, "A000001");
            assert.equal(raw.placement_id, '=中文,"測試"');
            assert.equal(raw.code, result.rows[0].code);
            const text = batchResultCsv(
              {
                batchId: p.batchId,
                rows: [row],
                chunkIds: [cid],
                completed: [result],
                nextChunk: 1,
                uncertain: false,
                preview: p,
              },
              "other",
            );
            assert.ok(text.includes('"\'=中文,""測試"""'));
            assert.ok(text.includes(`/w/${raw.code}`));
            assert.equal(await count("whatsapp_tracking_links"), 51);
            assert.equal(await count("whatsapp_outbound_intents"), 0);
            assert.equal(network.mock.calls.length, 0);
          },
        );
      });
    } finally {
      network.mock.restore();
      if (previous === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
      else process.env.EP_WA_COMPANY_CHANNEL_ID = previous;
    }
  },
);
