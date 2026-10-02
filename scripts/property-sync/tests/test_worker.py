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


class ReviewRegressionTests(unittest.TestCase):
    def test_zero_count_requires_normal_empty_marker(self):
        html = "<h1>晉誠地產</h1><p>C-018613</p><p>共有 0 個放租樓盤</p><section>Unknown changed listing template</section>"
        with self.assertRaises(w.WorkerError):
            w.parse_28_index(html, "rent")
        rows, terminal, total = w.parse_28_index(
            html + "<p>沒有找到任何資料</p>", "rent"
        )
        self.assertTrue(terminal)
        self.assertEqual(rows, [])

    def test_detail_unit_prices_preserve_raw_and_normalized(self):
        html = "<main data-listing-detail><table><tr><td>售價</td><td>500萬</td></tr><tr><td>建築呎價</td><td>10,000</td></tr><tr><td>實用呎價</td><td>12,000</td></tr></table></main>"
        record = w.parse_28_detail(
            html, {"property_id": "123", "title": "title", "deal_type": "sale"}
        )
        self.assertEqual(record.get("gross_unit_price"), "10000")
        self.assertEqual(record.get("saleable_unit_price"), "12000")
        self.assertEqual(
            record["raw_payload"]["detail_fields"]["gross_unit_price"], "10,000"
        )
        self.assertEqual(
            record["raw_payload"]["detail_fields"]["saleable_unit_price"], "12,000"
        )

    def test_baseline_policy_and_id_domain_must_match(self):
        cfg, fixtures = w.synthetic_fixture("propertyhk")
        current, _ = w.crawl("propertyhk", cfg, fixtures)
        for change in ["policy", "id_scope"]:
            previous = json.loads(json.dumps(current))
            if change == "policy":
                previous["meta"]["policy_version"] = "prior-policy"
            else:
                previous["id_scope"] = "branch"
            self.assertIn(
                "baseline_scope_mismatch", w.gate(current, previous)["reasons"]
            )

