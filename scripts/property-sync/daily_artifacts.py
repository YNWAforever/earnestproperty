"""Restricted daily evidence bundles. The database remains the authority for ingestion."""
import argparse
import hashlib
import re
from datetime import datetime
import json
from pathlib import Path
import shutil
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
    with tarfile.open(destination / 'raw.tar.gz', 'w:gz') as raw, tarfile.open(destination / 'compact.tar.gz', 'w:gz') as compact:
        if root.exists():
            for path in sorted(root.rglob('*')):
                if path.is_file() and not path.is_symlink():
                    raw.add(path, arcname=str(path.relative_to(root)), recursive=False)
                    if path.name in {'request.json', 'receipt.json', 'manifest.json', 'baseline.json', 'summary.json', 'gate.json'} or path.name.startswith('receipt-attempt') or (path.parent.name == 'attempts' and path.suffix == '.json' and path.stem.isdigit()):
                        compact.add(path, arcname=str(path.relative_to(root)), recursive=False)


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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['validate', 'archive', 'baseline', 'restore', 'select', 'unpack', 'latest', 'name'])
    parser.add_argument('--root', type=Path, default=Path('daily-output'))
    parser.add_argument('--destination', type=Path, default=Path('daily-archives'))
    parser.add_argument('--request', type=Path)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--run-id')
    parser.add_argument('--attempt')
    parser.add_argument('--scope', default='agent:540')
    parser.add_argument('--ref', default='')
    parser.add_argument('--branch', default='')
    args = parser.parse_args()
    if args.command == 'validate':
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
