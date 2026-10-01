import importlib.util
import json
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('daily_artifacts', Path(__file__).parents[1] / 'daily_artifacts.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def payload():
    return {'source':'28hse','scraped_at':'2026-09-07T00:00:00Z','meta':{'scope_id':'agent:540','parser_version':'python-v2.2'},'listings':[]}

def test_scope_and_branch_fail_closed():
    m.validate_context('agent:540','refs/heads/main','main')
    for scope,ref,branch in [('agent:1','refs/heads/main','main'),('agent:540','refs/heads/dev','main'),('agent:540','refs/heads/main','')]:
        with pytest.raises(ValueError): m.validate_context(scope,ref,branch)

def test_baseline_requires_exact_successful_full_receipt(tmp_path):
    request=tmp_path/'request.json'; request.write_text(json.dumps(payload()))
    receipt=tmp_path/'receipt.json'; receipt.write_text(json.dumps({'success':True,'status':'dry_run','full_snapshot':True,'receipt_id':'r'}))
    with pytest.raises(ValueError): m.make_baseline(request,receipt,tmp_path/'bundle')
    receipt.write_text(json.dumps({'success':True,'status':'success','full_snapshot':True,'receipt_id':'r'}))
    m.make_baseline(request,receipt,tmp_path/'bundle')
    m.restore_baseline(tmp_path/'bundle',tmp_path/'out')
    assert (tmp_path/'out/baselines/28hse/agent-540/baseline.json').read_bytes()==request.read_bytes()
    (tmp_path/'bundle/request.json').write_text('{}')
    with pytest.raises(ValueError): m.restore_baseline(tmp_path/'bundle',tmp_path/'other')

def test_archive_preserves_failed_replay_evidence(tmp_path):
    root=tmp_path/'output'; root.mkdir(); (root/'request.json').write_text('{}'); (root/'receipt.json').write_text('{"success":false}')
    m.archive(root,tmp_path/'archives')
    assert (tmp_path/'archives/raw.tar.gz').exists()
    assert (tmp_path/'archives/compact.tar.gz').exists()


def test_unpack_rejects_traversal_and_unexpected_files(tmp_path):
    import io, tarfile
    for name in ['../request.json', '/etc/passwd', 'baseline/unexpected', 'baseline/../../escape']:
        path=tmp_path/'bad.tar.gz'
        with tarfile.open(path,'w:gz') as out:
            info=tarfile.TarInfo(name); info.size=2; out.addfile(info,io.BytesIO(b'{}'))
        with pytest.raises(ValueError): m.unpack_baseline(path,tmp_path/'unpacked')
    assert not (tmp_path/'escape').exists()

def test_latest_accepted_only_orders_attempts_numerically():
    assert m.latest_accepted(['unresolved-999-1.tar.gz','accepted-20260907T000000000000Z-9-12.tar.gz','accepted-20260907T000000000000Z-9-2.tar.gz','request-999-1.json']) == 'accepted-20260907T000000000000Z-9-12.tar.gz'

def test_archive_keeps_exact_failed_request_and_receipt(tmp_path):
    import tarfile
    root=tmp_path/'output'; nested=root/'replays/run'; nested.mkdir(parents=True)
    request=b'{ "immutable": true }\n'; receipt=b'{"success":false,"status":"outcome_unknown"}'
    (nested/'request.json').write_bytes(request); (nested/'receipt.json').write_bytes(receipt)
    m.archive(root,tmp_path/'archives')
    for filename in ['raw.tar.gz','compact.tar.gz']:
        with tarfile.open(tmp_path/'archives'/filename) as bundle:
            assert bundle.extractfile('replays/run/request.json').read()==request
            assert bundle.extractfile('replays/run/receipt.json').read()==receipt


def test_old_workflow_rerun_newer_snapshot_wins():
    assert m.latest_accepted(['accepted-20260907T000000000000Z-999-1.tar.gz', 'accepted-20260908T000000000000Z-9-2.tar.gz']) == 'accepted-20260908T000000000000Z-9-2.tar.gz'
    with pytest.raises(ValueError): m.latest_accepted(['accepted-999-1.tar.gz'])

def test_selected_asset_timestamp_bound_to_payload(tmp_path):
    import tarfile
    request=tmp_path/'request.json'; request.write_text(json.dumps(payload()))
    receipt=tmp_path/'receipt.json'; receipt.write_text(json.dumps({'success':True,'status':'success','full_snapshot':True,'receipt_id':'r'}))
    baseline=tmp_path/'baseline'; m.make_baseline(request,receipt,baseline)
    asset=tmp_path/m.accepted_name(request,'9','2')
    assert asset.name == 'accepted-20260907T000000000000Z-9-2.tar.gz'
    with tarfile.open(asset,'w:gz') as out: out.add(baseline,arcname='baseline')
    m.unpack_baseline(asset,tmp_path/'valid')
    bad=tmp_path/'accepted-20260908T000000000000Z-9-2.tar.gz'; bad.write_bytes(asset.read_bytes())
    with pytest.raises(ValueError): m.unpack_baseline(bad,tmp_path/'invalid')
    assert not (tmp_path/'invalid/baseline/request.json').exists()

def test_compact_archive_retains_transient_then_success_attempts(tmp_path):
    import tarfile
    root=tmp_path/'output'; replay=root/'replays/run'; attempts=replay/'attempts'; attempts.mkdir(parents=True)
    first=b'{"success":false,"http_status":503}'; second=b'{"success":true,"status":"success"}'
    (attempts/'1.json').write_bytes(first); (attempts/'2.json').write_bytes(second)
    (replay/'receipt.json').write_bytes(second)
    m.archive(root,tmp_path/'archives')
    with tarfile.open(tmp_path/'archives/compact.tar.gz') as bundle:
        assert bundle.extractfile('replays/run/attempts/1.json').read()==first
        assert bundle.extractfile('replays/run/attempts/2.json').read()==second
        assert bundle.extractfile('replays/run/receipt.json').read()==second


def test_company_number_parser_baseline_boundary():
    m.validate_request(payload())
    old = payload(); old['meta']['parser_version'] = 'python-v2.1'
    with pytest.raises(ValueError): m.validate_request(old)


def test_compact_archive_retains_publication_outcome(tmp_path):
    import tarfile
    root=tmp_path/'output'; root.mkdir()
    report=b'{"published":[],"held":[{"reason":"daily_publication_limit"}]}'
    (root/'publication.json').write_bytes(report)
    m.archive(root,tmp_path/'archives')
    with tarfile.open(tmp_path/'archives/compact.tar.gz') as bundle:
        assert bundle.extractfile('publication.json').read()==report


def evidence_files(tmp_path):
    import hashlib
    request=tmp_path/'request.json'; data=payload(); data['meta'].update({'policy_version':'no-hermes-v2','run_id':'fixture-run','crawl_complete':True,'pages_failed':0,'worker_rejected_count':0,'eligible_for_absence':True})
    request.write_text(json.dumps(data)); raw=tmp_path/'raw.tar.gz'; raw.write_bytes(b'private raw fixture')
    return request,raw


def test_frozen_manifest_rejects_missing_raw_bad_hash_scope_parser_and_partial(tmp_path):
    request,raw=evidence_files(tmp_path)
    manifest=m.freeze_manifest(request,raw,tmp_path/'handoff.json',git_sha='a'*40,gate={'allowed':True,'full':True,'reasons':[]})
    assert m.verify_manifest(tmp_path/'handoff.json',tmp_path)['runId']=='fixture-run'
    raw.write_bytes(b'corruption')
    with pytest.raises(ValueError,match='evidence_hash_mismatch'): m.verify_manifest(tmp_path/'handoff.json',tmp_path)
    raw.unlink()
    with pytest.raises(ValueError,match='evidence_missing'): m.verify_manifest(tmp_path/'handoff.json',tmp_path)
    for field,value in [('scope_id','agent:1'),('parser_version','python-v2.0')]:
        data=payload(); data['meta'][field]=value; request.write_text(json.dumps(data));raw.write_bytes(b'raw')
        with pytest.raises(ValueError):m.freeze_manifest(request,raw,tmp_path/'bad.json',git_sha='a'*40,gate={'allowed':True,'full':True})
    request,raw=evidence_files(tmp_path)
    with pytest.raises(ValueError,match='collection_not_full'):m.freeze_manifest(request,raw,tmp_path/'partial.json',git_sha='a'*40,gate={'allowed':False,'full':False})


def test_public_destination_and_permission_failure_have_safe_codes():
    with pytest.raises(ValueError,match='evidence_destination_public'): m.verify_private_destination({'private':False})
    with pytest.raises(ValueError,match='evidence_permission_denied'):m.verify_private_destination({'private':True,'permissions':{'push':False}})
    m.verify_private_destination({'private':True,'permissions':{'push':True}})


def test_baseline_requires_current_database_receipt_identity(tmp_path):
    import hashlib
    request,raw=evidence_files(tmp_path)
    m.freeze_manifest(request,raw,tmp_path/'handoff.json',git_sha='a'*40,gate={'allowed':True,'full':True,'reasons':[]})
    authority={'source':'28hse_agent_540','scope_id':'agent:540','policy_version':'no-hermes-v2','parser_version':'python-v2.2','payload_hash':'b'*64,'receipt_id':'r','full_snapshot':True,'scraped_at':payload()['scraped_at']}
    receipt={'success':True,'status':'success','full_snapshot':True,'receipt_id':'r'}
    m.verify_receipt_authority(json.loads(request.read_bytes()),receipt,authority,canonical_hash='b'*64)
    for field,value in [('receipt_id','forged'),('payload_hash','c'*64),('source','propertyhk'),('policy_version','other'),('parser_version','python-v2.0')]:
        wrong={**authority,field:value}
        with pytest.raises(ValueError,match='baseline_authority_mismatch'):m.verify_receipt_authority(json.loads(request.read_bytes()),receipt,wrong,canonical_hash='b'*64)


def test_release_retention_preserves_authoritative_baseline_and_unresolved_runs():
    from datetime import datetime, timezone
    now=datetime(2026,10,1,tzinfo=timezone.utc)
    assets=[{'name':n,'created_at':'2026-01-01T00:00:00Z'} for n in ['raw-1-1.tar.gz','compact-1-1.tar.gz','request-1-1.json','raw-2-1.tar.gz','request-2-1.json','accepted-20260924T214554421920Z-3-1.tar.gz','unresolved-2-1.tar.gz']]
    assert set(m.retention_candidates(assets,now,pinned={'accepted-20260924T214554421920Z-3-1.tar.gz'},unresolved_runs={'2-1'}))=={'raw-1-1.tar.gz','compact-1-1.tar.gz','request-1-1.json'}


def test_manifest_rejects_traversal_duplicate_binding_and_forged_gate(tmp_path):
    request,raw=evidence_files(tmp_path)
    m.freeze_manifest(request,raw,tmp_path/'handoff.json',git_sha='a'*40,gate={'allowed':True,'full':True,'reasons':[]})
    data=json.loads((tmp_path/'handoff.json').read_bytes());data['raw']['key']='../secret';(tmp_path/'handoff.json').write_text(json.dumps(data))
    with pytest.raises(ValueError,match='evidence_key_invalid'):m.verify_manifest(tmp_path/'handoff.json',tmp_path)


def test_interrupted_archive_does_not_expose_a_final_bundle(tmp_path,monkeypatch):
    import tarfile
    root=tmp_path/'run';root.mkdir();(root/'request.json').write_bytes(b'{}')
    def fail(*args,**kwargs):raise OSError('interrupted')
    monkeypatch.setattr(tarfile.TarFile,'add',fail)
    with pytest.raises(OSError):m.archive(root,tmp_path/'archives')
    assert not (tmp_path/'archives/raw.tar.gz').exists()
    assert not (tmp_path/'archives/compact.tar.gz').exists()


def test_pin_readback_verifies_bytes_before_manifest_ready(tmp_path):
    request,raw=evidence_files(tmp_path)
    m.freeze_manifest(request,raw,tmp_path/'handoff.json',git_sha='a'*40,gate={'allowed':True,'full':True,'reasons':[]})
    uploaded=[]
    def upload(path):uploaded.append(path.name)
    def download(name,dest):dest.write_bytes((tmp_path/name).read_bytes() if name!='raw.tar.gz' else b'corrupt')
    with pytest.raises(ValueError,match='evidence_upload_readback_mismatch'):
        m.pin_manifest(tmp_path/'handoff.json',tmp_path,upload=upload,download=download)
    assert 'handoff.json' not in uploaded
