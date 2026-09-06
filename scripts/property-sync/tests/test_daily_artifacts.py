import importlib.util
import json
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('daily_artifacts', Path(__file__).parents[1] / 'daily_artifacts.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def payload():
    return {'source':'28hse','scraped_at':'2026-09-07T00:00:00Z','meta':{'scope_id':'agent:540','parser_version':'python-v2.1'},'listings':[]}

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
    assert m.latest_accepted(['unresolved-999-1.tar.gz','accepted-9-12.tar.gz','accepted-9-2.tar.gz','request-999-1.json']) == 'accepted-9-12.tar.gz'

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