class AdvertisedDiagnosticTests(unittest.TestCase):
    def test_inaccurate_advertised_totals_are_only_diagnostics(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        for fixture in fixtures.values():
            fixture["html"] = fixture.get("html", "").replace("共有 1 個", "共有 999 個")
        payload, _ = w.crawl("28hse", cfg, fixtures)
        self.assertTrue(payload["meta"]["crawl_complete"])
        self.assertTrue(w.gate(payload, None)["allowed"])
        self.assertTrue(any(page.get("advertised_total") == 999 for page in payload["meta"]["pages"]))

    def test_changing_advertised_totals_do_not_replace_real_terminal_evidence(self):
        cfg, fixtures = w.synthetic_fixture("28hse")
        base = "https://www.28hse.com/agent/540?buyRent=buy&page={page}&plan_id=540&propertyDoSearchVersion=2.0"
        fixtures[base.format(page=3)] = fixtures[base.format(page=2)]
        fixtures[base.format(page=2)] = {"html": fixtures[base.format(page=1)]["html"].replace("共有 1 個", "共有 2 個").replace("property-100", "property-101")}
        fixtures["https://www.28hse.com/buy/apartment/property-101"] = fixtures["https://www.28hse.com/buy/apartment/property-100"]
        payload, _ = w.crawl("28hse", cfg, fixtures)
        self.assertTrue(payload["meta"]["crawl_complete"])
        self.assertTrue(w.gate(payload, None)["allowed"])
        self.assertEqual([page["advertised_total"] for page in payload["meta"]["pages"] if page["scope"] == "sale"], [1, 2, 1])

class Live28StructureTests(unittest.TestCase):
    def test_verified_full_company_and_absolute_same_origin_links(self):
        head='<h1>晉誠地產代理有限公司 Earnest Property Agency Ltd</h1><p>C-018613</p><p>共有 1 個放售樓盤</p>'
        rows, terminal, total=w.parse_28_index(head+'<a href="https://www.28hse.com/buy/apartment/property-4003829">Listing</a>', 'sale')
        self.assertEqual(rows[0]['property_id'],'4003829')
        self.assertFalse(terminal)
        with self.assertRaises(w.WorkerError):
            w.parse_28_index(head.replace('C-018613','C-000000')+'<a href="/buy/apartment/property-4003829">Listing</a>','sale')
        with self.assertRaises(w.WorkerError):
            w.parse_28_index(head+'<a href="https://evil.example/buy/apartment/property-4003829">Listing</a>','sale')
    def test_real_sale_and_rent_table_structures(self):
        for deal, ident, amount, area in [('sale','4003829','7200000','617'),('rent','3998335','24800','712')]:
            html=(Path(__file__).parent/'fixtures'/f'28hse-live-{deal}-structure.html').read_text(encoding='utf-8')
            r=w.parse_28_detail(html,{'property_id':ident,'deal_type':deal,'title':'Listing'})
            self.assertEqual(r['price' if deal=='sale' else 'rent'],amount)
            self.assertEqual(r['saleable_area'],area)
            self.assertIsNone(r['unit'])
            if deal=='rent':self.assertEqual(r['bedrooms'],4);self.assertEqual(r['bathrooms'],2)
            with self.assertRaises(w.WorkerError):
                w.parse_28_detail(html,{'property_id':'999','deal_type':deal})

    def test_live_duplicate_derived_fields_reject_conflicts(self):
        html=(Path(__file__).parent/'fixtures'/'28hse-live-rent-structure.html').read_text(encoding='utf-8')
        extra='<tr><td class="table_left">房間及浴室</td><td class="table_right"><div class="pairValue">9 房 8 浴室</div></td></tr>'
        html=html.replace('</tbody>',extra+'</tbody>')
        with self.assertRaisesRegex(w.WorkerError,'contradictory_detail'):
            w.parse_28_detail(html,{'property_id':'3998335','deal_type':'rent'})

class DailyLifecycleTests(unittest.TestCase):
    def detail(self, value, deal="sale"):
        marker, label = ("售盤", "售價") if deal == "sale" else ("租盤", "租金")
        html = f'<h1>Listing #123 {marker}</h1><table class="tablePair"><tr><td>{label}</td><td><div class="pairValue price">{value}</div></td></tr></table>'
        return w.parse_28_detail(html, {"property_id":"123", "deal_type":deal})

    def test_terminal_amount_badges_and_negotiable(self):
        for badge, deal, reason, amount in [("已售","sale","sold","售 $695 萬元"),("已租","rent","rented","租 $20,000 元")]:
            r=self.detail(amount+f'<div class="ui red large label">{badge}</div>',deal)
            self.assertEqual(r["source_status"], "delisted")
            self.assertEqual(r["source_status_reason"],reason)
            self.assertEqual(r["price" if deal=="sale" else "rent"],"6950000" if deal=="sale" else "20000")
        r=self.detail("價格面議")
        self.assertIsNone(r["price"])
        self.assertEqual(r["source_status"],"active")
        self.assertIsNone(r["source_status_reason"])

    def test_status_unknown_and_contradictory_fail_closed(self):
        for badges in ["已租", "已售 已租", "待確認", "已售 放售"]:
            with self.subTest(badges=badges), self.assertRaises(w.WorkerError):
                self.detail('售 $695 萬元<div class="label">'+badges+'</div>')

class FrozenReplayTests(unittest.TestCase):
    def replay(self, responses, apply=True):
        from unittest.mock import patch
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); cfg,fixtures=w.synthetic_fixture("28hse")
            payload,_=w.crawl("28hse",cfg,fixtures)
            path=root/"original.json"; original=json.dumps(payload, indent=2).encode();path.write_bytes(original)
            calls=[]; sleeps=[]
            def bridge(command, **kwargs):
                self.assertEqual(kwargs['timeout'], 900 if apply else 180)
                calls.append(Path(command[command.index("--payload")+1]).read_bytes())
                response=responses[min(len(calls)-1,len(responses)-1)]
                if isinstance(response,Exception): raise response
                return SimpleNamespace(stdout=json.dumps(response) if response.get("success") else "",stderr=json.dumps(response),returncode=0 if response.get("success") else 1)
            with patch.object(w.subprocess,"run",bridge), patch.object(w,"crawl",side_effect=AssertionError("must never crawl")):
                result=w.replay_28hse(path,root,apply=apply,sleep=sleeps.append)
            self.assertEqual(calls,[original]*len(calls))
            self.assertEqual(path.read_bytes(),original)
            self.assertTrue(Path(result["receipt_path"]).exists())
            self.assertEqual(len(list((Path(result["snapshot"])/"attempts").glob("*.json"))),len(calls))
            return result,calls,sleeps

    def test_replay_known_transient_exact_bytes_and_full_baseline(self):
        full={"success":True,"status":"success","full_snapshot":True,"receipt_id":"receipt"}
        result,calls,sleeps=self.replay([{"success":False,"error":"bridge_unavailable","status":503,"retryAfter":5},full])
        self.assertTrue(result["baseline_advanced"])
        self.assertEqual(len(calls),2); self.assertEqual(sleeps,[5])

    def test_replay_hard_errors_and_429_ceiling(self):
        for error in [{"success":False,"error":"invalid_record","status":400},{"success":False,"error":"quota_exceeded","status":429,"retryAfter":600}]:
            result,calls,sleeps=self.replay([error])
            self.assertFalse(result["success"]);self.assertFalse(result["baseline_advanced"])
            self.assertEqual(len(calls),1);self.assertEqual(sleeps,[])

    def test_replay_dryrun_and_network_bound(self):
        result,calls,sleeps=self.replay([{"success":True,"status":"dry_run"}],False)
        self.assertFalse(result["baseline_advanced"])
        result,calls,sleeps=self.replay([w.subprocess.TimeoutExpired("node",180)])
        self.assertFalse(result["baseline_advanced"]);self.assertEqual(len(calls),1)

