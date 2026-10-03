import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test(
  "performance report and drilldown independently reconcile owned full-schema facts",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction, migrationCount }) => {
      assert.equal(migrationCount, 85);
      await mockOwnedServerDb(mock, query, transaction);
      const { getSalesPerformance, listPerformanceRecords, getPerformanceFilterOptions } =
        await import("./sales-performance.server.ts");
      for (const n of [0, 1])
        await query("INSERT INTO branches(id,slug,name) VALUES($1,$2,$3)", [
          id(500 + n),
          `owned-performance-${n}`,
          `Owned branch ${n}`,
        ]);
      for (const n of [0, 1, 2])
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
          [
            id(600 + n),
            `owned-performance-actor-${n}`,
            `owned-performance-${n}@example.invalid`,
            id(n === 1 ? 501 : 500),
          ],
        );
      const actor = (n) => ({
        staffId: id(600 + n),
        authUserId: `owned-performance-actor-${n}`,
        roles: ["manager"],
      });
      for (const n of [1, 2, 3, 5, 6, 7, 8, 91])
        await query("INSERT INTO crm_leads(id,source) VALUES($1,'whatsapp')", [id(100 + n)]);
      await query(
        "INSERT INTO properties(id,listing_no,title_zh,deal_type,district_slug) VALUES($1,'OWNED-PERFORMANCE-SALE','Owned sale','sale','owned'),($2,'OWNED-PERFORMANCE-RENT','Owned rent','rent','owned')",
        [id(800), id(801)],
      );
      await query(
        "INSERT INTO whatsapp_tracking_links(id,code,created_by) VALUES($1,'OwnedPerformanceLink0001',$2)",
        [id(900), id(600)],
      );
      await query(
        "INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type) VALUES($1,1,'owned-performance','website','sales')",
        [id(900)],
      );
      await query(
        "INSERT INTO whatsapp_link_opens(id,reference_hash,link_id,link_version,channel_id,context_snapshot) VALUES($1,$2,$3,1,'owned-performance','{}')",
        [id(901), "a".repeat(64), id(900)],
      );
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 91]) {
        const at =
          n === 1
            ? "2026-09-29T16:01:00Z"
            : n === 3
              ? "2026-09-30T15:59:00Z"
              : n === 5
                ? "2026-09-30T16:01:00Z"
                : "2026-09-30T00:00:00Z";
        const owner = n === 91 ? id(601) : id(600),
          quality = n === 6 ? "test" : n === 7 ? "spam" : n === 8 ? "unknown" : "production";
        await query(
          "INSERT INTO inquiries(id,source,name,created_at,customer_message_at,assigned_agent_id,crm_lead_id,property_id,attribution_method,link_open_id) VALUES($1,'whatsapp','Owned synthetic inquiry',$2,$2,$3,$4,$5,$6,$7)",
          [
            id(n),
            at,
            owner,
            id(100 + (n === 4 ? 1 : n)),
            id(n === 2 ? 801 : 800),
            n === 2 ? "reference" : "unknown",
            n === 2 ? id(901) : null,
          ],
        );
        await query(
          "INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by) VALUES($1,$2,'Owned verified quality',$3)",
          [id(n), quality, id(600)],
        );
      }
      await query(
        "INSERT INTO performance_events(event_key,event_type,source_id,inquiry_id,staff_id,branch_id_at_event,occurred_at,source) VALUES($1,'assignment_confirmed','owned-assignment',$2,$3,$4,'2026-09-30T00:05:00Z','owned-fixture')",
        ["assignment_confirmed:owned-assignment", id(1), id(600), id(500)],
      );
      // Use the actual human-response projection trigger; assignment-only inquiry1 remains unanswered.
      await query(
        "UPDATE inquiries SET first_human_response_at='2026-09-30T00:15:00Z',first_human_response_staff_id=$2 WHERE id=$1",
        [id(2), id(600)],
      );
      await query(
        "INSERT INTO performance_event_quality_revisions(event_key,quality,reason,changed_by) SELECT event_key,'production','Owned verified event',$1 FROM performance_events WHERE inquiry_id=ANY($2::uuid[])",
        [id(600), [id(1), id(2)]],
      );
      for (const n of [0, 1]) {
        const deal = n ? "rent" : "sale",
          tid = id(700 + n),
          lead = id(101 + n);
        await query(
          "INSERT INTO transactions(id,deal_type,price,agent_id,verification_state,deal_date) VALUES($1,$2,$3,$4,'verified','2026-09-30')",
          [tid, deal, n ? "18000" : "10000000", id(600)],
        );
        await query(
          "INSERT INTO transaction_performance_versions(transaction_id,version,attribution_status,deal_type,lead_id,confirmed_at,commission_receivable,reason,changed_by) VALUES($1,1,'verified_attributed',$2,$3,'2026-09-30T01:00:00Z',$4,'Owned verified close',$5)",
          [tid, deal, lead, n ? null : "100000", id(600)],
        );
        await query(
          "INSERT INTO transaction_performance(transaction_id,version,attribution_status,lead_id,confirmed_at,commission_receivable,updated_by) VALUES($1,1,'verified_attributed',$2,'2026-09-30T01:00:00Z',$3,$4)",
          [tid, lead, n ? null : "100000", id(600)],
        );
        await query(
          "INSERT INTO performance_event_quality_revisions(event_key,quality,reason,changed_by) VALUES($1,'production','Owned verified deal',$2)",
          [`deal_confirmed:${tid}:1`, id(600)],
        );
        await query(
          "INSERT INTO transaction_agent_credits(transaction_id,version,staff_id,branch_id_at_close,share_bps) VALUES($1,1,$2,$3,$4)",
          [tid, id(600), id(500), n ? 10000 : 6000],
        );
        if (!n)
          await query(
            "INSERT INTO transaction_agent_credits(transaction_id,version,staff_id,branch_id_at_close,share_bps) VALUES($1,1,$2,$3,4000)",
            [tid, id(602), id(500)],
          );
      }
      const filters = {
        start: "2026-09-30",
        end: "2026-09-30",
        branchId: null,
        staffId: null,
        source: null,
        dealType: null,
        cohortWindowDays: 90,
      };
      await t.test(
        "HK day quality and duplicate lead totals equal independently read inquiry records",
        async () => {
          const report = await getSalesPerformance(filters, actor(0)),
            page = await listPerformanceRecords({ filters, drilldownKey: "inquiries" }, actor(0));
          assert.equal(report.acquisition.inquiries.value, 4);
          assert.equal(report.acquisition.uniqueCustomers.value, null);
          assert.equal(report.acquisition.saleConversion.value, 0.25);
          assert.equal(report.acquisition.saleConversion.denominator, 4);
          assert.deepEqual(report.qualityCoverage.inquiries, {
            production: 4,
            test: 1,
            spam: 1,
            unknown: 1,
          });
          assert.deepEqual(page.records.map((r) => r.id).sort(), [id(1), id(2), id(3), id(4)]);
          assert.equal(page.nextCursor, null);
          const [raw] = await query(
            "SELECT count(*)::integer AS count FROM inquiries i JOIN inquiry_quality_records q ON q.inquiry_id=i.id WHERE i.assigned_agent_id=$1 AND q.quality='production' AND (i.created_at AT TIME ZONE 'Asia/Hong_Kong')::date='2026-09-30'",
            [id(600)],
          );
          assert.equal(raw.count, 4);
          assert.equal(report.sourceEvidence.trackedOpenEnquiries.value, 1);
          assert.equal(report.sourceEvidence.unknownOrigin.value, 3);
          assert.equal(report.sourceEvidence.clickToEnquiryRate.value, null);
          assert.equal(report.sourceEvidence.clickToEnquiryRate.denominator, null);
          assert.equal(report.followup.confirmedAssignments.value, 1);
          assert.equal(report.followup.responseMedianMinutes.value, 15);
          assert.equal(report.followup.unanswered.value, 3);
          const replies = await listPerformanceRecords(
            { filters, drilldownKey: "responses" },
            actor(0),
          );
          assert.equal(replies.records.length, 1);
          assert.equal(replies.records[0].id, id(2));
        },
      );
      await t.test(
        "sale rent and immutable credit shares retain company totals and known commission sample",
        async () => {
          const report = await getSalesPerformance(filters, actor(0));
          assert.equal(report.sales.deals.value, 2);
          assert.equal(Number(report.sales.saleValue.value), 10000000);
          assert.equal(Number(report.sales.commissionReceivable.value), 100000);
          assert.equal(report.sales.commissionReceivable.sampleSize, 1);
          assert.equal(
            Number(report.agents.find((a) => a.staffId === id(600)).weightedSaleValue),
            6000000,
          );
          assert.equal(
            Number(report.agents.find((a) => a.staffId === id(602)).weightedSaleValue),
            4000000,
          );
          const rent = { ...filters, dealType: "rent" },
            rentReport = await getSalesPerformance(rent, actor(0)),
            rentRows = await listPerformanceRecords(
              { filters: rent, drilldownKey: "inquiries" },
              actor(0),
            );
          assert.equal(rentReport.acquisition.inquiries.value, 1);
          assert.deepEqual(
            rentRows.records.map((r) => r.id),
            [id(2)],
          );
          assert.equal(rentReport.sales.deals.value, 1);
          const [raw] = await query(
            "SELECT sum(share_bps)::integer AS total FROM transaction_agent_credits WHERE transaction_id=$1",
            [id(700)],
          );
          assert.equal(raw.total, 10000);
        },
      );
      await t.test(
        "manager scopes filter options reports and drilldowns consistently and rejects foreign branch",
        async () => {
          const report = await getSalesPerformance(filters, actor(1)),
            page = await listPerformanceRecords({ filters, drilldownKey: "inquiries" }, actor(1));
          assert.equal(report.acquisition.inquiries.value, 1);
          assert.deepEqual(
            page.records.map((r) => r.id),
            [id(91)],
          );
          const options = await getPerformanceFilterOptions(actor(0));
          assert.deepEqual(
            options.branches.map((b) => b.id),
            [id(500)],
          );
          assert.ok(options.staff.every((s) => s.branchId === id(500)));
          await assert.rejects(
            getSalesPerformance({ ...filters, branchId: id(500) }, actor(1)),
            (e) => e instanceof Response && e.status === 403,
          );
          await assert.rejects(
            listPerformanceRecords(
              { filters: { ...filters, branchId: id(500) }, drilldownKey: "inquiries" },
              actor(1),
            ),
            (e) => e instanceof Response && e.status === 403,
          );
          await assert.rejects(
            getSalesPerformance(filters, { ...actor(0), roles: ["agent"] }),
            (e) => e instanceof Response && e.status === 403,
          );
        },
      );
    });
  },
);
