import unittest, sys, tempfile, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from scraping import worker as w
except ImportError:
    w = None


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(w, "worker implementation required")

    def test_money(self):
        self.assertEqual(w.number("$5.38M", "money"), "5380000")
        self.assertEqual(w.number("538萬", "money"), "5380000")
        self.assertEqual(w.number("520呎", "area"), "520")
        self.assertIsNone(w.number("面議", "money"))

    def test_robots(self):
        p = w.Robots(
            "User-agent: *\nDisallow: /\nUser-agent: EarnestPropertyBot\nDisallow: /private*\nAllow: /private/open$\nCrawl-delay: 9"
        )
        self.assertTrue(p.allowed("https://www.28hse.com/private/open"))
        self.assertFalse(p.allowed("https://www.28hse.com/private/open/x"))
        self.assertEqual(p.delay, 9)

    def test_unknown_and_challenge_not_empty(self):
        for html in ["<h1>Just a moment...</h1>", "<p>unknown</p>"]:
            with self.assertRaises(w.WorkerError):
                w.parse_28_index(html, "sale")

    def test_shared_detail(self):
        root = Path(__file__).resolve().parents[3]
        html = (
            root / "src/lib/mls/__fixtures__/28hse/detail-sale-3972991.html"
        ).read_text(encoding="utf-8")
        r = w.parse_28_detail(
            html,
            {
                "property_id": "3972991",
                "source_url": "https://www.28hse.com/buy/apartment/property-3972991",
                "title": "晉誠地產 title",
                "deal_type": "sale",
            },
        )
        self.assertEqual(r["price"], "9800000")
        self.assertEqual(r["saleable_area"], "520")
        self.assertEqual(r["bedrooms"], 2)
        self.assertIsNone(r["unit"])

    def test_diff_columns(self):
        old = [
            {"property_id": "#123", "deal_type": "sale", "price": "100", "title": "A"}
        ]
        new = [
            {"title": "A", "price": "200", "deal_type": "sale", "property_id": "123"}
        ]
        d = w.diff(old, new)
        self.assertEqual(d[0]["change_type"], "changed")
        self.assertEqual(d[0]["changes"]["price"], {"old": "100", "new": "200"})
        self.assertEqual(w.diff(old, [])[0]["change_type"], "delisted")

    def test_gate(self):
        self.assertFalse(
            w.gate({"meta": {"crawl_complete": False}, "listings": [{}]}, None)[
                "allowed"
            ]
        )

    def test_missing_property_config(self):
        with self.assertRaises(w.WorkerError):
            w.validate_config("propertyhk", {})

    def test_lock_and_immutable(self):
        with tempfile.TemporaryDirectory() as t:
            with w.scope_lock(Path(t) / "lock"):
                with self.assertRaises(w.WorkerError):
                    with w.scope_lock(Path(t) / "lock"):
                        pass
            p = {
                "source": "28hse",
                "scraped_at": "2026-09-07T00:00:00Z",
                "meta": {"scope_id": "agent:540", "run_id": "test"},
                "listings": [],
            }
            path = w.save_snapshot(Path(t), p)
            self.assertEqual(json.loads((path / "request.json").read_bytes()), p)
            with self.assertRaises(FileExistsError):
                w.save_snapshot(Path(t), p)

    def test_sync_frozen_retry_and_auth_failure(self):
        calls = []
        sleeps = []

        def transport(url, data, token):
            calls.append(data)
            return (
                (503, {}, b"{}")
                if len(calls) < 3
                else (
                    200,
                    {},
                    b'{"success":true,"status":"success","full_snapshot":true}',
                )
            )

        result = w.submit(
            b'{"x":1}',
            "https://example.test/api",
            "secret",
            ["https://example.test"],
            transport,
            sleeps.append,
        )
        self.assertTrue(result["success"])
        self.assertEqual(calls, [b'{"x":1}'] * 3)
        calls.clear()

        def forbidden(url, data, token):
            calls.append(data)
            return 401, {}, b"{}"

        self.assertFalse(
            w.submit(
                b"{}",
                "https://example.test/api",
                "secret",
                ["https://example.test"],
                forbidden,
                sleeps.append,
            )["success"]
        )
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()


