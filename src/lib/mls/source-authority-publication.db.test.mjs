import assert from "node:assert/strict";
import test from "node:test";
import { hashPayload } from "./ingestion-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "./source-authority-policy.mjs";
import { reconcileSourceAuthority } from "./source-authority-publication.mjs";
import { CURRENT_PUBLIC_OFFERING_ORDER } from "../neon/public-listing-query.js";
import {
  AUTHORITY_HOST,
  AUTHORITY_MIGRATION,
  AUTHORITY_NOW,
  authorityCapture,
  prepareAuthorityMedia,
  withAuthorityDatabase,
} from "../../../scripts/acceptance/source-authority-db-fixtures.mjs";

// No disposable URL escape hatch: even a configured Root.env or TEST_DATABASE_URL
// cannot change this suite's new, verified, loopback-only owned Docker target.
test("owned PostgreSQL source authority reconciles accepted native observations atomically", async (t) => {
  await withAuthorityDatabase(async (db) => {
    const { client, q, accept, seedProperty, adminWrite, options, snapshot } = db;
    const byRef = async (ref) =>
      q("SELECT * FROM properties WHERE canonical_property_no=$1 ORDER BY id", [ref]);
    const publicWinner = async (ref) =>
      (
        await q(
          `SELECT p.* FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type='sale' ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1`,
          [ref],
        )
      )[0];
    const jsonProperty = async (id) =>
      (await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1", [id]))[0].value;

    await t.test(
      "real additive migration makes authority nullable and retains real link/media FKs",
      async () => {
        assert.equal(
          (
            await q("SELECT count(*)::int AS n FROM app_migrations WHERE version=$1", [
              AUTHORITY_MIGRATION,
            ])
          )[0].n,
          1,
        );
        const column = (
          await q(
            "SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='properties' AND column_name='source_authority'",
          )
        )[0];
        assert.equal(column.is_nullable, "YES");
        assert.equal(column.column_default, null);
        const constraints = await q(
          "SELECT conrelid::regclass::text AS relation FROM pg_constraint WHERE contype='f' AND conrelid IN('property_source_links'::regclass,'listing_media_records'::regclass)",
        );
        assert.ok(
          constraints.filter((constraint) => constraint.relation === "listing_media_records")
            .length >= 3,
        );
        const target = await seedProperty("A910001");
        assert.equal(target.source_authority, null);
      },
    );

    await t.test(
      "disabled DB policy returns null without inspecting or writing supplied payload",
      async () => {
        await q(
          "UPDATE mls_ingestion_policies SET config=config-'source_authority' WHERE source=$1",
          [SOURCE_28HSE],
        );
        try {
          const before = await snapshot();
          assert.equal(await reconcileSourceAuthority(client, { invalid: true }), null);
          assert.deepEqual(await snapshot(), before);
        } finally {
          await q("UPDATE mls_ingestion_policies SET config=$2 WHERE source=$1", [
            SOURCE_28HSE,
            JSON.stringify(db.config),
          ]);
        }
      },
    );

    await t.test(
      "an approved rule cannot override disabled ownership, publishing or parser gates",
      async () => {
        const capture = authorityCapture([{ id: "9100014", ref: "A910014" }]);
        const receipt = await accept(capture);
        for (const [owner, enabled, parser] of [
          ["disabled", false, "python-v2.2"],
          ["no-hermes-v2", false, "python-v2.2"],
          ["no-hermes-v2", true, "unapproved-parser"],
        ]) {
          // Parser identity is protected by the real deferred receipt FK.
          // Stage the mismatch only long enough to test preflight rejection;
          // rolling back preserves every committed constraint and policy row.
          await q("BEGIN");
          try {
            await q(
              "UPDATE mls_ingestion_policies SET owner=$2,publish_enabled=$3,parser_version=$4 WHERE source=$1",
              [SOURCE_28HSE, owner, enabled, parser],
            );
            const before = await snapshot();
            await assert.rejects(
              () => reconcileSourceAuthority(client, capture.payload, options(capture, receipt)),
              parser !== "python-v2.2"
                ? /SOURCE_AUTHORITY_PARSER_CHANGED/
                : /SOURCE_AUTHORITY_PUBLISH_DISABLED/,
            );
            assert.deepEqual(await snapshot(), before);
          } finally {
            await q("ROLLBACK");
          }
        }
      },
    );

    await t.test("receipt hash mismatch is rejected before any reconciliation writes", async () => {
      const capture = authorityCapture([{ id: "9100002", ref: "A910002" }]);
      const receipt = await accept(capture);
      const invalid = structuredClone(capture.payload);
      invalid.meta.run_id = "changed-after-acceptance";
      const before = await snapshot();
      await assert.rejects(
        () => reconcileSourceAuthority(client, invalid, options(capture, receipt)),
        /SOURCE_AUTHORITY_ACCEPTED_RECEIPT_REQUIRED/,
      );
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("approved authority requires native fact proof before any writes", async () => {
      const capture = authorityCapture([{ id: "9100015", ref: "A910015" }]);
      const receipt = await accept(capture);
      const before = await snapshot();
      await assert.rejects(
        () =>
          reconcileSourceAuthority(
            client,
            capture.payload,
            options(capture, receipt, { verifyFacts: undefined }),
          ),
        /SOURCE_AUTHORITY_NATIVE_FACT_PROOF_REQUIRED/,
      );
      assert.deepEqual(await snapshot(), before);
    });

    await t.test(
      "mismatched native hash or parser proof cannot authorize any database writes",
      async () => {
        const capture = authorityCapture([{ id: "9100016", ref: "A910016" }]);
        const receipt = await accept(capture);
        for (const proof of [
          null,
          { payloadHash: "f".repeat(64), parserVersion: capture.payload.meta.parser_version },
          { payloadHash: hashPayload(capture.payload), parserVersion: "wrong-parser" },
        ]) {
          const before = await snapshot();
          await assert.rejects(
            () =>
              reconcileSourceAuthority(
                client,
                capture.payload,
                options(capture, receipt, { verifyFacts: async () => proof }),
              ),
            /SOURCE_AUTHORITY_NATIVE_FACT_PROOF_MISMATCH/,
          );
          assert.deepEqual(await snapshot(), before);
        }
      },
    );

    await t.test(
      "reused ad moves both native bindings to its verified company target without rewriting old A57",
      async () => {
        const old = authorityCapture([{ id: "9100003", ref: "A910057" }]);
        await accept(old);
        const oldProperty = (await byRef("A910057"))[0];
        const oldBefore = await jsonProperty(oldProperty.id);
        const target = await seedProperty("C910014", { status: "inactive", price: 32800000 });
        const capture = authorityCapture([
          { id: "9100003", ref: "C910014", values: { price: 31000000 } },
          { id: "9100004", ref: "C910014", values: { price: 30000000 } },
        ]);
        const receipt = await accept(capture);
        const scopeBefore = await q("SELECT * FROM mls_ingestion_scopes WHERE source=$1", [
          SOURCE_28HSE,
        ]);
        const report = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(report.published.length, 1);
        assert.equal(report.duplicateCanonical, 1);
        assert.equal(report.published[0].sourceId, "9100004");
        assert.equal(report.published[0].propertyId, target.id);
        assert.deepEqual(await jsonProperty(oldProperty.id), oldBefore);
        const bindings = await q(
          `SELECT s.external_listing_id,s.property_id,s.raw_identity,l.property_id AS linked_property,l.status,l.last_seen_run_id
        FROM mls_source_state s JOIN property_source_links l USING(source,external_listing_id,deal_type)
        WHERE s.source=$1 AND s.external_listing_id=ANY($2::text[]) ORDER BY s.external_listing_id`,
          [SOURCE_28HSE, ["9100003", "9100004"]],
        );
        assert.equal(bindings.length, 2);
        for (const binding of bindings) {
          assert.equal(binding.property_id, target.id);
          assert.equal(binding.linked_property, target.id);
          assert.equal(binding.raw_identity.agency_property_no, "C910014");
          assert.equal(binding.status, "active");
          assert.ok(binding.last_seen_run_id);
        }
        const after = await jsonProperty(target.id);
        assert.equal(Number(after.price), 30000000);
        assert.equal(after.status, "active");
        assert.equal(after.source_authority, "28hse");
        assert.equal(after.source_updated_at, null);
        assert.equal(
          Date.parse(after.last_seen_at),
          Date.parse(capture.payload.listings[1].captured_at),
        );
        assert.deepEqual(
          await q("SELECT * FROM mls_ingestion_scopes WHERE source=$1", [SOURCE_28HSE]),
          scopeBefore,
        );
        assert.equal(
          (
            await q("SELECT payload_hash FROM mls_ingestion_receipts WHERE id=$1", [
              receipt.receipt_id,
            ])
          )[0].payload_hash,
          hashPayload(capture.payload),
        );
        const audit = (
          await q(
            "SELECT metadata FROM audit_logs WHERE action=$1 AND subject_id=$2 ORDER BY created_at DESC LIMIT 1",
            [SOURCE_AUTHORITY_POLICY, target.id],
          )
        )[0].metadata;
        assert.equal(audit.receipt_id, receipt.receipt_id);
        assert.equal(
          audit.sources_before.find((source) => source.external_listing_id === "9100003")
            .property_id,
          oldProperty.id,
        );
        const replayBefore = await snapshot();
        const replay = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(replay.alreadyPublic, 1);
        assert.deepEqual(await snapshot(), replayBefore);
      },
    );

    await t.test(
      "manual property facts and JSON trigger overrides transfer while opposite deal and SEO remain",
      async () => {
        const target = await seedProperty("A910005", { price: 123, bedrooms: 1 });
        const opposite = await seedProperty("A910005", {
          deal_type: "rent",
          price: null,
          rent: 12000,
        });
        const capture = authorityCapture([{ id: "9100005", ref: "A910005", domConflict: true }]);
        const receipt = await accept(capture);
        await q(
          "INSERT INTO admin_property_overrides(property_no,shared,sale,rent) VALUES($1,$2,$3,$4)",
          [
            "A910005",
            JSON.stringify({
              bedrooms: 1,
              status: "inactive",
              seo_title: "Keep SEO",
              address: "Unobserved address",
            }),
            JSON.stringify({ price: 123 }),
            JSON.stringify({ bedrooms: 2 }),
          ],
        );
        await adminWrite(async (write) => {
          await write("UPDATE properties SET bedrooms=1,price=123,status='inactive' WHERE id=$1", [
            target.id,
          ]);
          for (const [field, value] of [
            ["bedrooms", 1],
            ["price", 123],
            ["status", "inactive"],
          ])
            await write(
              `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,override_value,active_override,selection_reason,policy_version)
            VALUES($1,$2,$3,$3,true,'manual_override','owned-manual') ON CONFLICT(property_id,field_name) DO UPDATE SET last_published_value=EXCLUDED.last_published_value,override_value=EXCLUDED.override_value,active_override=true,selection_reason='manual_override'`,
              [target.id, field, JSON.stringify(value)],
            );
        });
        const report = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(report.published[0].propertyId, target.id);
        const after = await jsonProperty(target.id);
        assert.equal(Number(after.price), 7300000);
        assert.equal(after.bedrooms, 4);
        assert.equal(after.status, "active");
        const override = (
          await q("SELECT * FROM admin_property_overrides WHERE property_no=$1", ["A910005"])
        )[0];
        assert.deepEqual(override.shared, { seo_title: "Keep SEO", address: "Unobserved address" });
        assert.deepEqual(override.sale, {});
        assert.deepEqual(override.rent, { bedrooms: 2, status: "inactive" });
        const fields = await q(
          "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name=ANY($2::text[])",
          [target.id, ["bedrooms", "price", "status"]],
        );
        assert.equal(fields.length, 3);
        assert.ok(
          fields.every(
            (field) =>
              field.active_override === false &&
              field.override_value === null &&
              field.policy_version === SOURCE_AUTHORITY_POLICY,
          ),
        );
        const transfer = (
          await q(
            "SELECT metadata FROM audit_logs WHERE action='mls.source_authority_override_transfer' AND subject_id=$1",
            [target.id],
          )
        )[0].metadata;
        assert.equal(transfer.overrides_before.shared.bedrooms, 1);
        assert.equal(transfer.input_sha256, hashPayload(capture.payload));
        await q("UPDATE properties SET title_zh=title_zh WHERE id=$1", [opposite.id]);
        const retained = await jsonProperty(opposite.id);
        assert.equal(retained.bedrooms, 2);
        assert.equal(retained.status, "inactive");
        assert.equal(retained.seo_title, "Keep SEO");
      },
    );

    await t.test(
      "review-required duplicate peers survive and explicit authority beats later legacy dates",
      async () => {
        const capture = authorityCapture([
          { id: "9100006", ref: "A910006", noGallery: true, domConflict: true },
        ]);
        const receipt = await accept(capture);
        const peer = await seedProperty("A910006", {
          source_updated_at: "2026-11-15T00:00:00Z",
          bedrooms: 3,
        });
        const target = await seedProperty("A910006", {
          source_updated_at: "2026-11-16T00:00:00Z",
          bedrooms: 4,
        });
        await q(
          "UPDATE property_public_groups SET review_required=true WHERE public_listing_no=$1",
          ["A910006"],
        );
        const membersBefore = await q(
          "SELECT * FROM property_public_members WHERE public_listing_no=$1 ORDER BY property_id",
          ["A910006"],
        );
        const peerBefore = await jsonProperty(peer.id);
        const mediaBefore = (await q("SELECT count(*)::int AS n FROM listing_media_records"))[0].n;
        const assetsBefore = (await q("SELECT count(*)::int AS n FROM media_assets"))[0].n;
        const report = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt, {
            prepare: async () => assert.fail("missing gallery must not prepare media"),
          }),
        );
        assert.equal(report.published[0].propertyId, target.id);
        assert.deepEqual(await jsonProperty(peer.id), peerBefore);
        assert.deepEqual(
          await q(
            "SELECT * FROM property_public_members WHERE public_listing_no=$1 ORDER BY property_id",
            ["A910006"],
          ),
          membersBefore,
        );
        const after = await jsonProperty(target.id);
        assert.deepEqual(after.images, target.images);
        assert.equal(after.source_updated_at, null);
        assert.equal(after.bedrooms, 4);
        assert.equal(report.published[0].retainedLegacyImages, target.images.length);
        assert.equal(
          (await q("SELECT count(*)::int AS n FROM listing_media_records"))[0].n,
          mediaBefore,
        );
        assert.equal((await q("SELECT count(*)::int AS n FROM media_assets"))[0].n, assetsBefore);
        assert.equal(
          (
            await q(
              "SELECT review_required FROM property_public_groups WHERE public_listing_no=$1",
              ["A910006"],
            )
          )[0].review_required,
          false,
        );
        await q(
          "UPDATE properties SET source_updated_at='2099-01-01',last_seen_at='2099-01-01',updated_at=clock_timestamp() WHERE id=$1",
          [peer.id],
        );
        assert.equal((await publicWinner("A910006")).id, target.id);
      },
    );

    await t.test(
      "a draft without gallery stays draft and creates no fake owned media",
      async () => {
        const capture = authorityCapture([{ id: "9100007", ref: "A910007", noGallery: true }]);
        const receipt = await accept(capture);
        const before = await snapshot();
        const report = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(report.published.length, 0);
        assert.equal(report.held[0].reason, "source_media_missing");
        assert.equal((await byRef("A910007"))[0].status, "draft");
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "new draft activates only after eligible owned media is persisted with real FKs",
      async () => {
        const capture = authorityCapture([{ id: "9100008", ref: "A910008", domConflict: true }]);
        const receipt = await accept(capture);
        const report = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(report.published.length, 1);
        const target = (await byRef("A910008"))[0];
        assert.equal(target.status, "active");
        assert.equal(target.source_authority, "28hse");
        assert.equal(target.images.length, 1);
        assert.equal(new URL(target.images[0]).hostname, AUTHORITY_HOST);
        const media = await q(
          `SELECT mr.*,a.content_hash AS asset_hash,a.url,o.fetched_at,o.payload
        FROM listing_media_records mr JOIN media_assets a ON a.id=mr.owned_media_asset_id
        JOIN listing_source_observations o ON o.id=mr.observation_id WHERE mr.property_id=$1`,
          [target.id],
        );
        assert.equal(media.length, 1);
        assert.equal(media[0].eligibility, "eligible");
        assert.equal(media[0].content_hash, media[0].asset_hash);
        assert.equal(
          Date.parse(media[0].fetched_at),
          Date.parse(capture.payload.listings[0].captured_at),
        );
        assert.deepEqual(
          media[0].payload.raw.raw_payload.source_conflicts,
          capture.payload.listings[0].raw_payload.source_conflicts,
        );
        const currentContact = (
          await q(
            `SELECT s.observation_id,c.observation_id AS contact_observation
        FROM mls_source_state s JOIN mls_source_contacts c USING(source,external_listing_id,deal_type)
        WHERE s.source=$1 AND s.external_listing_id=$2`,
            [SOURCE_28HSE, "9100008"],
          )
        )[0];
        assert.equal(currentContact.observation_id, currentContact.contact_observation);
      },
    );

    await t.test(
      "target change during buffered upload prevents authority and media database writes",
      async () => {
        const capture = authorityCapture([{ id: "9100009", ref: "A910009" }]);
        const receipt = await accept(capture);
        const target = (await byRef("A910009"))[0];
        const before = await snapshot();
        const reports = [];
        const prepare = async (args) => {
          const result = await prepareAuthorityMedia(args);
          await adminWrite((write) =>
            write("UPDATE properties SET title_zh='Concurrent staff edit' WHERE id=$1", [
              target.id,
            ]),
          );
          return result;
        };
        await assert.rejects(
          () =>
            reconcileSourceAuthority(
              client,
              capture.payload,
              options(capture, receipt, {
                prepare,
                onReport: async (report) => reports.push(structuredClone(report)),
              }),
            ),
          /SOURCE_AUTHORITY_TARGET_CHANGED_AFTER_UPLOAD/,
        );
        const after = await snapshot();
        for (const table of [
          "media_assets",
          "listing_media_records",
          "listing_source_observations",
          "mls_source_state",
          "property_source_links",
          "audit_logs",
          "listing_sync_runs",
        ])
          assert.deepEqual(after[table], before[table], table);
        assert.equal((await byRef("A910009"))[0].source_authority, null);
        assert.equal((await byRef("A910009"))[0].title_zh, "Concurrent staff edit");
        assert.equal(reports.at(-1).held[0].reason, "SOURCE_AUTHORITY_TARGET_CHANGED_AFTER_UPLOAD");
      },
    );

    await t.test(
      "database failure after override transfer rolls back assets, audits, flags and canonical writes",
      async () => {
        const target = await seedProperty("A910013", { price: 123 });
        const capture = authorityCapture([{ id: "9100013", ref: "A910013" }]);
        const receipt = await accept(capture);
        await q("INSERT INTO admin_property_overrides(property_no,sale) VALUES($1,$2)", [
          "A910013",
          JSON.stringify({ price: 123 }),
        ]);
        await q(
          `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,override_value,active_override,selection_reason,policy_version)
        VALUES($1,'price','123','123',true,'manual_override','owned-manual') ON CONFLICT(property_id,field_name) DO UPDATE SET active_override=true,override_value='123',selection_reason='manual_override'`,
          [target.id],
        );
        const before = await snapshot();
        let injected = false;
        const failing = {
          query: async (sql, params) => {
            if (!injected && sql.startsWith("UPDATE properties SET")) {
              injected = true;
              return client.query("SELECT 1/0");
            }
            return client.query(sql, params);
          },
        };
        await assert.rejects(
          () => reconcileSourceAuthority(failing, capture.payload, options(capture, receipt)),
          /division by zero/,
        );
        assert.equal(injected, true);
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "older accepted receipt cannot overwrite a newer advertisement for the same company",
      async () => {
        const older = authorityCapture([
          { id: "9100011", ref: "A910011", values: { price: 8000000 } },
        ]);
        const oldReceipt = await accept(older);
        await reconcileSourceAuthority(client, older.payload, options(older, oldReceipt));
        const newer = authorityCapture([
          { id: "9100012", ref: "A910011", values: { price: 7000000 } },
        ]);
        const newReceipt = await accept(newer);
        await reconcileSourceAuthority(client, newer.payload, options(newer, newReceipt));
        const before = await snapshot();
        let result;
        try {
          result = await reconcileSourceAuthority(
            client,
            older.payload,
            options(older, oldReceipt),
          );
        } catch (error) {
          assert.match(error.message, /SOURCE_AUTHORITY.*(?:STALE|CURRENT|CHANGED|RECEIPT|NEWER)/);
        }
        if (result) assert.equal(result.published.length, 0);
        assert.equal(Number((await publicWinner("A910011")).price), 7000000);
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "lost COMMIT response is unknown and exact replay reconciles the committed result",
      async () => {
        const capture = authorityCapture([{ id: "9100010", ref: "A910010" }]);
        const receipt = await accept(capture);
        let lost = false;
        const reports = [];
        const uncertain = {
          query: async (sql, params) => {
            const result = await client.query(sql, params);
            if (sql === "COMMIT" && !lost) {
              lost = true;
              throw Error("offline lost commit response");
            }
            return result;
          },
        };
        await assert.rejects(
          () =>
            reconcileSourceAuthority(
              uncertain,
              capture.payload,
              options(capture, receipt, {
                onReport: async (report) => reports.push(structuredClone(report)),
              }),
            ),
          /offline lost commit response/,
        );
        assert.equal(lost, true);
        assert.equal(reports.at(-1).unknown[0].reason, "commit_outcome_unknown");
        const target = (await byRef("A910010"))[0];
        assert.equal(target.source_authority, "28hse");
        const beforeReplay = await snapshot();
        const replay = await reconcileSourceAuthority(
          client,
          capture.payload,
          options(capture, receipt),
        );
        assert.equal(replay.alreadyPublic, 1);
        assert.deepEqual(await snapshot(), beforeReplay);
      },
    );

    await t.test(
      "later native ingestion keeps the latest same-reference title and published description",
      async () => {
        const capture = authorityCapture([
          { id: "9100017", ref: "A910017", values: { title: "Older advertisement" } },
          { id: "9100018", ref: "A910017", values: { title: "Current advertisement" } },
        ]);
        const receipt = await accept(capture);
        await reconcileSourceAuthority(client, capture.payload, options(capture, receipt));
        const published = await publicWinner("A910017");
        assert.equal(published.title_zh, "Current advertisement");
        const description = published.description;
        assert.ok(description);
        const later = authorityCapture([
          { id: "9100018", ref: "A910017", values: { title: "Newest native title" } },
        ]);
        await accept(later);
        const after = await publicWinner("A910017");
        assert.equal(after.id, published.id);
        assert.equal(after.title_zh, "Newest native title");
        assert.equal(after.description, description);
        assert.deepEqual(after.images, published.images);
        const ownership = (
          await q(
            "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='description'",
            [published.id],
          )
        )[0];
        assert.equal(ownership.policy_version, SOURCE_AUTHORITY_POLICY);
        assert.equal(ownership.selection_reason, "operator_publication");
        const audit = (
          await q(
            "SELECT metadata FROM audit_logs WHERE action='mls.source_authority_selection' AND subject_id=$1 ORDER BY created_at DESC LIMIT 1",
            [published.id],
          )
        )[0].metadata;
        const titleDecision = audit.resolutions.find((decision) => decision.field === "title");
        assert.equal(titleDecision.primaryAdvertisementId, "9100018");
        assert.equal(titleDecision.secondaryAdvertisementId, "9100017");
        assert.equal(titleDecision.resolution, "keep_latest_28hse");
        assert.equal(titleDecision.authority.approval_ref, db.config.source_authority.approval_ref);
        const conflict = (
          await q(
            "SELECT review_status,resolution FROM mls_ingestion_conflicts WHERE conflict_key=$1",
            [titleDecision.conflict_key],
          )
        )[0];
        assert.equal(conflict.review_status, "reviewed");
        assert.equal(conflict.resolution, "keep_28hse");
      },
    );

    await t.test(
      "native selection preserves PostgreSQL capture microseconds before advertisement ID ordering",
      async () => {
        const capture = authorityCapture([
          { id: "9100019", ref: "A910019", values: { title: "Latest microsecond" } },
          { id: "9100020", ref: "A910019", values: { title: "Earlier microsecond" } },
        ]);
        const base = capture.payload.listings[0].captured_at.slice(0, 19);
        for (const [index, listing] of capture.payload.listings.entries()) {
          const stamp = base + (index === 0 ? ".123002Z" : ".123001Z");
          listing.captured_at = stamp;
          listing.detail_fetched_at = stamp;
          listing.raw_payload.incremental.detail_fetched_at = stamp;
          capture.evidence.selected_candidates[index].detail_fetched_at = stamp;
        }
        await accept(capture);
        const target = (await byRef("A910019"))[0];
        assert.equal(target.title_zh, "Latest microsecond");
        const owned = (
          await q(
            "SELECT winning_observation_id FROM property_sync_fields WHERE property_id=$1 AND field_name='title_zh'",
            [target.id],
          )
        )[0];
        const observation = (
          await q(
            "SELECT external_listing_id,to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS captured_at FROM listing_source_observations WHERE id=$1",
            [owned.winning_observation_id],
          )
        )[0];
        assert.equal(observation.external_listing_id, "9100019");
        assert.equal(observation.captured_at, base + ".123002Z");
      },
    );

    assert.ok(AUTHORITY_NOW > Date.parse("2026-11-14T03:00:00Z"));
  });
});
