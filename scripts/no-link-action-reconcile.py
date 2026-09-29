#!/usr/bin/env python3
"""Reconcile the immutable audit inventory with current, separately labelled evidence.

Usage: python scripts/no-link-action-reconcile.py AUDIT_03.csv OUTPUT.csv
No action is promoted to executed merely because a unit/source/DB test passed.
"""
import argparse
import csv
import re
from pathlib import Path

SUPPLEMENTAL = [
    ("N-T08-inbox-view", "/admin/whatsapp", "src/components/admin/whatsapp/NoLinkInbox.tsx", "agent inbox view", "T08 Node/Bun local only"),
    ("N-T08-inbox-search", "/admin/whatsapp", "src/routes/admin.whatsapp.tsx", "activity and full-history search", "T08 PGlite local only"),
    ("N-T09-enquiry-correct", "/admin/whatsapp", "src/components/admin/whatsapp/EnquiryResolutionPanel.tsx", "correct one enquiry", "T06/T09 PGlite CAS local only"),
    ("N-T09-folder-retry", "/admin/whatsapp", "src/components/admin/whatsapp/FolderLoadNotice.tsx", "retry Folder load", "T09 Bun local only"),
    ("N-T09-staff-test", "/admin/whatsapp-settings", "src/components/admin/whatsapp/StaffTestNotificationDialog.tsx", "staff test notification", "T09 UI local only"),
    ("N-T10-forward-capture", "/admin/leads", "src/components/admin/whatsapp/ForwardedEnquiryForm.tsx", "capture manual forward", "T10 PGlite/Bun local only"),
    ("N-T10-contact-edit", "/admin/leads", "src/components/admin/whatsapp/LeadContactEditor.tsx", "edit contact name or email", "T10 PGlite local only"),
    ("N-T11-analytics-export", "/admin/analytics", "src/routes/admin.analytics.tsx", "export scoped evidence", "T11 Node/PGlite local only"),
    ("N-T12-audience-preview-retry", "/admin/blasts", "src/routes/admin.blasts.tsx", "retry failed audience preview", "T12 helper/source contract local only"),
    ("N-T12-manual-template-review", "/admin/blasts", "src/routes/admin.blasts.tsx", "confirm external template review", "T12 unit/source local only"),
    ("N-T13-auth-language", "/auth/sign-in", "src/routes/auth.$pathname.tsx", "switch auth language", "T13 local contract only"),
    ("N-T13-header-whatsapp-desktop", "/", "src/components/site/SiteHeader.tsx", "desktop WhatsApp link", "T13 semantic contract only"),
    ("N-T13-header-whatsapp-mobile", "/", "src/components/site/SiteHeader.tsx", "mobile WhatsApp link", "T13 semantic contract only"),
]
COLUMNS = [
    "action_id", "record_kind", "route", "source", "control", "locator",
    "baseline_handler", "baseline_destination", "baseline_actor", "baseline_conditions",
    "baseline_effect", "related_uc", "finding", "baseline_test_ids",
    "classification", "representative_action_id", "candidate_equivalent",
    "source_exists", "baseline_status", "baseline_evidence",
    "current_execution_status", "current_environment", "related_local_evidence",
    "current_actor_state", "current_command", "expected", "actual",
    "side_effect_readback", "blocker",
]
WRAPPERS = {
    "Dialog", "AlertDialog", "Sheet", "Popover", "Tabs", "Tabs.Root",
    "TabsContent", "DialogPrimitive.Root", "DialogPrimitive.Content",
    "CampaignDialog", "AudienceDialog", "EstateDialog", "ArticleDialog",
    "CmsVideoDialog", "FaqDialog", "FaqImportDialog", "MediaDialog",
}
def source_file(value):
    return re.sub(r":\d+$", "", value or "").replace("\\", "/")
def signature(row):
    return (
        source_file(row["source"]), row["control"], row["locator"],
        " ".join(row["handler"].split()), row["destination"],
    )
