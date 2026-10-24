// Real PostgreSQL regression entrypoint. No URL/env loading and no auto-run.
// The owned harness must verify a fresh local container/server before calling.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { hashPayload } from "./ingestion-contract.mjs";
import { publishDaily } from "./daily-publication.mjs";

export async function runNamedPublicationRegression({
  pool,
  query: q,
  save,
  target,
  migrationCount,
}) {
  assert.equal(target.host, "127.0.0.1");
  assert.ok(target.port > 0 && /^[a-f0-9]{64}$/.test(target.id));
  const server = (await q("SELECT current_setting('cluster_name') AS cluster"))[0];
  assert.match(server.cluster, /^named-publication-[a-f0-9-]{36}$/);
  const results = [];
  let serial = 0;
  const tables = (
    await q("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).map((r) => r.tablename);
  const fingerprint = async () => {
    const output = {};
    for (const table of tables)
      output[table] = (
        await q(
          `SELECT count(*)::int AS n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM public."${table.replaceAll('"', '""')}" t`,
        )
      )[0];
    return output;
  };
  const admin = async (text, params = []) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.admin_property_write','on',true)");
      await c.query(text, params);
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  };
  const fixture = async () => {
    const n = ++serial,
      source = "28hse_agent_540",
      policy = "no-hermes-v2";
    const ids = [randomUUID(), randomUUID(), randomUUID()],
      observations = ids.map(() => randomUUID());
    const external = [String(8000000 + 3 * n), String(8000001 + 3 * n), String(8000002 + 3 * n)];
    const nos = ["Z" + (100000 + 3 * n), "Z" + (100001 + 3 * n), "Y" + (100002 + 3 * n)];
    const stamp = new Date().toISOString(),
      run = randomUUID(),
      receipt = randomUUID(),
      estate = randomUUID();
    const conflict = { field: "bedrooms", dom: 2, json_ld: 1, resolution: "dom", status: "review" };
    const image = `https://i1.28hse.com/2026/10/${202610000000 + n}_large.jpg`;
    const rows = external.slice(0, 2).map((id, i) =>
      row(id, {
        agency_property_no: nos[i],
        source_url: `https://www.28hse.com/buy/apartment/property-${id}`,
        title: "SYNTHETIC ISOLATED ONLY",
        estate: "SYNTHETIC ESTATE",
        district: "Test",
        block: "9",
        phase: "2A",
        floor: "low",
        unit: null,
        price: 4880000,
        saleable_area: 535,
        gross_area: 698,
        bedrooms: 2,
        bathrooms: 1,
        source_status: "active",
        captured_at: stamp,
        publication: {
          description: "SYNTHETIC ISOLATED ONLY: 535 sqft, low band, 2 bedrooms.",
          images: [image],
        },
        ...(i === 0
          ? {
              raw_payload: {
                source_conflicts: [conflict],
                provider_provenance: {
                  contentSha256: "b".repeat(64),
                  fetchedAt: stamp,
                  resolvedUrl: `https://www.28hse.com/buy/apartment/property-${id}`,
                },
              },
            }
          : {}),
      }),
    );
    const payload = batch(rows, stamp);
    payload.meta.run_id = run;
    const reviewKey = hashPayload({ synthetic: true, n, run });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.admin_property_write','on',true)");
      await c.query("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
      await c.query(
        "INSERT INTO estates(id,slug,name_zh,district_slug) VALUES($1,$2,'SYNTHETIC ESTATE','test')",
        [estate, "synthetic-" + n],
      );
      await c.query(
        "INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version) VALUES($1,CURRENT_DATE,'publish','healthy','fixture-v2')",
        [run],
      );
      await c.query(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,config)
        VALUES($1,'agent:540',$2,'fixture-v2',$2,true,'{"absence_enabled":false}') ON CONFLICT DO NOTHING`,
        [source, policy],
      );
      await c.query(
        `INSERT INTO mls_ingestion_receipts(id,source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,accepted_at,full_snapshot)
        VALUES($1,$2,'agent:540',$3,'fixture-v2',$4,$5,$6,'{"success":true,"summary":{"advertisement_count":2}}',$4,true)`,
        [receipt, source, policy, stamp, hashPayload(payload), run],
      );
      for (let i = 0; i < 3; i++) {
        await c.query(
          `INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,ingestion_owner,ingestion_identity_policy,price,saleable_area,gross_area,bedrooms,bathrooms,floor,estate_id,district_slug)
          VALUES($1,$2,$3,'SYNTHETIC ONLY','sale','draft',$4,$4,4880000,535,698,2,1,'low',$5,'test')`,
          [ids[i], "SYNTHETIC-" + nos[i], nos[i], policy, estate],
        );
        const identity = { agency_property_no: i === 2 ? nos[0] : nos[i] };
        await c.query(
          `INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at)
          VALUES($1,$2,$3,$4,'sale',$5,$6,$7,'valid',$8,$8)`,
          [
            observations[i],
            run,
            source,
            external[i],
            `https://www.28hse.com/buy/apartment/property-${external[i]}`,
            JSON.stringify({
              schemaVersion: 2,
              fields: { bedrooms: 2 },
              identity,
              holdProjection: i === 2,
            }),
            hashPayload({ n, i }),
            stamp,
          ],
        );
        await c.query(
          `INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at,raw_identity)
          VALUES($1,$2,'sale','agent:540',$3,$4,$5,$6,'active','2026-09-01',$7,$8)`,
          [
            source,
            external[i],
            policy,
            observations[i],
            receipt,
            ids[i],
            stamp,
            JSON.stringify({ agency_property_no: nos[i] }),
          ],
        );
        await c.query(
          `INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,link_reason,status,last_seen_run_id,first_seen_at,last_seen_at)
          VALUES($1,$2,$3,'sale','source_id_v2','active',$4,$5,$5)`,
          [ids[i], source, external[i], run, stamp],
        );
      }
      await c.query(
        `INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id)
        VALUES($1,$2,$3,'sale','company_number_changed',$4,$5,$6,$6)`,
        [
          reviewKey,
          source,
          external[2],
          JSON.stringify({
            previousIdentity: { agency_property_no: nos[2] },
            identity: { agency_property_no: nos[0] },
          }),
          observations[2],
          run,
        ],
      );
      await c.query(
        `INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,last_accepted_at,full_receipt_id,full_count)
        VALUES($1,'agent:540',$2,$3,$4,2) ON CONFLICT(source,scope_id,policy_version) DO UPDATE SET last_accepted_at=EXCLUDED.last_accepted_at,full_receipt_id=EXCLUDED.full_receipt_id,full_count=EXCLUDED.full_count`,
        [source, policy, stamp, receipt],
      );
      const asset = randomUUID(),
        contentHash = hashPayload({ syntheticAsset: n, run });
      await c.query(
        "INSERT INTO media_assets(id,url,pathname,content_hash,content_type,size_bytes,owner_type,owner_id) VALUES($1,$2,$3,$4,'image/jpeg',1234,'property',$5)",
        [
          asset,
          `https://owned.invalid/synthetic-${n}.jpg`,
          `synthetic/${n}.jpg`,
          contentHash,
          ids[0],
        ],
      );
      await c.query(
        `INSERT INTO listing_media_records(property_id,observation_id,source_url,owned_media_asset_id,content_hash,detected_mime,size_bytes,eligibility)
        VALUES($1,$2,$3,$4,$5,'image/jpeg',1234,'eligible')`,
        [ids[0], observations[0], image, asset, contentHash],
      );
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
    const [property] = await q(
      "SELECT md5(to_jsonb(p)::text) AS hash FROM properties p WHERE id=$1",
      [ids[0]],
    );
    const [link] = await q(
      "SELECT id FROM property_source_links WHERE source=$1 AND external_listing_id=$2",
      [source, external[0]],
    );
    const [review] = await q(
      "SELECT md5(to_jsonb(r)::text) AS hash FROM mls_ingestion_reviews r WHERE review_key=$1",
      [reviewKey],
    );
    const plan = {
      version: "named-publication-v1",
      source,
      scope_id: "agent:540",
      policy_version: policy,
      payload_hash: hashPayload(payload),
      approval_ref: "PUBLICATION-SYNTHETIC-ISOLATED-ONLY",
      targets: [
        {
          external_id: external[0],
          deal_type: "sale",
          property_id: ids[0],
          agency_property_no: nos[0],
          observation_id: observations[0],
          source_link_id: link.id,
          canonical_row_hash: property.hash,
          dom_conflict: {
            decision: "accept_dom",
            captured_at: stamp,
            content_sha256: "b".repeat(64),
            conflicts_hash: hashPayload([conflict]),
          },
          historical: [
            {
              review_key: reviewKey,
              row_hash: review.hash,
              external_id: external[2],
              previous_agency_no: nos[2],
              proposed_agency_no: nos[0],
              bound_property_id: ids[2],
              decision: "reject_reassignment",
            },
          ],
        },
      ],
    };
    return {
      ids,
      external,
      nos,
      observations,
      receipt,
      source,
      run,
      stamp,
      reviewKey,
      image,
      payload,
      plan,
      clock: Date.parse(stamp) + 3600000,
    };
  };
  const invoke = async (f, { intercept, prepare, ...extra } = {}) => {
    const c = await pool.connect();
    try {
      return await publishDaily({
        payload: f.payload,
        publicationPlan: f.plan,
        publicationPlanHash: hashPayload(f.plan),
        client: intercept ? { query: (sql, params = []) => intercept(sql, params, c) } : c,
        apply: true,
        prepare:
          prepare ??
          (async () => {
            throw Error("MEDIA_DOWNLOAD_FORBIDDEN");
          }),
        now: () => f.clock,
        ...extra,
      });
    } finally {
      c.release();
    }
  };
  const noWrites = async (f, expected, options = {}) => {
    const before = await fingerprint();
    let error;
    try {
      await invoke(f, options);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, "expected rejection: " + expected);
    assert.ok(
      (error.code ?? error.message) === expected,
      `${expected}: actual=${error.code ?? error.message}`,
    );
    assert.deepEqual(
      await fingerprint(),
      before,
      "failed publication must not change any public table row",
    );
    return { rejected: expected, publicTablesCompared: tables.length, zeroChanges: true };
  };
  const check = async (name, run) => {
    let phase = "fixture";
    try {
      const f = await fixture();
      phase = "regression";
      results.push({ name, status: "PASS", proof: await run(f) });
    } catch (error) {
      results.push({
        name,
        status: "FAIL",
        phase,
        code: error.code ?? null,
        message: error.message,
      });
    }
    save("results.json", results);
    console.log(JSON.stringify(results.at(-1)));
  };
  const rehash = async (f) => {
    f.plan.payload_hash = hashPayload(f.payload);
    await q("UPDATE mls_ingestion_receipts SET payload_hash=$2 WHERE id=$1", [
      f.receipt,
      f.plan.payload_hash,
    ]);
  };

  await check(
    "full receipt selects exactly one named draft from two eligible synthetic records",
    async (f) => {
      const before = await fingerprint();
      const r = await invoke(f, { apply: false });
      assert.deepEqual(
        r.ready.map((x) => x.sourceId),
        [f.external[0]],
      );
      assert.equal(f.payload.listings.length, 2);
      assert.deepEqual(await fingerprint(), before);
      return { selected: 1, unchangedFullPayload: true, migrations: migrationCount };
    },
  );
  await check("partial receipt cannot authorize publication", async (f) => {
    await q("UPDATE mls_ingestion_scopes SET full_receipt_id=NULL,full_count=NULL");
    await q("UPDATE mls_ingestion_receipts SET full_snapshot=false WHERE id=$1", [f.receipt]);
    return noWrites(f, "ACCEPTED_CURRENT_FULL_RECEIPT_REQUIRED");
  });
  await check(
    "native deferred baseline trigger rejects downgrading the current full receipt",
    async (f) => {
      const before = await fingerprint();
      await assert.rejects(
        () => q("UPDATE mls_ingestion_receipts SET full_snapshot=false WHERE id=$1", [f.receipt]),
        (error) => error.code === "P0001" && error.message === "MLS_INGESTION_BASELINE_CONFLICT",
      );
      assert.deepEqual(await fingerprint(), before);
      return { deferredBaselineTrigger: true, unchanged: true };
    },
  );
  await check("unsuccessful accepted response cannot authorize publication", async (f) => {
    await q(
      "UPDATE mls_ingestion_receipts SET response=jsonb_set(response,'{success}','false') WHERE id=$1",
      [f.receipt],
    );
    return noWrites(f, "ACCEPTED_CURRENT_FULL_RECEIPT_REQUIRED");
  });
  await check("non-current receipt or acceptance-time drift is blocked", async (f) => {
    await q(
      "UPDATE mls_ingestion_scopes SET last_accepted_at=last_accepted_at+interval '1 second'",
    );
    return noWrites(f, "ACCEPTED_CURRENT_FULL_RECEIPT_REQUIRED");
  });
  await check("receipt payload hash mismatch is blocked", async (f) => {
    await q("UPDATE mls_ingestion_receipts SET payload_hash=$2 WHERE id=$1", [
      f.receipt,
      "e".repeat(64),
    ]);
    return noWrites(f, "ACCEPTED_CURRENT_FULL_RECEIPT_REQUIRED");
  });
  await check("batch past 36-hour limit is blocked", async (f) => {
    f.clock = Date.parse(f.stamp) + 36 * 3600000 + 1;
    return noWrites(f, "STALE_PUBLICATION_BATCH");
  });
  await check("old provider capture cannot borrow a fresh acceptance envelope", async (f) => {
    const old = new Date(Date.parse(f.stamp) - 40 * 3600000).toISOString();
    f.payload.listings[0].captured_at = old;
    f.payload.listings[0].raw_payload.provider_provenance.fetchedAt = old;
    f.plan.targets[0].dom_conflict.captured_at = old;
    await rehash(f);
    return noWrites(f, "STALE_PUBLICATION_SOURCE");
  });
  await check("missing DOM acknowledgement remains blocked", async (f) => {
    f.plan.targets[0].dom_conflict = null;
    return noWrites(f, "PUBLICATION_SOURCE_CONFLICT_UNREVIEWED");
  });
  await check("DOM evidence content hash drift remains blocked", async (f) => {
    f.plan.targets[0].dom_conflict.content_sha256 = "e".repeat(64);
    return noWrites(f, "patch_review_plan_conflict_changed");
  });
  await check("historical review row drift is blocked by real row hash", async (f) => {
    await q("UPDATE mls_ingestion_reviews SET status='resolved' WHERE review_key=$1", [
      f.reviewKey,
    ]);
    return noWrites(f, "patch_historical_review_changed");
  });
  await check("historical accepted identity drift cannot be acknowledged", async (f) => {
    await q(
      'UPDATE mls_source_state SET raw_identity=\'{"agency_property_no":"X999999"}\' WHERE external_listing_id=$1',
      [f.external[2]],
    );
    return noWrites(f, "patch_historical_review_changed");
  });
  await check("unacknowledged proposed-number historical review is held", async (f) => {
    f.plan.targets[0].historical = [];
    const before = await fingerprint();
    const r = await invoke(f);
    assert.equal(r.held[0].reason, "historical_review_required");
    assert.deepEqual(await fingerprint(), before);
    return { held: true };
  });
  await check("direct review cannot be bypassed by historical exclusion", async (f) => {
    await q(
      `INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id)
      VALUES($1,$2,$3,'sale','unknown_field_ownership','{}',$4,$5,$5)`,
      [hashPayload({ direct: f.run }), f.source, f.external[0], f.observations[0], f.run],
    );
    const before = await fingerprint(),
      r = await invoke(f);
    assert.equal(r.held[0].reason, "staff_or_source_review");
    assert.deepEqual(await fingerprint(), before);
    return { held: true };
  });
  await check("new manual field hold blocks publication without clearing content", async (f) => {
    await q(
      "INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,policy_version,selection_reason,active_override) VALUES($1,'description','\"SYNTHETIC MANUAL\"',$2,'no-hermes-v2','manual_override',true)",
      [f.ids[0], f.observations[0]],
    );
    const before = await fingerprint(),
      r = await invoke(f);
    assert.equal(r.held[0].reason, "staff_or_source_review");
    assert.deepEqual(await fingerprint(), before);
    return { manualPreserved: true };
  });
  await check("draft or canonical before-image drift rejects named target", async (f) => {
    await admin("UPDATE properties SET description='SYNTHETIC MANUAL' WHERE id=$1", [f.ids[0]]);
    return noWrites(f, "PUBLICATION_TARGET_CHANGED");
  });
  await check("link identity drift is blocked without rebinding", async (f) => {
    await q("UPDATE property_source_links SET status='rejected' WHERE id=$1", [
      f.plan.targets[0].source_link_id,
    ]);
    return noWrites(f, "patch_review_plan_target_changed");
  });
  await check("locked reread catches a new review after initial preflight", async (f) => {
    let inserted = false,
      afterExternalChange;
    await assert.rejects(
      () =>
        invoke(f, {
          intercept: async (sql, args, c) => {
            if (sql === "BEGIN" && !inserted) {
              inserted = true;
              await q(
                `INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id) VALUES($1,$2,$3,'sale','unknown_field_ownership','{}',$4,$5,$5)`,
                [hashPayload({ late: f.run }), f.source, f.external[0], f.observations[0], f.run],
              );
            }
            if (sql === "BEGIN") afterExternalChange = await fingerprint();
            return c.query(sql, args);
          },
        }),
      /PUBLICATION_TARGET_CHANGED/,
    );
    assert.ok(inserted);
    assert.deepEqual(await fingerprint(), afterExternalChange);
    return { lateReviewPreserved: true, publisherRolledBack: true };
  });
  await check("clock expiry at transaction entry rolls back", async (f) => {
    return noWrites(f, "STALE_PUBLICATION_SOURCE", {
      intercept: async (sql, args, c) => {
        if (sql === "BEGIN") f.clock = Date.parse(f.stamp) + 36 * 3600000 + 1;
        return c.query(sql, args);
      },
    });
  });
  await check("native observation FK remains enforced", async (f) => {
    const before = await fingerprint();
    await assert.rejects(
      () =>
        q(
          "INSERT INTO listing_media_records(property_id,observation_id,source_url,eligibility) VALUES($1,$2,'https://i1.28hse.com/synthetic.jpg','eligible')",
          [f.ids[0], randomUUID()],
        ),
      (e) => e.code === "23503",
    );
    assert.deepEqual(await fingerprint(), before);
    return { foreignKey: "23503" };
  });
  await check("native owner trigger still rejects unmarked edits", async (f) => {
    const before = await fingerprint();
    await assert.rejects(
      () => q("UPDATE properties SET description='SYNTHETIC ILLEGAL' WHERE id=$1", [f.ids[0]]),
      (e) => e.code === "P0001",
    );
    assert.deepEqual(await fingerprint(), before);
    return { ownerTrigger: "P0001" };
  });
  await check("audit failure rolls back status content events and source bookkeeping", async (f) =>
    noWrites(f, "SYNTHETIC_AUDIT_ABORT", {
      intercept: async (sql, args, c) => {
        if (sql.includes("INSERT INTO audit_logs")) throw Error("SYNTHETIC_AUDIT_ABORT");
        return c.query(sql, args);
      },
    }),
  );
  await check(
    "protected field tampering in a real trigger aborts entire transaction",
    async (f) => {
      await q(
        `CREATE FUNCTION synthetic_publication_tamper() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.ids[0]}'::uuid AND NEW.status='active' THEN NEW.price=1; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_publication_tamper BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION synthetic_publication_tamper()`,
      );
      try {
        return await noWrites(f, "PUBLICATION_PROTECTED_FIELDS_CHANGED");
      } finally {
        await q(
          "DROP TRIGGER synthetic_publication_tamper ON properties; DROP FUNCTION synthetic_publication_tamper()",
        );
      }
    },
  );
  await check(
    "atomic table locks block review phantom and concurrent canonical edit",
    async (f) => {
      const before = await fingerprint();
      let entered, release;
      const barrier = new Promise((r) => (entered = r)),
        hold = new Promise((r) => (release = r));
      let pid;
      const writer = invoke(f, {
        intercept: async (sql, args, c) => {
          if (sql.includes("SELECT mr.source_url,a.url")) {
            pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
            entered();
            await hold;
            throw Error("SYNTHETIC_LOCK_ABORT");
          }
          return c.query(sql, args);
        },
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      const other = await pool.connect();
      let locks;
      try {
        await Promise.race([
          barrier,
          writer.then((r) => {
            throw r.error ?? Error("EARLY_COMMIT");
          }),
          pause(7000).then(() => {
            throw Error("BARRIER_TIMEOUT");
          }),
        ]);
        locks = await q(
          "SELECT relation::regclass::text AS name,mode,granted FROM pg_locks WHERE pid=$1 AND mode='ShareRowExclusiveLock' ORDER BY relation",
          [pid],
        );
        for (const name of [
          "properties",
          "mls_ingestion_reviews",
          "mls_source_state",
          "property_source_links",
          "property_sync_fields",
          "property_public_groups",
        ])
          assert.ok(locks.some((l) => l.name === name && l.granted));
        await other.query("SET lock_timeout='150ms'");
        await other.query("SET app.admin_property_write='on'");
        await assert.rejects(
          () =>
            other.query(
              "INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id) VALUES($1,$2,$3,'sale','unknown_field_ownership','{}',$4,$5,$5)",
              [hashPayload({ phantom: f.run }), f.source, f.external[0], f.observations[0], f.run],
            ),
          (e) => e.code === "55P03",
        );
        await assert.rejects(
          () =>
            other.query("UPDATE properties SET description='SYNTHETIC CONCURRENT' WHERE id=$1", [
              f.ids[0],
            ]),
          (e) => e.code === "55P03",
        );
        assert.equal(
          (await q("SELECT status FROM properties WHERE id=$1", [f.ids[0]]))[0].status,
          "draft",
        );
      } finally {
        release();
        await writer;
        await other.query("RESET lock_timeout");
        await other.query("RESET app.admin_property_write");
        other.release();
      }
      assert.equal((await writer).error?.message, "SYNTHETIC_LOCK_ABORT");
      assert.deepEqual(await fingerprint(), before);
      save("lock-proof.json", { pid, locks, blockedCode: "55P03", ordinaryReadsAllowed: true });
      return { locks: locks.length, rollback: true };
    },
  );
  await check(
    "one native synthetic commit preserves history source identity and unrelated draft",
    async (f) => {
      const before = (
        await q("SELECT to_jsonb(p) AS row FROM properties p WHERE id=$1", [f.ids[0]])
      )[0].row;
      const sourceBefore = await q(
        "SELECT to_jsonb(s) AS row FROM mls_source_state s WHERE property_id=ANY($1::uuid[]) ORDER BY property_id",
        [f.ids],
      );
      const r = await invoke(f);
      assert.equal(r.published.length, 1);
      assert.equal(r.published[0].sourceId, f.external[0]);
      const after = (
        await q("SELECT to_jsonb(p) AS row FROM properties p WHERE id=$1", [f.ids[0]])
      )[0].row;
      assert.equal(after.status, "active");
      assert.equal(after.price, before.price);
      assert.equal(after.floor, "low");
      assert.equal(after.description, f.payload.listings[0].publication.description);
      assert.deepEqual(after.images, [`https://owned.invalid/synthetic-${serial}.jpg`]);
      assert.equal(
        (await q("SELECT status FROM properties WHERE id=$1", [f.ids[1]]))[0].status,
        "draft",
      );
      assert.deepEqual(
        await q(
          "SELECT to_jsonb(s) AS row FROM mls_source_state s WHERE property_id=ANY($1::uuid[]) ORDER BY property_id",
          [f.ids],
        ),
        sourceBefore,
      );
      assert.equal(
        (await q("SELECT status FROM mls_ingestion_reviews WHERE review_key=$1", [f.reviewKey]))[0]
          .status,
        "open",
      );
      const audit = await q(
        "SELECT metadata FROM audit_logs WHERE subject_id=$1 AND action='daily-reviewed-publication-v1'",
        [f.ids[0]],
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0].metadata.publicationReview.formalReviewMutation, false);
      assert.equal(
        (
          await q("SELECT count(*)::int AS n FROM listing_change_events WHERE property_id=$1", [
            f.ids[0],
          ])
        )[0].n,
        4,
      );
      const frozen = await fingerprint();
      await assert.rejects(() => invoke(f), /PUBLICATION_TARGET_CHANGED/);
      assert.deepEqual(await fingerprint(), frozen);
      save("synthetic-commit.json", {
        notProduction: true,
        syntheticPropertyId: f.ids[0],
        receiptId: f.receipt,
        sourceId: f.external[0],
        audit: audit[0],
        before,
        after,
      });
      return {
        syntheticOnly: true,
        published: 1,
        replayAdditionalWrites: 0,
        formalReview: "open",
        peerDraft: true,
      };
    },
  );
  await check("lost COMMIT acknowledgement is unknown and never blindly replayed", async (f) => {
    let report;
    await assert.rejects(
      () =>
        invoke(f, {
          onReport: (r) => {
            report = r;
          },
          intercept: async (sql, args, c) => {
            const r = await c.query(sql, args);
            if (sql === "COMMIT") throw Error("SYNTHETIC_COMMIT_ACK_LOST");
            return r;
          },
        }),
      /SYNTHETIC_COMMIT_ACK_LOST/,
    );
    assert.equal(report.unknown[0].reason, "commit_outcome_unknown");
    assert.equal(report.published.length, 0);
    assert.equal(
      (await q("SELECT status FROM properties WHERE id=$1", [f.ids[0]]))[0].status,
      "active",
    );
    const before = await fingerprint();
    await assert.rejects(() => invoke(f), /PUBLICATION_TARGET_CHANGED/);
    assert.deepEqual(await fingerprint(), before);
    return { unknown: true, confirmedByIsolatedReadback: true, noReplayWrites: true };
  });
  save("summary.json", {
    status: results.every((r) => r.status === "PASS") ? "PASS_ISOLATED_SYNTHETIC" : "FAIL_ISOLATED",
    tests: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
    skipped: 0,
    migrationCount,
    publicTables: tables.length,
    productionConnections: 0,
    imageDownloads: 0,
    paidCalls: 0,
  });
  assert.ok(
    results.every((r) => r.status === "PASS"),
    "ISOLATED_REGRESSION_FAILURES",
  );
}
