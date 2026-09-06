"""Restricted daily evidence bundles. The database remains the authority for ingestion."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile


def validate_context(scope, ref, branch):
    if scope != 'agent:540' or not branch or ref != 'refs/heads/' + branch:
        raise ValueError('Daily collection requires agent:540 and the approved branch')


def validate_request(data):
    if data.get('source') != '28hse' or data.get('meta', {}).get('scope_id') != 'agent:540' or data.get('meta', {}).get('parser_version') != 'python-v2.1':
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
                    if path.name in {'request.json', 'receipt.json', 'manifest.json', 'baseline.json', 'summary.json', 'gate.json'} or path.name.startswith('receipt-attempt'):
                        compact.add(path, arcname=str(path.relative_to(root)), recursive=False)


def latest_accepted(names):
    import re
    candidates = [(int(m[1]), int(m[2]), name) for name in names if (m := re.fullmatch(r'accepted-([0-9]+)-([0-9]+)\.tar\.gz', name))]
    return max(candidates)[2] if candidates else ''


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
        for item in files:
            target = destination / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as out, source.extractfile(item) as content:
                shutil.copyfileobj(content, out)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['validate', 'archive', 'baseline', 'restore', 'select', 'unpack', 'latest'])
    parser.add_argument('--root', type=Path, default=Path('daily-output'))
    parser.add_argument('--destination', type=Path, default=Path('daily-archives'))
    parser.add_argument('--request', type=Path)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--scope', default='agent:540')
    parser.add_argument('--ref', default='')
    parser.add_argument('--branch', default='')
    args = parser.parse_args()
    if args.command == 'validate':
        validate_context(args.scope, args.ref, args.branch)
        if args.request: validate_request(json.loads(args.request.read_bytes()))
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