class UnknownApplyOutcomeTests(unittest.TestCase):
    replay = FrozenReplayTests.replay

    def test_unknown_commit_stops_before_second_apply_and_preserves_identity(self):
        unknown={"success":False,"error":"OUTCOME_UNKNOWN","status":503,"retryAfter":5}
        full={"success":True,"status":"success","full_snapshot":True,"receipt_id":"receipt"}
        result,calls,sleeps=self.replay([unknown,full])
        self.assertFalse(result["success"])
        self.assertEqual(result["error"],"OUTCOME_UNKNOWN")
        self.assertFalse(result["baseline_advanced"])
        self.assertEqual(len(calls),1)
        self.assertEqual(sleeps,[])

    def test_apply_timeout_stops_without_recollection_or_baseline_advance(self):
        full={"success":True,"status":"success","full_snapshot":True,"receipt_id":"receipt"}
        result,calls,sleeps=self.replay([w.subprocess.TimeoutExpired("node",900),full])
        self.assertFalse(result["success"])
        self.assertEqual(result["error"],"OUTCOME_UNKNOWN")
        self.assertFalse(result["baseline_advanced"])
        self.assertEqual(len(calls),1)
        self.assertEqual(sleeps,[])

    def test_readonly_timeout_keeps_bounded_retry_without_writes(self):
        result,calls,sleeps=self.replay([w.subprocess.TimeoutExpired("node",180)],False)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"],"bridge_timeout")
        self.assertFalse(result["baseline_advanced"])
        self.assertEqual(len(calls),3)
        self.assertEqual(sleeps,[2,4])


