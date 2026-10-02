import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
import sys
sys.path.insert(0,str(Path(__file__).parents[1]))

path=Path(__file__).parents[1]/"evidence_retention.py"

def module():
    spec=importlib.util.spec_from_file_location("evidence_retention",path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

NOW=datetime(2026,10,1,tzinfo=timezone.utc)
REPO={"id":77,"full_name":"fixture/private-evidence","private":True,"permissions":{"push":True}}
RELEASE={"id":88,"tag_name":"property-sync-evidence"}

def asset(i,name):
    return {"id":i,"name":name,"size":42,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","state":"uploaded","digest":"sha256:"+"a"*64}

def test_preview_protects_all_baselines_handoffs_unresolved_and_explicit_pins():
    m=module()
    names=["raw-1-1.tar.gz","compact-1-1.tar.gz","request-1-1.json","raw-2-1.tar.gz","accepted-20260924T214554421920Z-2-1.tar.gz","raw-3-1.tar.gz","unresolved-3-1.tar.gz","raw-4-1.tar.gz","handoff-4-1.json","raw-5-1.tar.gz","accepted-propertyhk-20260924T214554421920Z-5-1.tar.gz","raw-6-1.tar.gz","unknown.json"]
    assets=[asset(i+1,n) for i,n in enumerate(names)]
    p=m.build_preview(REPO,RELEASE,assets,NOW,pinned={"raw-6-1.tar.gz"})
    assert {x["name"] for x in p["candidates"]}==set(names[:3])
    assert p["policy"]["rawDays"]==7 and p["policy"]["compactDays"]==90
    assert m.verify_review(p,REPO,RELEASE,assets,[1],NOW+timedelta(minutes=1))[0]["name"]==names[0]

def test_review_rejects_changed_asset_public_destination_expiry_and_forged_ids():
    m=module();assets=[asset(1,"raw-1-1.tar.gz")];p=m.build_preview(REPO,RELEASE,assets,NOW)
    for repository in [{**REPO,"private":False},{**REPO,"permissions":{"push":False}},{**REPO,"id":123}]:
        with pytest.raises(ValueError):m.verify_review(p,repository,RELEASE,assets,[1],NOW)
    for selection in [[],[1,1],[999]]:
        with pytest.raises(ValueError):m.verify_review(p,REPO,RELEASE,assets,selection,NOW)
    for changed in [[{**assets[0],"size":43}],assets+[asset(2,"unresolved-1-1.tar.gz")]]:
        with pytest.raises(ValueError):m.verify_review(p,REPO,RELEASE,changed,[1],NOW)
    with pytest.raises(ValueError):m.verify_review(p,REPO,RELEASE,assets,[1],NOW+timedelta(hours=2))
    forged={**p,"candidates":[asset(999,"raw-9-1.tar.gz")]}
    with pytest.raises(ValueError):m.verify_review(forged,REPO,RELEASE,assets,[999],NOW)

def test_duplicate_asset_invalid_time_and_unversioned_accepted_fail_closed():
    m=module()
    for assets in [[asset(1,"raw-1-1.tar.gz"),asset(2,"raw-1-1.tar.gz")],[{**asset(1,"raw-1-1.tar.gz"),"created_at":"2026-01-01"}],[asset(1,"accepted-baseline.tar.gz")]]:
        with pytest.raises(ValueError):m.build_preview(REPO,RELEASE,assets,NOW)

def test_apply_persists_unknown_before_delete_stops_on_timeout_and_requires_explicit_gate(tmp_path):
    m=module();a=asset(1,"raw-1-1.tar.gz");states=[];calls=[]
    def persist(report):states.append([dict(x) for x in report["results"]])
    def delete(asset_id):calls.append(asset_id);raise TimeoutError("lost ack")
    with pytest.raises(ValueError):m.apply_selected([a],delete,persist,approved=False)
    assert calls==[]
    result=m.apply_selected([a,asset(2,"raw-2-1.tar.gz")],delete,persist,approved=True)
    assert calls==[1] and states[0][0]["status"]=="unknown"
    assert result["results"][0]["status"]=="unknown" and result["results"][1]["status"]=="not_attempted"


def test_operator_baseline_and_supporting_assets_are_retained_without_native_run_claim():
    m = module()
    run = 'fd5cb539-8d7f-4854-a801-0329d16e5f87'
    names = ['accepted-20261002T010000000000Z-operator-' + run + '.tar.gz', 'request-operator-' + run + '.json', 'raw-operator-' + run + '.tar.gz', 'handoff-operator-' + run + '.json']
    rows = [asset(i + 1, name) for i, name in enumerate(names)]
    preview = m.build_preview(REPO, RELEASE, rows, NOW)
    assert preview['candidates'] == []
    assert preview['protectedRuns'] == []
    assert preview['pinned'] == [names[0]]
    with pytest.raises(ValueError, match='evidence_selection_outside_preview'):
        m.verify_review(preview, REPO, RELEASE, rows, [1], NOW)
