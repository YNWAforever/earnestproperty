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
    const networkGuard = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Provider/network request forbidden in owned quality acceptance");
    });
    await withOwnedPostgres(async ({ query, transaction, migrationCount }) => {
      assert.equal(migrationCount, 85);
      let beforeRead = null;
      const readQuery = async (sql, params) => {
        if (beforeRead) await beforeRead(sql, params);
        return query(sql, params);
      };
      await mockOwnedServerDb(mock, readQuery, transaction);
      const { INQUIRY_ROWS_SQL, EVENT_ROWS_SQL } = await import("./sales-performance.queries.mjs");
      const {
        getSalesPerformance,
        listPerformanceRecords,
        getPerformanceFilterOptions,
        reviseInquiryQuality,
      } = await import("./sales-performance.server.ts");
      const { revisePerformanceEventQuality, qualifyLeadForPerformance } =
        await import("./performance-events.server.ts");
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
      for (const n of [0, 1, 2])
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
          id(600 + n),
        ]);
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
      // A real current grant is required; a role label in the test actor is not authority.
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [id(600)]);
      const admin = { ...actor(0), roles: ["admin"] };
      const scoped = { ...filters, branchId: id(500) };
      await t.test(
        "actual inquiry corrections append retained actor reason and reconcile the same scoped denominator",
        async () => {
          const before = await query("SELECT * FROM inquiries WHERE id=$1", [id(1)]);
          const result = await reviseInquiryQuality(
            { inquiryId: id(1), quality: "test", reason: "Owned verified test correction" },
            admin,
          );
          assert.deepEqual(result, { inquiryId: id(1), affectedHkDay: "2026-09-30" });
          const report = await getSalesPerformance(scoped, admin);
          const records = await listPerformanceRecords(
            { filters: scoped, drilldownKey: "inquiries" },
            admin,
          );
          assert.equal(report.acquisition.inquiries.value, 3);
          assert.deepEqual(records.records.map((r) => r.id).sort(), [id(2), id(3), id(4)]);
          const raw = await query(
            "SELECT quality FROM inquiry_quality_records WHERE inquiry_id=$1",
            [id(1)],
          );
          assert.equal(raw[0].quality, "test");
          assert.deepEqual(await query("SELECT * FROM inquiries WHERE id=$1", [id(1)]), before);
          await reviseInquiryQuality(
            { inquiryId: id(1), quality: "production", reason: "Owned verified genuine inquiry" },
            admin,
          );
          assert.equal((await getSalesPerformance(scoped, admin)).acquisition.inquiries.value, 4);
          const history = await query(
            "SELECT quality,reason,changed_by::text FROM inquiry_quality_revisions WHERE inquiry_id=$1 ORDER BY id",
            [id(1)],
          );
          assert.deepEqual(
            history.map((r) => r.quality),
            ["production", "test", "production"],
          );
          assert.ok(history.every((r) => r.changed_by === id(600)));
          assert.equal(history[1].reason, "Owned verified test correction");
          await assert.rejects(
            query("DELETE FROM inquiry_quality_revisions WHERE inquiry_id=$1", [id(1)]),
            /append-only/,
          );
        },
      );
      await t.test(
        "actual response event corrections retain authoritative event identity and never turn assignment into response",
        async () => {
          const original = await query(
            "SELECT * FROM performance_events WHERE event_type='human_response' AND inquiry_id=$1",
            [id(2)],
          );
          assert.equal(original.length, 1);
          const key = original[0].event_key;
          const originalRevisions = await query(
            "SELECT quality,reason,changed_by::text FROM performance_event_quality_revisions WHERE event_key=$1 ORDER BY id",
            [key],
          );
          const result = await revisePerformanceEventQuality(
            { eventKey: key, quality: "test", reason: "Owned verified test response evidence" },
            admin,
          );
          assert.deepEqual(result, { eventKey: key, affectedHkDay: "2026-09-30" });
          const report = await getSalesPerformance(scoped, admin);
          assert.equal(report.acquisition.inquiries.value, 4);
          assert.equal(report.followup.responseMedianMinutes.value, null);
          assert.equal(report.followup.unanswered.value, 4);
          assert.equal(report.followup.confirmedAssignments.value, 1);
          assert.equal(
            (await listPerformanceRecords({ filters: scoped, drilldownKey: "responses" }, admin))
              .records.length,
            0,
          );
          assert.deepEqual(
            await query(
              "SELECT * FROM performance_events WHERE event_type='human_response' AND inquiry_id=$1",
              [id(2)],
            ),
            original,
          );
          await revisePerformanceEventQuality(
            {
              eventKey: key,
              quality: "production",
              reason: "Owned verified genuine response evidence",
            },
            admin,
          );
          assert.equal(
            (await getSalesPerformance(scoped, admin)).followup.responseMedianMinutes.value,
            15,
          );
          const revisions = await query(
            "SELECT quality,reason,changed_by::text FROM performance_event_quality_revisions WHERE event_key=$1 ORDER BY id",
            [key],
          );
          assert.deepEqual(
            revisions.map((r) => r.quality),
            [...originalRevisions.map((r) => r.quality), "test", "production"],
          );
          assert.deepEqual(revisions.slice(0, originalRevisions.length), originalRevisions);
          assert.ok(revisions.every((r) => r.changed_by === id(600)));
          await assert.rejects(
            query("DELETE FROM performance_event_quality_revisions WHERE event_key=$1", [key]),
            /append-only/,
          );
        },
      );
      await t.test(
        "manager and invalid unknown missing-source corrections produce no quality revision",
        async () => {
          const counts = () =>
            query(
              "SELECT (SELECT count(*)::int FROM inquiry_quality_revisions) AS inquiry,(SELECT count(*)::int FROM performance_event_quality_revisions) AS event",
            );
          const before = await counts();
          const [response] = await query(
            "SELECT event_key FROM performance_events WHERE event_type='human_response' AND inquiry_id=$1",
            [id(2)],
          );
          const bad = (status) => (err) => err instanceof Response && err.status === status;
          await assert.rejects(
            reviseInquiryQuality(
              { inquiryId: id(1), quality: "test", reason: "Manager cannot revise quality" },
              actor(0),
            ),
            bad(403),
          );
          await assert.rejects(
            revisePerformanceEventQuality(
              {
                eventKey: response.event_key,
                quality: "test",
                reason: "Manager cannot revise quality",
              },
              actor(0),
            ),
            bad(403),
          );
          await assert.rejects(reviseInquiryQuality({}, admin), bad(400));
          await assert.rejects(
            reviseInquiryQuality(
              { inquiryId: id(1), quality: "mystery", reason: "Owned unknown quality refused" },
              admin,
            ),
            bad(400),
          );
          await assert.rejects(
            revisePerformanceEventQuality(
              { eventKey: response.event_key, quality: "unknown", reason: "" },
              admin,
            ),
            bad(400),
          );
          await assert.rejects(
            revisePerformanceEventQuality(
              {
                eventKey: `human_response:${id(999)}`,
                quality: "test",
                reason: "Owned missing event refused",
              },
              admin,
            ),
            bad(404),
          );
          assert.deepEqual(await counts(), before);
        },
      );
      for (const [kind, revise, source, historySql, sourceSql] of [
        [
          "inquiry",
          reviseInquiryQuality,
          { inquiryId: id(1) },
          "SELECT * FROM inquiry_quality_revisions WHERE inquiry_id=$1 ORDER BY id",
          "SELECT * FROM inquiries WHERE id=$1",
        ],
        [
          "event",
          revisePerformanceEventQuality,
          { eventKey: `human_response:${id(2)}` },
          "SELECT * FROM performance_event_quality_revisions WHERE event_key=$1 ORDER BY id",
          "SELECT * FROM performance_events WHERE event_key=$1",
        ],
      ]) {
        for (const [index, change] of [
          [0, "inactive"],
          [1, "role-revoked"],
          [2, "account-rebound"],
          [3, "downgraded-manager"],
        ]) {
          await t.test(
            `${kind} quality rechecks admin after ${change} before revision`,
            async () => {
              const staff = id((kind === "inquiry" ? 650 : 660) + index),
                auth = `owned-quality-${kind}-${index}`,
                key = source.inquiryId ?? source.eventKey;
              await query(
                "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
                [staff, auth, `${auth}@example.invalid`, id(501)],
              );
              await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [
                staff,
              ]);
              const cached = { staffId: staff, authUserId: auth, roles: ["admin"] };
              if (change === "inactive")
                await query("UPDATE staff_users SET active=false WHERE id=$1", [staff]);
              if (change === "role-revoked" || change === "downgraded-manager")
                await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
              if (change === "downgraded-manager")
                await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
                  staff,
                ]);
              if (change === "account-rebound")
                await query("UPDATE staff_users SET auth_user_id=$2 WHERE id=$1", [
                  staff,
                  auth + "-new",
                ]);
              const history = await query(historySql, [key]),
                original = await query(sourceSql, [key]);
              await assert.rejects(
                revise(
                  {
                    ...source,
                    quality: "test",
                    reason: "Owned revoked authority cannot revise quality",
                  },
                  cached,
                ),
                (e) => e instanceof Response && e.status === 403,
              );
              assert.deepEqual(await query(historySql, [key]), history);
              assert.deepEqual(await query(sourceSql, [key]), original);
            },
          );
        }
      }
      for (const [index, role, change] of [
        [0, "manager", "inactive"],
        [1, "manager", "role-revoked"],
        [2, "manager", "account-rebound"],
        [3, "admin", "inactive"],
        [4, "admin", "role-revoked"],
        [5, "admin", "account-rebound"],
      ]) {
        await t.test(
          `qualification rechecks ${role} after ${change} before immutable write`,
          async () => {
            const staff = id(630 + index),
              lead = id(1100 + index),
              auth = `owned-qualification-${index}`;
            await query(
              "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
              [staff, auth, `${auth}@example.invalid`, id(500)],
            );
            await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staff, role]);
            await query(
              "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','contacted',$2)",
              [lead, id(600)],
            );
            const cached = { staffId: staff, authUserId: auth, roles: [role] };
            if (change === "inactive")
              await query("UPDATE staff_users SET active=false WHERE id=$1", [staff]);
            if (change === "role-revoked")
              await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
            if (change === "account-rebound")
              await query("UPDATE staff_users SET auth_user_id=$2 WHERE id=$1", [
                staff,
                auth + "-new",
              ]);
            await assert.rejects(
              qualifyLeadForPerformance(
                {
                  leadId: lead,
                  qualifiedAt: "2026-09-30T02:00:00Z",
                  evidence: "Owned real qualification evidence in isolated fixture",
                },
                cached,
              ),
              (e) => e instanceof Response && e.status === 403,
            );
            assert.deepEqual(
              await query("SELECT lead_id FROM crm_lead_qualifications WHERE lead_id=$1", [lead]),
              [],
            );
            assert.deepEqual(
              await query("SELECT event_key FROM performance_events WHERE lead_id=$1", [lead]),
              [],
            );
          },
        );
      }
      await t.test(
        "qualification cached admin downgrade cannot authorize a foreign branch",
        async () => {
          const staff = id(640),
            lead = id(1110),
            auth = "owned-qualification-downgrade";
          await query(
            "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
            [staff, auth, auth + "@example.invalid", id(501)],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [staff]);
          await query(
            "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','contacted',$2)",
            [lead, id(600)],
          );
          await assert.rejects(
            qualifyLeadForPerformance(
              {
                leadId: lead,
                qualifiedAt: "2026-09-30T02:00:00Z",
                evidence: "Owned foreign branch evidence must be refused",
              },
              { staffId: staff, authUserId: auth, roles: ["admin"] },
            ),
            (e) => e instanceof Response && [403, 409].includes(e.status),
          );
          assert.deepEqual(
            await query("SELECT lead_id FROM crm_lead_qualifications WHERE lead_id=$1", [lead]),
            [],
          );
          assert.deepEqual(
            await query("SELECT event_key FROM performance_events WHERE lead_id=$1", [lead]),
            [],
          );
        },
      );
      await t.test(
        "qualification keeps one authoritative source and unknown quality until explicit review",
        async () => {
          const lead = id(103),
            qualifiedAt = "2026-09-30T16:10:00Z";
          await query(
            "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager') ON CONFLICT DO NOTHING",
            [id(600)],
          );
          await query("UPDATE crm_leads SET stage='contacted',assigned_agent_id=$2 WHERE id=$1", [
            lead,
            id(600),
          ]);
          const before = await query("SELECT * FROM crm_leads WHERE id=$1", [lead]);
          const input = {
            leadId: lead,
            qualifiedAt,
            evidence: "  Owned independently verified requirements and contact  ",
          };
          const outcomes = await Promise.allSettled([
            qualifyLeadForPerformance(input, actor(0)),
            qualifyLeadForPerformance(input, actor(0)),
          ]);
          assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 2);
          assert.ok(
            outcomes.every(
              (r) => r.status === "fulfilled" && r.value.eventKey === `lead_qualified:${lead}`,
            ),
          );
          const key = `lead_qualified:${lead}`;
          const raw = await query(
            "SELECT lead_id::text,qualified_at,evidence,qualified_by::text FROM crm_lead_qualifications WHERE lead_id=$1",
            [lead],
          );
          assert.equal(raw.length, 1);
          assert.equal(raw[0].qualified_by, id(600));
          assert.equal(raw[0].evidence, input.evidence.trim());
          assert.equal(
            new Date(raw[0].qualified_at).toISOString(),
            new Date(qualifiedAt).toISOString(),
          );
          const projected = await query(
            "SELECT event_key,source_id,lead_id::text,staff_id::text,branch_id_at_event::text,source,quality FROM performance_event_records WHERE event_key=$1",
            [key],
          );
          assert.deepEqual(projected, [
            {
              event_key: key,
              source_id: lead,
              lead_id: lead,
              staff_id: id(600),
              branch_id_at_event: id(500),
              source: `crm_lead:${lead}`,
              quality: "unknown",
            },
          ]);
          assert.equal(
            (await getSalesPerformance(filters, actor(0))).acquisition.qualifiedLeads.value,
            0,
          );
          const unknown = await listPerformanceRecords(
            { filters, drilldownKey: "quality_unknown_events" },
            actor(0),
          );
          assert.ok(unknown.records.some((r) => r.eventKey === key));
          await revisePerformanceEventQuality(
            {
              eventKey: key,
              quality: "production",
              reason: "Owned explicit quality review of qualification evidence",
            },
            admin,
          );
          const report = await getSalesPerformance(filters, actor(0));
          assert.equal(report.acquisition.qualifiedLeads.value, 1);
          assert.equal(report.acquisition.qualifiedLeads.denominator, 4);
          assert.equal(report.followup.confirmedAssignments.value, 1);
          assert.equal(report.followup.responseMedianMinutes.value, 15);
          assert.equal(report.followup.unanswered.value, 3);
          const page = await listPerformanceRecords(
            { filters, drilldownKey: "qualified" },
            actor(0),
          );
          assert.equal(page.records.length, 1);
          assert.equal(page.records[0].eventKey, key);
          assert.deepEqual(await query("SELECT * FROM crm_leads WHERE id=$1", [lead]), before);
          await assert.rejects(
            query("DELETE FROM crm_lead_qualifications WHERE lead_id=$1", [lead]),
            /append-only/,
          );
        },
      );
      await t.test(
        "qualification rejects malformed UUID and ineligible sources before projection",
        async () => {
          const valid = {
            leadId: id(103),
            qualifiedAt: "2026-09-30T02:00:00Z",
            evidence: "Owned invalid source must never add evidence",
          };
          const bad = (status) => (e) => e instanceof Response && e.status === status;
          await assert.rejects(
            qualifyLeadForPerformance({ ...valid, leadId: valid.leadId + "a" }, actor(0)),
            bad(400),
          );
          await assert.rejects(
            qualifyLeadForPerformance({ ...valid, leadId: id(1199) }, actor(0)),
            bad(409),
          );
          await assert.rejects(
            qualifyLeadForPerformance({ ...valid, evidence: "short" }, actor(0)),
            bad(400),
          );
          await assert.rejects(
            qualifyLeadForPerformance({ ...valid, qualifiedAt: "bad-date" }, actor(0)),
            bad(400),
          );
          await assert.rejects(
            qualifyLeadForPerformance(valid, { ...actor(0), roles: ["agent"] }),
            bad(403),
          );
          const lead = id(1198);
          await query(
            "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','new',$2)",
            [lead, id(600)],
          );
          await assert.rejects(
            qualifyLeadForPerformance({ ...valid, leadId: lead }, actor(0)),
            bad(409),
          );
          assert.deepEqual(
            await query(
              "SELECT lead_id FROM crm_lead_qualifications WHERE lead_id=ANY($1::uuid[])",
              [[lead, id(1199)]],
            ),
            [],
          );
        },
      );
      const retryInput = (lead) => ({
        leadId: lead,
        qualifiedAt: "2026-09-30T02:00:00Z",
        evidence: "Owned original qualification evidence after lost response",
      });
      const seedRetryLead = (lead, staff = id(600)) =>
        query(
          "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','contacted',$2)",
          [lead, staff],
        );
      const retryFacts = async (lead) => ({
        qualification: await query("SELECT * FROM crm_lead_qualifications WHERE lead_id=$1", [
          lead,
        ]),
        projection: await query(
          "SELECT * FROM performance_events WHERE lead_id=$1 ORDER BY event_key",
          [lead],
        ),
      });
      await t.test(
        "committed qualification with lost response replays the original actor time evidence without another write",
        async () => {
          const lead = id(1220),
            original = retryInput(lead);
          await seedRetryLead(lead);
          await assert.rejects(async () => {
            await qualifyLeadForPerformance(original, actor(0));
            throw Error("Owned transport lost after actual commit");
          }, /Owned transport lost/);
          const before = await retryFacts(lead);
          assert.equal(before.qualification.length, 1);
          assert.equal(before.projection.length, 1);
          assert.deepEqual(await qualifyLeadForPerformance(original, actor(0)), {
            eventKey: `lead_qualified:${lead}`,
          });
          assert.deepEqual(await retryFacts(lead), before);
        },
      );
      await t.test(
        "qualification replay is a current scoped read after stage changes and loses access after reassignment",
        async () => {
          const lead = id(1221),
            original = retryInput(lead);
          await seedRetryLead(lead);
          await qualifyLeadForPerformance(original, actor(0));
          await query("UPDATE crm_leads SET stage='closed_lost' WHERE id=$1", [lead]);
          const before = await retryFacts(lead);
          assert.deepEqual(await qualifyLeadForPerformance(original, actor(0)), {
            eventKey: `lead_qualified:${lead}`,
          });
          await query("UPDATE crm_leads SET assigned_agent_id=$2 WHERE id=$1", [lead, id(601)]);
          await assert.rejects(
            qualifyLeadForPerformance(original, actor(0)),
            (e) => e instanceof Response && e.status === 409,
          );
          assert.deepEqual(await retryFacts(lead), before);
        },
      );
      await t.test(
        "qualification replay rejects different evidence time and actor and retains the accepted source",
        async () => {
          const lead = id(1222),
            original = retryInput(lead);
          await seedRetryLead(lead);
          await qualifyLeadForPerformance(original, actor(0));
          await query(
            "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager') ON CONFLICT DO NOTHING",
            [id(602)],
          );
          const before = await retryFacts(lead);
          for (const [input, access] of [
            [
              { ...original, evidence: "Owned conflicting replacement qualification evidence" },
              actor(0),
            ],
            [{ ...original, qualifiedAt: "2026-09-30T03:00:00Z" }, actor(0)],
            [original, actor(2)],
          ])
            await assert.rejects(
              qualifyLeadForPerformance(input, access),
              (e) => e instanceof Response && e.status === 409,
            );
          assert.deepEqual(await retryFacts(lead), before);
        },
      );
      await t.test(
        "qualification replay rechecks current account active grant and Auth binding",
        async () => {
          for (const [index, change] of [
            [0, "inactive"],
            [1, "role-revoked"],
            [2, "account-rebound"],
          ]) {
            const staff = id(680 + index),
              auth = `owned-replay-actor-${index}`,
              lead = id(1230 + index),
              original = retryInput(lead),
              access = { staffId: staff, authUserId: auth, roles: ["manager"] };
            await query(
              "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
              [staff, auth, auth + "@example.invalid", id(500)],
            );
            await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
              staff,
            ]);
            await seedRetryLead(lead, staff);
            await qualifyLeadForPerformance(original, access);
            const before = await retryFacts(lead);
            if (change === "inactive")
              await query("UPDATE staff_users SET active=false WHERE id=$1", [staff]);
            if (change === "role-revoked")
              await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
            if (change === "account-rebound")
              await query("UPDATE staff_users SET auth_user_id=$2 WHERE id=$1", [
                staff,
                auth + "-new",
              ]);
            await assert.rejects(
              qualifyLeadForPerformance(original, access),
              (e) => e instanceof Response && e.status === 403,
            );
            assert.deepEqual(await retryFacts(lead), before);
          }
        },
      );
      const readers = [
        ["report", (access) => getSalesPerformance(filters, access)],
        [
          "records",
          (access) => listPerformanceRecords({ filters, drilldownKey: "inquiries" }, access),
        ],
        ["options", (access) => getPerformanceFilterOptions(access)],
      ];
      const createReadActor = async (n, role = "manager", cachedRole = role) => {
        const staff = id(n),
          auth = `owned-performance-read-${n}`;
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,branch_id) VALUES($1,$2,$3,$4)",
          [staff, auth, `${auth}@example.invalid`, id(500)],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staff, role]);
        return { staffId: staff, authUserId: auth, roles: [cachedRole] };
      };
      const readHistory = async () => ({
        inquiryQuality: await query("SELECT * FROM inquiry_quality_revisions ORDER BY id"),
        eventQuality: await query("SELECT * FROM performance_event_quality_revisions ORDER BY id"),
        events: await query("SELECT * FROM performance_events ORDER BY event_key"),
        occurrences: await query(
          "SELECT * FROM performance_event_occurrence_revisions ORDER BY id",
        ),
        qualifications: await query("SELECT * FROM crm_lead_qualifications ORDER BY lead_id"),
      });
      for (const [readerIndex, [name, read]] of readers.entries()) {
        for (const [stateIndex, state] of ["inactive", "revoked", "rebound"].entries()) {
          await t.test(
            `performance ${name} refuses current ${state} account despite cached manager`,
            async () => {
              const access = await createReadActor(760 + readerIndex * 3 + stateIndex);
              const before = await readHistory();
              if (state === "inactive")
                await query("UPDATE staff_users SET active=false WHERE id=$1", [access.staffId]);
              else if (state === "revoked")
                await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [access.staffId]);
              else
                await query("UPDATE staff_users SET auth_user_id=$2 WHERE id=$1", [
                  access.staffId,
                  access.authUserId + "-new",
                ]);
              await assert.rejects(read(access), (e) => e instanceof Response && e.status === 403);
              assert.deepEqual(await readHistory(), before);
            },
          );
        }
        await t.test(
          `performance ${name} restricts cached admin to current manager branch`,
          async () => {
            const access = await createReadActor(790 + readerIndex, "admin");
            await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [access.staffId]);
            await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
              access.staffId,
            ]);
            const before = await readHistory(),
              result = await read(access);
            const raw = await query(
              "SELECT i.id::text AS id FROM inquiries i JOIN inquiry_quality_records q ON q.inquiry_id=i.id AND q.quality='production' JOIN staff_users owner ON owner.id=i.assigned_agent_id WHERE owner.branch_id=$1 AND (i.created_at AT TIME ZONE 'Asia/Hong_Kong')::date='2026-09-30' ORDER BY i.id",
              [id(500)],
            );
            assert.ok(raw.length > 0);
            if (name === "report") assert.equal(result.acquisition.inquiries.value, raw.length);
            else if (name === "records") {
              assert.deepEqual(
                result.records.map((r) => r.id).sort(),
                raw.map((r) => r.id),
              );
              assert.ok(!result.records.some((r) => r.id === id(91)));
            } else {
              assert.equal(result.canCorrect, false);
              assert.deepEqual(
                result.branches.map((r) => r.id),
                [id(500)],
              );
              assert.ok(
                result.staff.length > 0 && result.staff.every((r) => r.branchId === id(500)),
              );
            }
            assert.deepEqual(await readHistory(), before);
          },
        );
        await t.test(
          `performance ${name} revalidates current authority before output`,
          async () => {
            const access = await createReadActor(810 + readerIndex),
              before = await readHistory();
            let changed = false;
            beforeRead = async (sql) => {
              if (
                name === "options" ? sql.includes("FROM branches WHERE") : sql === INQUIRY_ROWS_SQL
              ) {
                beforeRead = null;
                changed = true;
                if (name === "report")
                  await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [access.staffId]);
                else if (name === "records")
                  await query("UPDATE staff_users SET auth_user_id=$2 WHERE id=$1", [
                    access.staffId,
                    access.authUserId + "-new",
                  ]);
                else
                  await query("UPDATE staff_users SET branch_id=$2 WHERE id=$1", [
                    access.staffId,
                    id(501),
                  ]);
              }
            };
            try {
              await assert.rejects(read(access), (e) => e instanceof Response && e.status === 403);
              assert.equal(changed, true);
              assert.deepEqual(await readHistory(), before);
            } finally {
              beforeRead = null;
            }
          },
        );
      }
      const seedReadback = async (
        n,
        { owner = null, forgedProjection = false, unassigned = false } = {},
      ) => {
        const access = await createReadActor(n, unassigned ? "admin" : "manager"),
          lead = id(10000 + n),
          inquiry = id(20000 + n);
        const sourceOwner = unassigned ? null : (owner ?? access.staffId),
          qualifiedAt = "2026-09-30T01:00:00.000Z";
        const evidence = `Owned original accepted contact and requirements ${n}`;
        await query(
          "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','contacted',$2)",
          [lead, sourceOwner],
        );
        await query(
          "INSERT INTO inquiries(id,source,name,created_at,customer_message_at,assigned_agent_id,crm_lead_id) VALUES($1,'whatsapp','Owned recovery inquiry','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z',$2,$3)",
          [inquiry, sourceOwner, lead],
        );
        await query(
          "INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by) VALUES($1,'production','Owned recovery inquiry verified',$2)",
          [inquiry, access.staffId],
        );
        if (forgedProjection) {
          await query(
            "INSERT INTO performance_events(event_key,event_type,source_id,lead_id,staff_id,branch_id_at_event,occurred_at,source) VALUES($1,'lead_qualified',$2,$3,$4,$5,$6,'owned-wrong-source')",
            [`lead_qualified:${lead}`, lead, lead, sourceOwner, id(500), qualifiedAt],
          );
          await query(
            "INSERT INTO crm_lead_qualifications(lead_id,qualified_at,evidence,qualified_by) VALUES($1,$2,$3,$4)",
            [lead, qualifiedAt, evidence, access.staffId],
          );
        } else await qualifyLeadForPerformance({ leadId: lead, qualifiedAt, evidence }, access);
        return {
          access,
          lead,
          inquiry,
          expected: { qualifiedAt, evidence, eventKey: `lead_qualified:${lead}` },
        };
      };
      const readbackPage = (access) =>
        listPerformanceRecords({ filters, drilldownKey: "inquiries" }, access);
      for (const [n, name, setup] of [
        [
          880,
          "reads own accepted immutable source without retry and retains unknown quality",
          async () => {},
        ],
        [
          881,
          "reads the accepted source after stage changes without creating a new qualification",
          async (fixture) => {
            await query("UPDATE crm_leads SET stage='new' WHERE id=$1", [fixture.lead]);
          },
        ],
        [
          882,
          "reuses one source for duplicate inquiry rows without duplicating evidence",
          async (fixture) => {
            await query(
              "INSERT INTO inquiries(id,source,name,created_at,customer_message_at,assigned_agent_id,crm_lead_id) VALUES($1,'whatsapp','Owned duplicate recovery inquiry','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z',$2,$3)",
              [id(30000 + 882), fixture.access.staffId, fixture.lead],
            );
            await query(
              "INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by) VALUES($1,'production','Owned duplicate verified',$2)",
              [id(30000 + 882), fixture.access.staffId],
            );
          },
        ],
      ]) {
        await t.test(`qualification readback ${name}`, async () => {
          const fixture = await seedReadback(n);
          await setup(fixture);
          const before = await readHistory();
          const page = await readbackPage(fixture.access),
            selected = page.records.filter((r) => r.leadId === fixture.lead);
          assert.equal(selected.length, n === 882 ? 2 : 1);
          for (const r of selected) assert.deepEqual(r.qualification, fixture.expected);
          const [raw] = await query(
            "SELECT qualified_at,evidence,qualified_by::text AS actor FROM crm_lead_qualifications WHERE lead_id=$1",
            [fixture.lead],
          );
          assert.equal(new Date(raw.qualified_at).toISOString(), fixture.expected.qualifiedAt);
          assert.equal(raw.evidence, fixture.expected.evidence);
          assert.equal(raw.actor, fixture.access.staffId);
          const scoped = { ...filters, staffId: fixture.access.staffId };
          assert.equal(
            (await getSalesPerformance(scoped, fixture.access)).acquisition.qualifiedLeads.value,
            0,
          );
          assert.deepEqual(await readHistory(), before);
        });
      }
      await t.test(
        "qualification readback separates the author from the assigned source colleague",
        async () => {
          const fixture = await seedReadback(883, { owner: id(600) }),
            before = await readHistory();
          const [projection] = await query(
            "SELECT staff_id::text AS owner FROM performance_events WHERE event_key=$1",
            [fixture.expected.eventKey],
          );
          assert.equal(projection.owner, id(600));
          assert.notEqual(projection.owner, fixture.access.staffId);
          const page = await readbackPage(fixture.access);
          assert.deepEqual(
            page.records.find((r) => r.id === fixture.inquiry).qualification,
            fixture.expected,
          );
          assert.deepEqual(await readHistory(), before);
        },
      );
      await t.test(
        "qualification readback permits own admin source with unassigned owners but restricts a later downgrade",
        async () => {
          const fixture = await seedReadback(891, { unassigned: true }),
            before = await readHistory();
          const record = (await readbackPage(fixture.access)).records.find(
            (r) => r.id === fixture.inquiry,
          );
          assert.deepEqual(record.qualification, fixture.expected);
          await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [fixture.access.staffId]);
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
            fixture.access.staffId,
          ]);
          const downgraded = await readbackPage(fixture.access);
          assert.ok(
            downgraded.records.every(
              (r) => r.id !== fixture.inquiry || r.qualification === undefined,
            ),
          );
          assert.deepEqual(await readHistory(), before);
        },
      );
      await t.test(
        "qualification readback does not expose another author even in the same branch",
        async () => {
          const fixture = await seedReadback(884),
            other = await createReadActor(885),
            before = await readHistory();
          const record = (await readbackPage(other)).records.find((r) => r.id === fixture.inquiry);
          assert.ok(record);
          assert.equal(record.qualification, undefined);
          assert.deepEqual(await readHistory(), before);
        },
      );
      await t.test(
        "qualification readback omits evidence when current lead owner leaves the visible inquiry branch",
        async () => {
          const fixture = await seedReadback(886);
          await query("UPDATE crm_leads SET assigned_agent_id=$2 WHERE id=$1", [
            fixture.lead,
            id(601),
          ]);
          const before = await readHistory(),
            record = (await readbackPage(fixture.access)).records.find(
              (r) => r.id === fixture.inquiry,
            );
          assert.ok(record);
          assert.equal(record.qualification, undefined);
          assert.deepEqual(await readHistory(), before);
        },
      );
      await t.test(
        "qualification readback does not misattach a source when inquiry lead changes between reads",
        async () => {
          const fixture = await seedReadback(887),
            replacement = id(40887);
          await query(
            "INSERT INTO crm_leads(id,source,stage,assigned_agent_id) VALUES($1,'whatsapp','contacted',$2)",
            [replacement, fixture.access.staffId],
          );
          await qualifyLeadForPerformance(
            {
              leadId: replacement,
              qualifiedAt: fixture.expected.qualifiedAt,
              evidence: "Owned different replacement source evidence",
            },
            fixture.access,
          );
          const before = await readHistory();
          let changed = false;
          beforeRead = async (sql) => {
            if (sql === EVENT_ROWS_SQL) {
              beforeRead = null;
              changed = true;
              await query("UPDATE inquiries SET crm_lead_id=$2 WHERE id=$1", [
                fixture.inquiry,
                replacement,
              ]);
            }
          };
          try {
            const record = (await readbackPage(fixture.access)).records.find(
              (r) => r.id === fixture.inquiry,
            );
            assert.equal(changed, true);
            assert.equal(record.leadId, fixture.lead);
            assert.equal(record.qualification, undefined);
            assert.deepEqual(await readHistory(), before);
          } finally {
            beforeRead = null;
          }
        },
      );
      await t.test(
        "qualification readback omits a mismatched immutable projection source",
        async () => {
          const fixture = await seedReadback(888, { forgedProjection: true }),
            before = await readHistory();
          const record = (await readbackPage(fixture.access)).records.find(
            (r) => r.id === fixture.inquiry,
          );
          assert.equal(record.qualification, undefined);
          assert.deepEqual(await readHistory(), before);
        },
      );
      await t.test(
        "qualification readback rechecks source owner after initial inquiry selection",
        async () => {
          const fixture = await seedReadback(889),
            before = await readHistory();
          let changed = false;
          beforeRead = async (sql) => {
            if (sql === EVENT_ROWS_SQL) {
              beforeRead = null;
              changed = true;
              await query("UPDATE crm_leads SET assigned_agent_id=$2 WHERE id=$1", [
                fixture.lead,
                id(601),
              ]);
            }
          };
          try {
            const record = (await readbackPage(fixture.access)).records.find(
              (r) => r.id === fixture.inquiry,
            );
            assert.equal(changed, true);
            assert.equal(record.qualification, undefined);
            assert.deepEqual(await readHistory(), before);
          } finally {
            beforeRead = null;
          }
        },
      );
      await t.test(
        "qualification readback refuses revoked current authority without changing any source",
        async () => {
          const fixture = await seedReadback(890),
            before = await readHistory();
          let changed = false;
          beforeRead = async (sql) => {
            if (sql === EVENT_ROWS_SQL) {
              beforeRead = null;
              changed = true;
              await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [
                fixture.access.staffId,
              ]);
            }
          };
          try {
            await assert.rejects(
              readbackPage(fixture.access),
              (e) => e instanceof Response && e.status === 403,
            );
            assert.equal(changed, true);
            assert.deepEqual(await readHistory(), before);
          } finally {
            beforeRead = null;
          }
        },
      );
    });
    assert.equal(networkGuard.mock.calls.length, 0);
  },
);
