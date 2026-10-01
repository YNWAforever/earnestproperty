"""Private release retention: preview first; approved exact deletions never auto-retry.

Conservative pins keep every accepted archive's supporting assets, all ready handoffs,
and unresolved runs.7/90 days are minimum ages, not an expiry promise for pinned data.
No cron deletion is enabled by this module.
"""
import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from daily_artifacts import accepted_parts, atomic_json, gh_call, retention_candidates, verify_private_destination

POLICY={"version":"private-retention-v1","rawDays":7,"compactDays":90,"requestDays":90,"pinAcceptedHistory":True,"pinReadyHandoffs":True}
FIELDS=("id","name","size","created_at","updated_at","state","digest")

def stamp(s):
    value=datetime.fromisoformat(s.replace("Z","+00:00"))
    if value.tzinfo is None:raise ValueError("evidence_timestamp_invalid")
    return value

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()

def inventory(assets):
    if not isinstance(assets,list) or len(assets)>10000:raise ValueError("evidence_inventory_invalid")
    rows=[];ids=set();names=set()
    for a in assets:
        if not isinstance(a.get("id"),int) or a["id"]<1 or a["id"] in ids or a.get("name") in names:raise ValueError("evidence_inventory_invalid")
        if not isinstance(a.get("name"),str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}",a["name"]):raise ValueError("evidence_inventory_invalid")
        if a.get("state")!="uploaded" or not isinstance(a.get("size"),int) or a["size"]<1:raise ValueError("evidence_inventory_not_ready")
        stamp(a["created_at"]);stamp(a["updated_at"])
        ids.add(a["id"]);names.add(a["name"]);rows.append({k:a.get(k) for k in FIELDS})
    return sorted(rows,key=lambda a:a["id"])

def build_preview(repository,release,assets,now,*,pinned=()):
    verify_private_destination(repository)
    if not isinstance(repository.get("id"),int) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",repository.get("full_name","")):raise ValueError("evidence_repository_invalid")
    if release.get("tag_name")!="property-sync-evidence" or not isinstance(release.get("id"),int):raise ValueError("evidence_release_invalid")
    rows=inventory(assets);pins=set(pinned);runs=set()
    if not pins.issubset({r["name"] for r in rows}):raise ValueError("evidence_pin_not_found")
    for r in rows:
        name=r["name"]
        if name.startswith("accepted-"):
            _,run,attempt=accepted_parts(name,"propertyhk" if name.startswith("accepted-propertyhk-") else "28hse")
            runs.add(f"{run}-{attempt}")
        marker=re.fullmatch(r"(?:unresolved-([0-9]+-[0-9]+)\.tar\.gz|handoff-([0-9]+-[0-9]+)\.json)",name)
        if marker:runs.add(marker[1] or marker[2])
    names=set(retention_candidates(rows,now,pinned=pins,unresolved_runs=runs))
    return {"version":1,"repositoryId":repository["id"],"repository":repository["full_name"],"releaseId":release["id"],"policy":POLICY,"createdAt":now.isoformat(),"expiresAt":(now+timedelta(hours=1)).isoformat(),"inventoryHash":digest(rows),"pinned":sorted(pins),"protectedRuns":sorted(runs),"candidates":[r for r in rows if r["name"] in names]}

def verify_review(preview,repository,release,assets,selected_ids,now):
    if not isinstance(selected_ids,list) or not 1<=len(selected_ids)<=100 or any(type(x) is not int for x in selected_ids) or len(set(selected_ids))!=len(selected_ids):raise ValueError("evidence_selection_invalid")
    created=stamp(preview["createdAt"])
    if created>now or now>=stamp(preview["expiresAt"]) or now-created>timedelta(hours=1):raise ValueError("evidence_preview_expired")
    actual=build_preview(repository,release,assets,created,pinned=preview.get("pinned",[]))
    if preview!=actual:raise ValueError("evidence_preview_changed")
    rows=[r for r in actual["candidates"] if r["id"] in selected_ids]
    if len(rows)!=len(selected_ids):raise ValueError("evidence_selection_outside_preview")
    return rows

