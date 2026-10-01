"""Restricted daily evidence bundles. The database remains the authority for ingestion."""
import argparse
import hashlib
import re
import os
import tempfile
from datetime import timezone
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess
import tarfile


def validate_context(scope, ref, branch):
    if scope != 'agent:540' or not branch or ref != 'refs/heads/' + branch:
        raise ValueError('Daily collection requires agent:540 and the approved branch')


def validate_request(data):
    if data.get('source') != '28hse' or data.get('meta', {}).get('scope_id') != 'agent:540' or data.get('meta', {}).get('parser_version') != 'python-v2.2':
        raise ValueError('Incompatible source, scope or parser')


def make_baseline(request, receipt, destination):
    data = json.loads(request.read_bytes()); result = json.loads(receipt.read_bytes())
    validate_request(data)
    if not (result.get('success') is True and result.get('status') == 'success' and result.get('full_snapshot') is True and result.get('receipt_id')):
        raise ValueError('Only accepted full receipts can become a baseline')
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(request, destination / 'request.json')
    shutil.copyfile(receipt, destination / 'receipt.json')
    (destination / 'manifest.json').write_text(json.dumps({'sha256': hashlib.sha256(request.read_bytes()).hexdigest()}))


def restore_baseline(bundle, root):
    request = bundle / 'request.json'
    manifest = json.loads((bundle / 'manifest.json').read_bytes())
    if hashlib.sha256(request.read_bytes()).hexdigest() != manifest['sha256']:
        raise ValueError('Baseline bytes do not match manifest')
    # Revalidate the stored receipt; never select an arbitrary latest failed request.
    checked = root / 'checked-baseline'
    make_baseline(request, bundle / 'receipt.json', checked)
    target = root / 'baselines/28hse/agent-540/baseline.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(checked / 'request.json', target)


def archive(root, destination):
    destination.mkdir(parents=True, exist_ok=True)
    temporary = []
    try:
        for kind in ('raw', 'compact'):
            fd, name = tempfile.mkstemp(prefix='.pending-', dir=destination)
            os.close(fd)
            temporary.append((Path(name), destination / (kind + '.tar.gz')))
            with tarfile.open(name, 'w:gz') as bundle:
                if root.exists():
                    for path in sorted(root.rglob('*')):
                        if not path.is_file() or path.is_symlink(): continue
                        compact = path.name in {'request.json', 'receipt.json', 'manifest.json', 'baseline.json', 'summary.json', 'gate.json', 'publication.json', 'handoff.json'} or path.name.startswith('receipt-attempt') or (path.parent.name == 'attempts' and path.suffix == '.json' and path.stem.isdigit())
                        if kind == 'raw' or compact: bundle.add(path, arcname=str(path.relative_to(root)), recursive=False)
            with open(name, 'r+b') as content: os.fsync(content.fileno())
        for pending, final in temporary: os.replace(pending, final)
    finally:
        for pending, _ in temporary:
            if pending.exists(): pending.unlink()


def snapshot_stamp(data):
    value = data.get('scraped_at', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)', value):
        raise ValueError('Baseline requires an exact UTC snapshot timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00')).strftime('%Y%m%dT%H%M%S%fZ')


def accepted_parts(name):
    match = re.fullmatch(r'accepted-(\d{8}T\d{12}Z)-([0-9]+)-([0-9]+)\.tar\.gz', name)
    if not match:
        raise ValueError('Unversioned or invalid accepted asset requires operator reconciliation')
    datetime.strptime(match[1], '%Y%m%dT%H%M%S%fZ')
    return match[1], int(match[2]), int(match[3])


def accepted_name(request, run_id, attempt):
    data = json.loads(request.read_bytes())
    validate_request(data)
    name = f'accepted-{snapshot_stamp(data)}-{run_id}-{attempt}.tar.gz'
    accepted_parts(name)
    return name


def latest_accepted(names):
    candidates = [(*accepted_parts(name), name) for name in names if name.startswith('accepted-')]
    return max(candidates)[3] if candidates else ''

def unpack_baseline(path, destination):
    allowed = {'baseline/request.json': 5 * 1024 * 1024, 'baseline/receipt.json': 1024 * 1024, 'baseline/manifest.json': 4096}
    with tarfile.open(path, 'r:gz') as source:
        members = source.getmembers()
        files = [item for item in members if not (item.name == 'baseline' and item.isdir())]
        if len(files) != 3 or {item.name for item in files} != set(allowed):
            raise ValueError('Invalid baseline archive members')
        for item in files:
            if not item.isfile() or item.size > allowed[item.name]:
                raise ValueError('Invalid baseline archive type or size')
        expected_stamp, _, _ = accepted_parts(path.name)
        with source.extractfile('baseline/request.json') as content:
            if snapshot_stamp(json.loads(content.read())) != expected_stamp:
                raise ValueError('Accepted asset timestamp does not match its snapshot')
        for item in files:
            target = destination / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as out, source.extractfile(item) as content:
                shutil.copyfileobj(content, out)


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, sort_keys=True)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def file_evidence(path, ceiling):
    path = Path(path)
    if not path.is_file() or path.is_symlink(): raise ValueError('evidence_missing')
    size = path.stat().st_size
    if size < 1 or size > ceiling: raise ValueError('evidence_size_invalid')
    digest = hashlib.sha256()
    with path.open('rb') as content:
        for chunk in iter(lambda: content.read(1024 * 1024), b''): digest.update(chunk)
    return {'key': path.name, 'sha256': digest.hexdigest(), 'bytes': size}