class DailyGuardRegressionTests(unittest.TestCase):
    def test_explicit_unknown_status_row_rejects(self):
        html='<main data-listing-detail><table><tr><td>售價</td><td>500萬</td></tr><tr><td>狀態</td><td>待確認</td></tr></table></main>'
        with self.assertRaisesRegex(w.WorkerError,'unknown_source_status'):
            w.parse_28_detail(html,{'property_id':'123','deal_type':'sale'})

    def test_parser_change_cannot_advance_old_baseline(self):
        cfg,fixtures=w.synthetic_fixture('28hse');p,_=w.crawl('28hse',cfg,fixtures)
        self.assertEqual(p['meta']['parser_version'],'python-v2.2')
        previous=json.loads(json.dumps(p)); previous['meta']['parser_version']='python-v2.1';previous['scraped_at']='2020-01-01T00:00:00Z'
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'baseline.json'; path.write_bytes(w.frozen(previous));original=path.read_bytes()
            self.assertFalse(w.advance_baseline(path,p,{'success':True,'status':'success','full_snapshot':True,'receipt_id':'r'}))
            self.assertEqual(path.read_bytes(),original)

    def test_captured_terminal_and_negotiable_fragments(self):
        for ident,expected in [('3945770','6950000'),('3942846','4200000'),('3955884',None)]:
            html=(Path(__file__).parent/'fixtures'/f'28hse-lifecycle-{ident}.html').read_text(encoding='utf-8')
            record=w.parse_28_detail(html,{'property_id':ident,'deal_type':'sale'})
            self.assertEqual(record['price'],expected)
            self.assertEqual(record['source_status'],'delisted' if expected else 'active')

class ReplayRetryRegressionTests(unittest.TestCase):
    replay = FrozenReplayTests.replay
    def test_429_honors_delay_and_preserves_server_error(self):
        error={"success":False,"error":"quota_exceeded","status":429,"retryAfter":7}
        result,calls,sleeps=self.replay([error])
        self.assertEqual(len(calls),3);self.assertEqual(sleeps,[7,7])
        self.assertEqual(result["error"],"quota_exceeded")
        self.assertFalse(result["baseline_advanced"])

    def test_partial_receipt_never_advances_baseline(self):
        result,_,_=self.replay([{"success":True,"status":"partial_success","full_snapshot":False,"receipt_id":"partial"}])
        self.assertFalse(result["baseline_advanced"])


class CompanyNumberTests(unittest.TestCase):
    def extract(self, html):
        parser = getattr(w, "extract_28_company_number", None)
        self.assertIsNotNone(parser, "explicit company-number extraction is required")
        return parser(html)

    def test_verified_label_and_mixed_case_normalization(self):
        for label in ["物業編號: C020617 (代理提供)", "物業編號： c020617 （代理提供）"]:
            self.assertEqual(self.extract('<div class="sub header">'+label+'</div>'), "C020617")

    def test_explicit_table_label_is_supported(self):
        self.assertEqual(self.extract("<table><tr><td>物業編號</td><td>C003097 (代理提供)</td></tr></table>"), "C003097")

    def test_absent_label_never_guesses_ad_id_or_arbitrary_text(self):
        self.assertIsNone(self.extract('<h1>Listing #4003829</h1><p>C020617</p>'))

    def test_malformed_and_conflicting_labels_fail_closed(self):
        for label in ["物業編號: C020617", "物業編號: C02-0617 (代理提供)", "物業編號: C020617/C020618 (代理提供)", "物業編號: (代理提供)", "物業編號: C020617 (平台提供)"]:
            with self.subTest(label=label), self.assertRaisesRegex(w.WorkerError, "agency_property_no"):
                self.extract('<div class="sub header">'+label+'</div>')
        with self.assertRaisesRegex(w.WorkerError, "agency_property_no"):
            self.extract('<div>物業編號: C020617 (代理提供)</div><div>物業編號: C020618 (代理提供)</div>')

    def test_equal_duplicate_labels_are_consistent(self):
        self.assertEqual(self.extract('<div>物業編號: C020617 (代理提供)</div>'*2), "C020617")

    def test_captured_structure_wires_observation_without_changing_ad_identity(self):
        html=(Path(__file__).parent/'fixtures'/'28hse-company-number-structure.html').read_text(encoding='utf-8')
        for ident in ['4003829', '4003830']:
            record=w.parse_28_detail(html.replace('4003829',ident), {'property_id':ident,'deal_type':'sale'})
            self.assertEqual(record.get('agency_property_no'), 'C020617')
            self.assertEqual(record['property_id'], ident)
            self.assertNotIn('target_property_id', record)

    def test_propertyhk_parser_version_unchanged(self):
        cfg,fixtures=w.synthetic_fixture('propertyhk')
        payload,_=w.crawl('propertyhk',cfg,fixtures)
        self.assertEqual(payload['meta']['parser_version'], 'python-v2.0')