def reconcile(rows, repo):
    source_rows = [row for row in rows if row["record_kind"] == "SOURCE_CONTROL_OCCURRENCE"]
    assert len(source_rows) == 1261, "unexpected audit denominator"
    assert len({row["action_id"] for row in rows}) == len(rows), "unstable action IDs"
    reps = {}
    output = []
    for row in rows:
        kind = row["record_kind"]
        key = signature(row)
        rep = reps.setdefault(key, row["action_id"]) if kind == "SOURCE_CONTROL_OCCURRENCE" else row["action_id"]
        repeated = rep != row["action_id"]
        shared = row["route"].startswith("shared component")
        wrapper = row["control"] in WRAPPERS
        if kind != "SOURCE_CONTROL_OCCURRENCE":
            classification = kind.lower()
        elif wrapper:
            classification = "container_wrapper_candidate"
        elif shared:
            classification = "shared_caller_pending"
        elif repeated:
            classification = "equivalent_repeated_row_candidate"
        else:
            classification = "unique_rendered_control_candidate"
        staff = "/admin" in row["route"] or "staff" in row["actor"].lower()
        blocker = (
            "isolated role sessions, DB and synthetic browser; provider readback where applicable"
            if staff else "rendered browser action and content/readback not executed on current SHA"
        )
        if shared:
            blocker = "resolve rendered caller and actor/state; " + blocker
        if kind != "SOURCE_CONTROL_OCCURRENCE":
            blocker = "workflow-level local or provider/DB acceptance remains separately gated"
        output.append({
            "action_id": row["action_id"], "record_kind": kind, "route": row["route"],
            "source": row["source"], "control": row["control"], "locator": row["locator"],
            "baseline_handler": row["handler"], "baseline_destination": row["destination"],
            "baseline_actor": row["actor"], "baseline_conditions": row["conditions"],
            "baseline_effect": row["effect"], "related_uc": row["related_uc"],
            "finding": row["finding"], "baseline_test_ids": row["test_ids"],
            "classification": classification, "representative_action_id": rep,
            "candidate_equivalent": "yes" if repeated else "no",
            "source_exists": "yes" if (repo / source_file(row["source"])).is_file() else ("not_applicable" if kind != "SOURCE_CONTROL_OCCURRENCE" else "no"),
            "baseline_status": row["status"], "baseline_evidence": row["evidence"],
            "current_execution_status": "BLOCKED_EXTERNAL" if staff else "NOT_TESTED",
            "current_environment": "no current rendered action execution",
            "related_local_evidence": "",
            "current_actor_state": "not exercised in rendered session", "current_command": "",
            "expected": row["expected"], "actual": "not executed on current branch",
            "side_effect_readback": "not observed", "blocker": blocker,
        })
    for action_id, route, source, locator, evidence in SUPPLEMENTAL:
        output.append({
            "action_id": action_id, "record_kind": "NEW_RENDERED_ACTION_CANDIDATE",
            "route": route, "source": source, "control": "dynamic", "locator": locator,
            "baseline_handler": "", "baseline_destination": "", "baseline_actor": "",
            "baseline_conditions": "", "baseline_effect": "", "related_uc": "",
            "finding": "", "baseline_test_ids": "",
            "classification": "new_dynamic_action_pending_browser", "representative_action_id": action_id,
            "candidate_equivalent": "no", "source_exists": "yes" if (repo / source).is_file() else "no",
            "baseline_status": "NOT_IN_BASELINE", "baseline_evidence": "",
            "current_execution_status": "BLOCKED_EXTERNAL" if route.startswith("/admin") else "NOT_TESTED",
            "current_environment": "unit/PGlite/source only", "related_local_evidence": evidence,
            "current_actor_state": "synthetic role session pending", "current_command": "",
            "expected": "authorized action with state-specific readback",
            "actual": "local layers only; no rendered full action",
            "side_effect_readback": "not observed end to end",
            "blocker": "synthetic browser and role/data fixtures; provider where relevant",
        })
    return output

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inventory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.inventory.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    output = reconcile(rows, Path.cwd())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(output)
    print(f"baseline={len(rows)} source={sum(r['record_kind']=='SOURCE_CONTROL_OCCURRENCE' for r in rows)} supplemental={len(SUPPLEMENTAL)} output={len(output)}")

if __name__ == "__main__":
    main()
