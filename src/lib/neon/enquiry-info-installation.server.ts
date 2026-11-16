import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server.ts";
import {
  ENQUIRY_INFO_POLICY_VERSION,
  ENQUIRY_INFO_PURPOSE,
  ENQUIRY_INFO_SCHEMA_VERSION,
  type EnquiryInfoInstallationEvidence,
} from "../whatsapp-enquiries/enquiry-info-readiness.js";

type Scope = { appId: string; channelId: string };
type InstalledComponents = {
  receiptAdmissionVersion: number;
  neutralHoldVersion: number;
  templateTransportVersion: number;
};

/**
 * Structural software evidence, independent of provider/recipient permission.
 * The trusted deployment enqueuer writes its real release attestation only after
 * exact CI, migration/main compatibility and canonical Production verification.
 * Runtime components and the current schema are checked again here. This is not
 * a replacement for authenticated sender/template checks or staff review heads.
 */
export async function getCurrentEnquiryInfoInstallationEvidence(
  scope: Scope,
  ports: { query?: typeof queryRows; env?: NodeJS.ProcessEnv } = {},
): Promise<EnquiryInfoInstallationEvidence | null> {
  const [receipts, intake, transport] = await Promise.all([
    import("../whatsapp-enquiries/inbound-receipts.server.ts"),
    import("../whatsapp-enquiries/enquiry-info-intake.server.ts"),
    import("../woztell/enquiry-info-template-transport.server.ts"),
  ]);
  return getEnquiryInfoInstallationEvidence(
    scope,
    {
      receiptAdmissionVersion: receipts.receiptAdmissionVersion,
      neutralHoldVersion: intake.neutralHoldVersion,
      templateTransportVersion: transport.ENQUIRY_INFO_TRANSPORT_VERSION,
    },
    ports,
  );
}

export async function getEnquiryInfoInstallationEvidence(
  scope: Scope,
  components: InstalledComponents,
  ports: {
    query?: typeof queryRows;
    env?: NodeJS.ProcessEnv;
    schemaAvailable?: (query: typeof queryRows) => Promise<boolean>;
  } = {},
): Promise<EnquiryInfoInstallationEvidence | null> {
  const env = ports.env ?? process.env;
  const buildSha = env.VERCEL_GIT_COMMIT_SHA;
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(scope.appId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(scope.channelId) ||
    typeof buildSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(buildSha) ||
    components.receiptAdmissionVersion !== ENQUIRY_INFO_POLICY_VERSION ||
    components.neutralHoldVersion !== ENQUIRY_INFO_POLICY_VERSION ||
    components.templateTransportVersion !== ENQUIRY_INFO_POLICY_VERSION
  )
    return null;
  const query = ports.query ?? queryRows;
  const schemaAvailable =
    ports.schemaAvailable ??
    (await import("./enquiry-info-decisions.server.ts")).enquiryInfoSchemaAvailable;
  if (!(await schemaAvailable(query))) return null;
  const rows = await query(
    `SELECT a.id,a.metadata->>'releaseSha' AS release_sha
     FROM audit_logs a JOIN ops_jobs j ON j.id=a.subject_id
     WHERE a.action='whatsapp.enquiry_forwarding.check_requested' AND a.actor_id IS NULL AND a.subject_type='ops_job'
       AND a.metadata->>'source'='approved_deployment_verification'
       AND a.metadata->>'releaseSha'=$1
       AND j.job_type='woztell.enquiry.forward.readiness' AND j.payload_version=1 AND j.payload='{}'::jsonb
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,
    [buildSha],
  );
  const proof = rows[0];
  if (
    !proof ||
    typeof proof.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(proof.id) ||
    proof.release_sha !== buildSha
  )
    return null;
  return {
    purpose: ENQUIRY_INFO_PURPOSE,
    version: ENQUIRY_INFO_POLICY_VERSION,
    appId: scope.appId,
    channelId: scope.channelId,
    schemaVersion: ENQUIRY_INFO_SCHEMA_VERSION,
    schemaAvailable: true,
    ...components,
    runtimeBuildSha: buildSha,
    verifiedBuildSha: buildSha,
    releaseAuditId: proof.id,
  };
}