def evidence_identity(data):
    meta = data.get('meta', {})
    source = data.get('source')
    expected = {'28hse': ('agent:540', 'python-v2.2'), 'propertyhk': ('branches:EPW,EPS,EPT', 'python-v2.0')}
    if source not in expected or (meta.get('scope_id'), meta.get('parser_version')) != expected[source] or meta.get('policy_version') != 'no-hermes-v2':
        raise ValueError('evidence_identity_invalid')
    if not isinstance(meta.get('run_id'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,159}', meta['run_id']): raise ValueError('evidence_run_invalid')
    snapshot_stamp(data)
    return source, meta


def freeze_manifest(request, raw, destination, *, git_sha, gate, branch_summaries=None):
    if Path(destination).exists(): raise ValueError('evidence_manifest_immutable')
    request_proof = file_evidence(request, 5 * 1024 * 1024)
    raw_proof = file_evidence(raw, 512 * 1024 * 1024)
    data = json.loads(Path(request).read_bytes())
    source, meta = evidence_identity(data)
    if not isinstance(gate, dict) or gate.get('allowed') is not True or gate.get('full') is not True: raise ValueError('collection_not_full')
    if not isinstance(git_sha, str) or not re.fullmatch(r'[0-9a-f]{40}', git_sha): raise ValueError('evidence_git_sha_invalid')
    manifest = {'version': 1, 'runId': meta['run_id'], 'source': source, 'scopeId': meta['scope_id'], 'collectedAt': data['scraped_at'], 'parserVersion': meta['parser_version'], 'policyVersion': meta['policy_version'], 'gitSha': git_sha, 'request': request_proof, 'raw': raw_proof, 'gate': {'allowed': True, 'full': True, 'reasons': gate.get('reasons', [])}, 'branchSummaries': branch_summaries or {}}
    atomic_json(destination, manifest)
    return manifest


def verify_manifest(path, root, *, source=None, scope=None):
    if Path(path).stat().st_size > 64 * 1024: raise ValueError('evidence_manifest_too_large')
    manifest = json.loads(Path(path).read_bytes())
    if manifest.get('version') != 1 or manifest.get('gate') != {'allowed': True, 'full': True, 'reasons': []}: raise ValueError('collection_not_full')
    root = Path(root).resolve()
    for field, ceiling in [('request', 5 * 1024 * 1024), ('raw', 512 * 1024 * 1024)]:
        proof = manifest.get(field, {})
        key = proof.get('key')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,199}', key) or key in ('.', '..'): raise ValueError('evidence_key_invalid')
        target = root / key
        if not target.resolve().is_relative_to(root): raise ValueError('evidence_key_invalid')
        observed = file_evidence(target, ceiling)
        if observed != proof: raise ValueError('evidence_hash_mismatch')
    data = json.loads((root / manifest['request']['key']).read_bytes())
    request_source, meta = evidence_identity(data)
    pairs = {'source': request_source, 'scopeId': meta['scope_id'], 'runId': meta['run_id'], 'collectedAt': data['scraped_at'], 'parserVersion': meta['parser_version'], 'policyVersion': meta['policy_version']}
    if any(manifest.get(key) != value for key, value in pairs.items()) or (source and request_source != source) or (scope and meta['scope_id'] != scope): raise ValueError('evidence_identity_invalid')
    if not re.fullmatch(r'[0-9a-f]{40}', manifest.get('gitSha', '')): raise ValueError('evidence_git_sha_invalid')
    if meta.get('crawl_complete') is not True or meta.get('pages_failed') != 0 or meta.get('worker_rejected_count') != 0 or meta.get('eligible_for_absence') is not True: raise ValueError('collection_not_full')
    if request_source == 'propertyhk' and set(meta.get('completed_branches', [])) != {'EPW','EPS','EPT'}: raise ValueError('collection_not_full')
    return manifest


def pin_manifest(path, root, *, upload, download):
    manifest = verify_manifest(path, root)
    with tempfile.TemporaryDirectory(prefix='.readback-', dir=root) as temporary:
        for field in ('request', 'raw'):
            proof = manifest[field]
            upload(Path(root) / proof['key'])
            fetched = Path(temporary) / proof['key']
            download(proof['key'], fetched)
            if file_evidence(fetched, 512 * 1024 * 1024) != proof: raise ValueError('evidence_upload_readback_mismatch')
        # Publish the ready marker only after both durable objects match exact bytes.
        upload(Path(path))
        fetched = Path(temporary) / Path(path).name
        download(Path(path).name, fetched)
        if fetched.read_bytes() != Path(path).read_bytes(): raise ValueError('evidence_upload_readback_mismatch')
    return manifest