class FlowTests(unittest.TestCase):
    def test_synthetic_three_branches_and_loop(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        p, e = w.crawl("propertyhk", cfg, fixtures)
        self.assertTrue(p["meta"]["crawl_complete"])
        self.assertEqual(len(p["listings"]), 1)
        self.assertEqual(p["listings"][0]["branch_memberships"], ["EPW", "EPS", "EPT"])
        fixtures[cfg["branch_urls"]["EPW"].format(page=2)] = fixtures[
            cfg["branch_urls"]["EPW"].format(page=1)
        ]
        p, e = w.crawl("propertyhk", cfg, fixtures)
        self.assertFalse(p["meta"]["crawl_complete"])

    def test_offline_dryrun_no_submit_or_baseline(self):
        with tempfile.TemporaryDirectory() as t:
            result = w.run("28hse", {}, Path(t), True, synthetic=True)
            self.assertEqual(result["status"], "dry_run")
            self.assertFalse(list(Path(t).rglob("baseline.json")))
            self.assertTrue(Path(result["snapshot"], "request.json").exists())

    def test_drop_and_no_advance_partial(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        p, _ = w.crawl("28hse", cfg, fixtures)
        old = json.loads(json.dumps(p))
        old["listings"] = [
            {**p["listings"][0], "property_id": str(i)} for i in range(10)
        ]
        self.assertIn("count_drop_exceeds_30_percent", w.gate(p, old)["reasons"])
        self.assertFalse(
            w.receipt_is_full(
                {"success": True, "status": "partial_success", "full_snapshot": True}
            )
        )

    def test_detail_failure(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        fixtures["https://www.28hse.com/buy/apartment/property-100"]["status"] = 403
        p, e = w.crawl("28hse", cfg, fixtures)
        self.assertFalse(p["meta"]["crawl_complete"])

    def test_conflicting_global_duplicate(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        cfg["branch_urls"]["EPS"] = "https://www.property.hk/EPS?page={page}"
        fixtures["https://www.property.hk/EPS?page=1"]["html"] = fixtures[
            "https://www.property.hk/EPS?page=1"
        ]["html"].replace("Synthetic title", "Different title")
        p, e = w.crawl("propertyhk", cfg, fixtures)
        self.assertFalse(p["meta"]["crawl_complete"])


class SafetyTests(unittest.TestCase):
    def test_exact_attempt_bounds_and_redirect(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        f = w.Fetcher("https://www.28hse.com", [r"/agent/540"], fixtures)
        url = "https://www.28hse.com/agent/540"
        fixtures[url] = {"status": 503}
        with self.assertRaises(w.WorkerError):
            f.get(url)
        self.assertEqual(len([x for x in f.evidence if x["url"] == url]), 3)
        fixtures[url] = {"status": 302, "headers": {"Location": "https://evil.test/"}}
        with self.assertRaises(w.WorkerError):
            f.get(url)

    def test_429_bound(self):
        sleeps = []
        result = w.submit(
            b"{}",
            "https://example.test/api",
            "x",
            ["https://example.test"],
            lambda *a: (429, {"Retry-After": "600"}, b"{}"),
            sleeps.append,
        )
        self.assertEqual(result["status"], "retry_after_deferred")
        self.assertEqual(sleeps, [])

    def test_per_branch_count_drop(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        p, _ = w.crawl("propertyhk", cfg, fixtures)
        old = json.loads(json.dumps(p))
        old["listings"] = [
            {**p["listings"][0], "property_id": str(i), "branch_memberships": ["EPW"]}
            for i in range(10)
        ]
        p["listings"] = [
            {
                **p["listings"][0],
                "property_id": str(i),
                "branch_memberships": ["EPS", "EPT"],
            }
            for i in range(20)
        ]
        self.assertIn("branch_count_drop_EPW", w.gate(p, old)["reasons"])

    def test_company_nav_captcha_fixture_parity(self):
        root = Path(__file__).resolve().parents[3] / "src/lib/mls/__fixtures__/28hse"
        for filename in [
            "challenge.html",
            "challenge-cloudflare.html",
            "challenge-cloudflare-punctuated.html",
            "challenge-captcha-uppercase.html",
            "login.html",
            "malformed.html",
        ]:
            with self.subTest(filename=filename):
                with self.assertRaises(w.WorkerError):
                    w.parse_28_index(
                        (root / filename).read_text(encoding="utf8"), "sale"
                    )


class ContractParityTests(unittest.TestCase):
    def test_node_decodes_and_gates_worker_payloads(self):
        import subprocess

        repo = Path(__file__).resolve().parents[3]
        for source in ["28hse", "propertyhk"]:
            cfg, fixtures = w.synthetic_fixture(source)
            payload, _ = w.crawl(source, cfg, fixtures)
            js = "import fs from 'node:fs'; import {decodeSnapshot} from './src/lib/mls/ingestion-contract.mjs'; import {evaluateSnapshotGate} from './src/lib/mls/source-snapshot-gates.mjs'; const p=JSON.parse(fs.readFileSync(0,'utf8')); const b=decodeSnapshot(p,{idScope:'global',verifySourceUrl:()=>true}); console.log(JSON.stringify({gate:evaluateSnapshotGate(b,null),count:b.advertisementCount,rejects:b.rejects}));"
            result = subprocess.run(
                ["node", "--input-type=module", "-e", js],
                input=json.dumps(payload),
                text=True,
                encoding="utf-8",
                capture_output=True,
                cwd=repo,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report["gate"]["allowed"], report)
            self.assertEqual(report["rejects"], [])

    def test_node_detail_numeric_parity(self):
        import subprocess

        repo = Path(__file__).resolve().parents[3]
        js = "import fs from 'node:fs'; import {parse28HseDetail} from './src/lib/mls/parse-28hse.mjs'; const r=parse28HseDetail(fs.readFileSync('src/lib/mls/__fixtures__/28hse/detail-sale-3972991.html','utf8'),{dealType:'sale',sourceUrl:'https://www.28hse.com/buy/apartment/property-3972991',summaryTitle:'title',fetchedAt:'2026-09-07T00:00:00Z'}); console.log(JSON.stringify(r));"
        result = subprocess.run(
            ["node", "--input-type=module", "-e", js],
            text=True,
            encoding="utf-8",
            capture_output=True,
            cwd=repo,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        node = json.loads(result.stdout)
        html = (
            repo / "src/lib/mls/__fixtures__/28hse/detail-sale-3972991.html"
        ).read_text(encoding="utf8")
        py = w.parse_28_detail(
            html,
            {
                "property_id": "3972991",
                "source_url": "https://www.28hse.com/buy/apartment/property-3972991",
                "title": "title",
                "deal_type": "sale",
            },
        )
        for key in ["price", "saleable_area", "gross_area", "bedrooms"]:
            self.assertEqual(str(py[key]), str(node["fields"][key]))

    def test_renderer_rejects_unsupported_name(self):
        with self.assertRaises(w.WorkerError):
            w.render_captured_html("<h1>test</h1>", "unknown")


class RejectionTests(unittest.TestCase):
    def test_invalid_numeric_is_accounted_partial(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        fixtures["https://www.28hse.com/buy/apartment/property-100"]["html"] = fixtures[
            "https://www.28hse.com/buy/apartment/property-100"
        ]["html"].replace("$538萬", "not money")
        p, _ = w.crawl("28hse", cfg, fixtures)
        self.assertTrue(p["meta"]["crawl_complete"])
        self.assertEqual(
            p["meta"]["rejected_records"],
            [{"scope": "sale", "property_id": "100", "reason": "invalid_number"}],
        )
        self.assertFalse(p["meta"]["eligible_for_absence"])
        self.assertFalse(w.gate(p, None)["full"])

    def test_robots_octet_normalization(self):
        p = w.Robots("User-agent: *\nDisallow: /%61gent\nDisallow: /香港")
        self.assertFalse(p.allowed("https://www.28hse.com/agent/540"))
        self.assertFalse(p.allowed("https://www.28hse.com/%E9%A6%99%E6%B8%AF"))

    def test_branch_ids_distinct_counts(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        cfg["id_scope"] = "branch"
        p, _ = w.crawl("propertyhk", cfg, fixtures)
        self.assertEqual(w.gate(p, None)["valid_unique_count"], 3)


class RecoveryTests(unittest.TestCase):
    def test_replay_advances_only_full_and_never_regresses(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        p, _ = w.crawl("propertyhk", cfg, fixtures)
        with tempfile.TemporaryDirectory() as t:
            baseline = Path(t) / "baseline.json"
            self.assertFalse(
                w.advance_baseline(
                    baseline,
                    p,
                    {
                        "success": True,
                        "status": "shadow",
                        "full_snapshot": True,
                        "receipt_id": "r",
                    },
                )
            )
            self.assertTrue(
                w.advance_baseline(
                    baseline,
                    p,
                    {
                        "success": True,
                        "status": "success",
                        "full_snapshot": True,
                        "receipt_id": "r",
                    },
                )
            )
            older = json.loads(json.dumps(p))
            older["scraped_at"] = "2020-01-01T00:00:00Z"
            self.assertFalse(
                w.advance_baseline(
                    baseline,
                    older,
                    {
                        "success": True,
                        "status": "success",
                        "full_snapshot": True,
                        "receipt_id": "old",
                    },
                )
            )
