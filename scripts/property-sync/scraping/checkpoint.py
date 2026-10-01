"""Private per-run durable evidence; never a source baseline or resume-from-yesterday."""
import json
import os
from pathlib import Path
import tempfile


def atomic_bytes(path, data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,pending=tempfile.mkstemp(prefix='.pending-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(pending,path)
    finally:
        if os.path.exists(pending):os.unlink(pending)


class Checkpoint:
    def __init__(self,path,*,source,scope,run_id):
        self.path=Path(path);self.path.mkdir(parents=True,exist_ok=False)
        self.data={'source':source,'scopeId':scope,'runId':run_id,'full':False,'responses':0,'pages':[]}
        self.write_progress()

    def write_progress(self):
        atomic_bytes(self.path/'progress.json',json.dumps(self.data,ensure_ascii=False).encode('utf-8'))

    def response(self,url,status,attempt,body):
        index=self.data['responses']+1
        directory=self.path/'responses'
        atomic_bytes(directory/f'{index:06d}.body',body)
        atomic_bytes(directory/f'{index:06d}.json',json.dumps({'url':url,'status':status,'attempt':attempt}).encode())
        self.data['responses']=index;self.write_progress()

    def page(self,page):
        self.data['pages'].append(dict(page));self.write_progress()

    def finish(self,gate):
        final={**self.data,'full':gate.get('allowed') is True and gate.get('full') is True,'gate':gate}
        atomic_bytes(self.path/'final.json',json.dumps(final,ensure_ascii=False).encode('utf-8'))