def gh_call(args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, check=False)
    if result.returncode: raise ValueError('evidence_permission_or_transport_failed')
    return result.stdout


def pin_private_release(path, root):
    repository = os.environ.get('GH_REPO', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository): raise ValueError('evidence_repository_invalid')
    verify_private_destination(json.loads(gh_call(['api', 'repos/' + repository])))
    gh_call(['release', 'view', 'property-sync-evidence'])
    def upload(file): gh_call(['release', 'upload', 'property-sync-evidence', str(file)])
    def download(name, target):
        gh_call(['release', 'download', 'property-sync-evidence', '--pattern', name, '--dir', str(target.parent)])
    return pin_manifest(path, root, upload=upload, download=download)


def verify_private_destination(repository):
    if repository.get('private') is not True: raise ValueError('evidence_destination_public')
    if repository.get('permissions', {}).get('push') is not True: raise ValueError('evidence_permission_denied')


def verify_receipt_authority(data, receipt, authority, *, canonical_hash):
    source, meta = evidence_identity(data)
    expected_source = '28hse_agent_540' if source == '28hse' else 'propertyhk'
    expected = {'source': expected_source, 'scope_id': meta['scope_id'], 'policy_version': meta['policy_version'], 'parser_version': meta['parser_version'], 'payload_hash': canonical_hash, 'scraped_at': data['scraped_at'], 'receipt_id': receipt.get('receipt_id'), 'full_snapshot': True}
    if not re.fullmatch(r'[0-9a-f]{64}', canonical_hash or '') or not receipt.get('receipt_id') or receipt.get('success') is not True or receipt.get('status') != 'success' or receipt.get('full_snapshot') is not True or any(authority.get(k) != v for k,v in expected.items()):
        raise ValueError('baseline_authority_mismatch')


def retention_candidates(assets, now, *, pinned, unresolved_runs):
    candidates = []
    for asset in assets:
        name = asset['name']
        match = re.fullmatch(r'(raw|compact|request)-([0-9]+-[0-9]+)\.(?:tar\.gz|json)', name)
        if not match or name in pinned or match[2] in unresolved_runs: continue
        created = datetime.fromisoformat(asset['created_at'].replace('Z', '+00:00'))
        if created.tzinfo is None: raise ValueError('evidence_timestamp_invalid')
        days = 7 if match[1] == 'raw' else 90
        if (now - created).total_seconds() > days * 86400: candidates.append(name)
    return candidates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['validate', 'archive', 'baseline', 'restore', 'select', 'unpack', 'latest', 'name', 'freeze', 'verify', 'private', 'authority', 'pin'])
    parser.add_argument('--root', type=Path, default=Path('daily-output'))
    parser.add_argument('--destination', type=Path, default=Path('daily-archives'))
    parser.add_argument('--request', type=Path)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--run-id')
    parser.add_argument('--attempt')
    parser.add_argument('--scope', default='agent:540')
    parser.add_argument('--ref', default='')
    parser.add_argument('--branch', default='')
    parser.add_argument('--raw', type=Path)
    parser.add_argument('--gate', type=Path)
    parser.add_argument('--git-sha')
    parser.add_argument('--authority', type=Path)
    parser.add_argument('--canonical-hash')
    args = parser.parse_args()
    if args.command == 'freeze':
        freeze_manifest(args.request,args.raw,args.destination,git_sha=args.git_sha,gate=json.loads(args.gate.read_bytes()))
    elif args.command == 'verify': verify_manifest(args.request,args.root,scope=args.scope)
    elif args.command == 'pin': pin_private_release(args.request,args.root)
    elif args.command == 'private': verify_private_destination(json.loads(args.request.read_bytes()))
    elif args.command == 'authority': verify_receipt_authority(json.loads(args.request.read_bytes()),json.loads(args.receipt.read_bytes()),json.loads(args.authority.read_bytes()),canonical_hash=args.canonical_hash)
    elif args.command == 'validate':
        validate_context(args.scope, args.ref, args.branch)
        if args.request: validate_request(json.loads(args.request.read_bytes()))
    elif args.command == 'name': print(accepted_name(args.request, args.run_id, args.attempt))
    elif args.command == 'unpack': unpack_baseline(args.request, args.destination)
    elif args.command == 'latest': print(latest_accepted([a['name'] for a in json.loads(args.request.read_bytes())['assets']]))
    elif args.command == 'archive': archive(args.root, args.destination)
    elif args.command == 'baseline': make_baseline(args.request, args.receipt, args.destination)
    elif args.command == 'restore': restore_baseline(args.destination, args.root)
    else:
        paths = list(args.root.glob('snapshots/28hse/**/request.json'))
        if len(paths) != 1: raise ValueError('Expected exactly one newly collected request')
        print(paths[0].as_posix())


if __name__ == '__main__':
    main()