def apply_selected(rows,delete,persist,*,approved):
    if approved is not True:raise ValueError("evidence_cleanup_not_approved")
    report={"version":1,"results":[{"id":r["id"],"name":r["name"],"status":"not_attempted"} for r in rows]}
    for r in report["results"]:
        r["status"]="unknown";persist(report)
        try:delete(r["id"])
        except Exception:
            persist(report);return report
        r["status"]="delete_accepted";persist(report)
    return report

def read_inventory(repository):
    repo=json.loads(gh_call(["api","repos/"+repository]));verify_private_destination(repo)
    release=json.loads(gh_call(["api",f"repos/{repository}/releases/tags/property-sync-evidence"]))
    assets=[]
    for page in range(1,102):
        batch=json.loads(gh_call(["api",f"repos/{repository}/releases/{release['id']}/assets?per_page=100&page={page}"]))
        if not isinstance(batch,list):raise ValueError("evidence_inventory_invalid")
        assets.extend(batch)
        if len(batch)<100:break
    else:raise ValueError("evidence_inventory_limit")
    return repo,release,assets

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out",type=Path,required=True);p.add_argument("--pin",action="append",default=[])
    p.add_argument("--apply-reviewed",type=Path);p.add_argument("--reconcile-report",type=Path);p.add_argument("--selected",type=int,nargs="+")
    args=p.parse_args();repository=os.environ.get("GH_REPO","")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",repository):raise ValueError("evidence_repository_invalid")
    if args.out.exists():raise ValueError("evidence_output_already_exists_reconcile_first")
    repo,release,assets=read_inventory(repository);now=datetime.now(timezone.utc)
    if args.apply_reviewed and args.reconcile_report:raise ValueError("evidence_ambiguous_mode")
    if args.reconcile_report:
        if args.selected or args.pin:raise ValueError("evidence_reconcile_read_only")
        report=json.loads(args.reconcile_report.read_bytes())
        if report.get("repositoryId")!=repo["id"] or report.get("releaseId")!=release["id"]:raise ValueError("evidence_report_target_mismatch")
        remaining={a["id"] for a in assets}
        for r in report["results"]:
            if r["status"] in ("delete_accepted","unknown") and r["id"] not in remaining:r["status"]="confirmed_absent"
        atomic_json(args.out,report)
    elif args.apply_reviewed:
        if args.pin:raise ValueError("evidence_use_reviewed_pins")
        if os.environ.get("PROPERTY_SYNC_EVIDENCE_RETENTION_APPROVED")!="true":raise ValueError("evidence_cleanup_not_approved")
        preview=json.loads(args.apply_reviewed.read_bytes())
        rows=verify_review(preview,repo,release,assets,args.selected,now)
        def delete(i):
            # Re-read pins and exact asset identity immediately before each delete.
            live_repo,live_release,live_assets=read_inventory(repository)
            fresh=build_preview(live_repo,live_release,live_assets,stamp(preview["createdAt"]),pinned=preview["pinned"])
            expected=next(r for r in rows if r["id"]==i)
            if live_repo["id"]!=repo["id"] or live_release["id"]!=release["id"] or expected not in fresh["candidates"]:raise ValueError("evidence_candidate_changed")
            gh_call(["api","--method","DELETE",f"repos/{repository}/releases/assets/{i}"])
        binding={"repositoryId":repo["id"],"releaseId":release["id"]}
        report=apply_selected(rows,delete,lambda r:atomic_json(args.out,{**r,**binding}),approved=True)
        report.update(binding)
        # DELETE acknowledgement alone is not a fresh inventory readback.
        remaining={a["id"] for a in read_inventory(repository)[2]}
        for r in report["results"]:
            if r["status"] in ("delete_accepted","unknown") and r["id"] not in remaining:r["status"]="confirmed_absent"
        atomic_json(args.out,report)
        if any(r["status"]!="confirmed_absent" for r in report["results"]):raise ValueError("evidence_cleanup_unknown_reconcile_report")
    else:
        if args.selected:raise ValueError("evidence_selection_requires_review")
        atomic_json(args.out,build_preview(repo,release,assets,now,pinned=args.pin))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print(str(e) if re.fullmatch(r"[a-z_]{1,100}",str(e)) else "evidence_cleanup_failed_closed")
        raise SystemExit(1)
