import { canonicalJson, POLICY_VERSION } from "./ingestion-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "./source-authority-policy.mjs";

const PROPERTY_FIELDS = new Set([
  "title_zh",
  "description",
  "estate_id",
  "district_slug",
  "address",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "price",
  "rent",
  "status",
  "images",
  "video_url",
  "floorplan_url",
  "features",
]);
const SCOPES = ["shared", "sale", "rent"];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function observedFields(dealType, fields) {
  if (!["sale", "rent"].includes(dealType)) throw Error("AUTHORITY_OVERRIDE_DEAL_INVALID");
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string"))
    throw Error("AUTHORITY_OVERRIDE_FIELDS_INVALID");
  return [...new Set(fields)]
    .filter(
      (field) =>
        PROPERTY_FIELDS.has(field) &&
        !(field === "price" && dealType !== "sale") &&
        !(field === "rent" && dealType !== "rent"),
    )
    .sort();
}

// A shared override's value is also effective on the other deal. Preserve that
// value there before giving only the current deal back to the source.
export function planAuthorityOverrides(overrideRow, dealType, fields) {
  const observed = observedFields(dealType, fields);
  if (overrideRow != null && !plain(overrideRow)) throw Error("AUTHORITY_OVERRIDES_INVALID");
  const next = {};
  for (const scope of SCOPES) {
    const patch = overrideRow?.[scope] ?? {};
    if (!plain(patch)) throw Error("AUTHORITY_OVERRIDES_INVALID");
    next[scope] = structuredClone(patch);
  }
  const other = dealType === "sale" ? "rent" : "sale";
  const changedFields = [];
  for (const field of observed) {
    let changed = false;
    if (Object.hasOwn(next.shared, field)) {
      // Amount overrides have deal-specific meaning, even if an invalid old
      // shared patch contains them. Never transfer a price into a rent patch.
      if (field !== "price" && field !== "rent" && !Object.hasOwn(next[other], field))
        next[other][field] = next.shared[field];
      delete next.shared[field];
      changed = true;
    }
    if (Object.hasOwn(next[dealType], field)) {
      delete next[dealType][field];
      changed = true;
    }
    if (changed) changedFields.push(field);
  }
  return {
    changed: changedFields.length > 0,
    fields: observed,
    changedFields,
    ...next,
  };
}

function validateAuthority(input) {
  const { approval, propertyNo, propertyId, runId, inputSha256 } = input;
  if (
    !plain(approval) ||
    approval.version !== SOURCE_AUTHORITY_POLICY ||
    approval.approved !== true ||
    typeof approval.approval_ref !== "string" ||
    !REF.test(approval.approval_ref) ||
    approval.source !== SOURCE_28HSE ||
    approval.scope_id !== "agent:540" ||
    approval.policy_version !== POLICY_VERSION
  )
    throw Error("AUTHORITY_OVERRIDE_APPROVAL_REQUIRED");
  if (
    typeof propertyNo !== "string" ||
    !/^[A-Z][0-9]{6}$/.test(propertyNo) ||
    typeof propertyId !== "string" ||
    !UUID.test(propertyId) ||
    typeof runId !== "string" ||
    !UUID.test(runId) ||
    typeof inputSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(inputSha256)
  )
    throw Error("AUTHORITY_OVERRIDE_IDENTITY_INVALID");
}

// q returns rows, using the caller's locked transaction. The caller must reread
// the trusted DB policy, serialize admin writes/absent-row races, and then write
// the actual property values and their new field ownership in this transaction.
export async function applyAuthorityOverrides(q, input) {
  validateAuthority(input);
  const { propertyNo, propertyId, dealType, fields, approval, inputSha256, runId } = input;
  const observed = observedFields(dealType, fields);
  if (typeof q !== "function") throw Error("AUTHORITY_OVERRIDE_QUERY_REQUIRED");
  if (!observed.length) return { changed: false, overrideFields: [], syncFields: [] };

  const overrides = await q(
    "SELECT * FROM admin_property_overrides WHERE property_no=$1 FOR UPDATE",
    [propertyNo],
  );
  if (overrides.length > 1) throw Error("AUTHORITY_OVERRIDE_TARGET_CHANGED");
  const before = overrides[0] ?? null;
  const plan = planAuthorityOverrides(before, dealType, observed);
  const syncFields = await q(
    "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name=ANY($2::text[]) ORDER BY field_name FOR UPDATE",
    [propertyId, observed],
  );
  const cleared = syncFields
    .filter((field) => field.active_override || field.override_value != null)
    .map((field) => field.field_name);
  if (!plan.changed && !cleared.length)
    return { changed: false, overrideFields: [], syncFields: [] };

  // Keep the complete previous override row and observed sync-field state. The
  // audit must succeed before either kind of protection is changed.
  await q(
    "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('mls.source_authority_override_transfer','property',$1,$2::jsonb)",
    [
      propertyId,
      JSON.stringify({
        policy: SOURCE_AUTHORITY_POLICY,
        approval_ref: approval.approval_ref,
        input_sha256: inputSha256,
        run_id: runId,
        property_no: propertyNo,
        deal_type: dealType,
        observed_fields: observed,
        changed_override_fields: plan.changedFields,
        cleared_sync_fields: cleared,
        overrides_before: before,
        overrides_after: { shared: plan.shared, sale: plan.sale, rent: plan.rent },
        sync_fields_before: syncFields,
      }),
    ],
  );

  if (plan.changed) {
    const changedScopes = SCOPES.filter(
      (scope) => canonicalJson(before[scope]) !== canonicalJson(plan[scope]),
    );
    const params = [propertyNo, ...changedScopes.map((scope) => JSON.stringify(plan[scope]))];
    const updated = await q(
      `UPDATE admin_property_overrides SET ${changedScopes
        .map((scope, index) => `${scope}=$${index + 2}::jsonb`)
        .join(
          ",",
        )},revision=revision+1,updated_at=clock_timestamp() WHERE property_no=$1 RETURNING property_no`,
      params,
    );
    if (updated.length !== 1) throw Error("AUTHORITY_OVERRIDE_TARGET_CHANGED");
  }
  if (cleared.length) {
    const updated = await q(
      "UPDATE property_sync_fields SET active_override=false,override_value=NULL,updated_at=clock_timestamp() WHERE property_id=$1 AND field_name=ANY($2::text[]) AND (active_override OR override_value IS NOT NULL) RETURNING field_name",
      [propertyId, cleared],
    );
    if (updated.length !== cleared.length) throw Error("AUTHORITY_OVERRIDE_FIELDS_CHANGED");
  }
  return { changed: true, overrideFields: plan.changedFields, syncFields: cleared };
}