# 網頁07092026.docx p5: the client asked for 黃金 listings first, then 置頂, then
# ordinary ones. The grade is 28Hse's own paid placement badge, rendered as
# .grade_label inside the card's image anchor -- see promotion-tier.mjs, which
# normalizes the raw value these tests assert on.
GRADE_HEAD = (
    "<h1>晉誠地產</h1><p>C-018613</p><p>共有 3 個放租樓盤</p>"
)


def grade_card(ident, badge, title):
    """One agent-index card, shaped like the live markup: two anchors per
    listing, and only the image one carries the badge."""
    label = (
        f'<div class="ui top left attached small label grade_label">{badge}</div>'
        if badge
        else ""
    )
    return (
        '<div class="item property_item ">'
        '<div class="image myimage desktop_myimage">'
        f'<a class="detail_page" href="https://www.28hse.com/rent/apartment/property-{ident}">'
        f"<img src='/x.jpg'>{label}</a></div>"
        '<div class="content"><div class="header">'
        f'<a class="detail_page" href="https://www.28hse.com/rent/apartment/property-{ident}">{title}</a>'
        "</div></div></div>"
    )


def test_promotion_grade_is_read_per_listing_from_the_badge():
    import scraping.worker as w

    html = GRADE_HEAD + "".join(
        [
            grade_card("3998335", "黃金", "3房套+工人房！全新未住！"),
            grade_card("4005841", "置頂", "青龍頭海景洋房！環境清幽！"),
            # No badge, and 黃金地段 in the title -- the real trap case from the
            # live index. It must read as ordinary, never as a gold placement.
            grade_card("4005842", "", "兩層靚則獨立大屋！黃金地段！連2車位！"),
        ]
    )
    rows, terminal, total = w.parse_28_index(html, "rent")
    grades = {r["property_id"]: r["promotion_tier_raw"] for r in rows}
    assert grades == {"3998335": "黃金", "4005841": "置頂", "4005842": ""}
    assert terminal is False
    assert total == 3


def test_promotion_grade_survives_the_untagged_title_anchor():
    import scraping.worker as w

    # The title anchor wins the longest-title contest and carries no badge; the
    # grade must still come through from the image anchor on the same card.
    html = GRADE_HEAD.replace("共有 3", "共有 1") + grade_card(
        "3998335", "黃金", "a much longer title that wins the length contest"
    )
    rows, _, _ = w.parse_28_index(html, "rent")
    assert rows[0]["promotion_tier_raw"] == "黃金"
    assert rows[0]["title"] == "a much longer title that wins the length contest"


def test_an_unrecognised_badge_is_carried_through_not_guessed():
    import scraping.worker as w

    html = GRADE_HEAD.replace("共有 3", "共有 1") + grade_card("3998335", "鑽石", "標題")
    rows, _, _ = w.parse_28_index(html, "rent")
    # Passed through verbatim so the consumer records it as unknown rather than
    # inventing a tier for a grade nobody has verified.
    assert rows[0]["promotion_tier_raw"] == "鑽石"


def test_strongest_grade_merges_repeat_sightings_deterministically():
    import scraping.worker as w

    assert w.strongest_grade("", "黃金") == "黃金"
    assert w.strongest_grade("黃金", "") == "黃金"
    assert w.strongest_grade("置頂", "黃金") == "黃金"
    assert w.strongest_grade("黃金", "置頂") == "黃金"
    assert w.strongest_grade("", "置頂") == "置頂"
    assert w.strongest_grade("", "") == ""
    # Order of sighting must not change the answer.
    assert w.strongest_grade("鑽石", "黃金") == w.strongest_grade("黃金", "鑽石")
