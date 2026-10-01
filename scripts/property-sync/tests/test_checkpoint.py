from pathlib import Path
import importlib.util
import json
import pytest


def module():
    path=Path(__file__).parents[1]/'scraping/checkpoint.py'
    assert path.exists(), 'durable checkpoint implementation missing'
    spec=importlib.util.spec_from_file_location('checkpoint',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_response_is_durable_before_process_interruption(tmp_path):
    m=module();checkpoint=m.Checkpoint(tmp_path/'run',source='28hse',scope='agent:540',run_id='one')
    checkpoint.response('https://www.28hse.com/agent/540',200,1,b'private page')
    progress=json.loads((tmp_path/'run/progress.json').read_bytes())
    assert progress['full'] is False and progress['responses']==1
    assert (tmp_path/'run/responses/000001.body').read_bytes()==b'private page'
    # No final successful gate exists if the process terminates here.
    assert not (tmp_path/'run/final.json').exists()
    with pytest.raises(FileExistsError):m.Checkpoint(tmp_path/'run',source='28hse',scope='agent:540',run_id='two')


def test_partial_finalization_cannot_become_absence_evidence(tmp_path):
    m=module();c=m.Checkpoint(tmp_path/'run',source='propertyhk',scope='branches:EPW,EPS,EPT',run_id='one')
    c.page({'scope':'EPS','page':1,'status':'blocked','details_complete':False})
    c.finish({'allowed':False,'full':False,'reasons':['blocked']})
    final=json.loads((tmp_path/'run/final.json').read_bytes());assert final['full'] is False and final['pages'][0]['status']=='blocked'


def test_atomic_response_failure_leaves_no_progress_claim(tmp_path,monkeypatch):
    m=module();c=m.Checkpoint(tmp_path/'run',source='28hse',scope='agent:540',run_id='one')
    def fail(*a,**k):raise OSError('disk unavailable')
    monkeypatch.setattr(m.os,'fsync',fail)
    with pytest.raises(OSError):c.response('https://www.28hse.com/agent/540',200,1,b'body')
    assert json.loads((tmp_path/'run/progress.json').read_bytes())['responses']==0


def test_real_worker_hard_exit_preserves_response_without_full_snapshot(tmp_path):
    import subprocess,sys
    root=Path(__file__).parents[1].resolve()
    code="""import os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from scraping.worker import run,synthetic_fixture
from scraping.checkpoint import Checkpoint
original=Checkpoint.response
def interrupt(self,*args):
 original(self,*args)
 os._exit(17)
Checkpoint.response=interrupt
cfg,fixtures=synthetic_fixture('28hse')
run('28hse',cfg,Path(sys.argv[2]),dry_run=True,fixtures=fixtures)
"""
    result=subprocess.run([sys.executable,'-c',code,str(root),str(tmp_path)],capture_output=True)
    assert result.returncode==17
    progress=list(tmp_path.glob('checkpoints/28hse/agent-540/*/progress.json'))
    assert len(progress)==1 and json.loads(progress[0].read_bytes())['responses']==1
    assert not list(tmp_path.rglob('final.json')) and not list(tmp_path.rglob('baseline.json'))
