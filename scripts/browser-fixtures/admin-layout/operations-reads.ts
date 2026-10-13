export * from "../property-maintenance/synthetic-operations";
import * as base from "../property-maintenance/synthetic-operations";
import { read } from "./read-control";
import { assessWhatsappRuntime } from "../../../src/lib/neon/whatsapp-readiness-policy";
import type { fetchWhatsappServiceHealth as fetchRealServiceHealth } from "../../../src/lib/neon/whatsapp-service-health";
export const fetchOperationsHealth = read("fetchOperationsHealth", base.fetchOperationsHealth);
export const fetchOperationsJobs = read("fetchOperationsJobs", base.fetchOperationsJobs);
export const fetchOperationsMigrations = read(
  "fetchOperationsMigrations",
  base.fetchOperationsMigrations,
);
export const fetchWhatsappServiceHealth = read(
  "fetchWhatsappServiceHealth",
  async (): Promise<Awaited<ReturnType<typeof fetchRealServiceHealth>>> => {
    if (!["admin", "manager"].includes(window.propertyFixture.role))
      throw Error("403 synthetic service health");
    // A successful synthetic read of disabled service, not a provider readiness claim.
    return {
      schemaAvailable: true,
      mode: "off",
      serviceEnabled: false,
      runtime: assessWhatsappRuntime({
        mode: "off",
        serviceEnabled: false,
        channelId: null,
        inboxProviderVerified: false,
        staffTransportVerified: false,
        staffWhatsappEnabled: false,
        templateConfigured: false,
        checkedAt: "2026-10-13T00:00:00Z",
      }),
      redirectCapacity: {
        registeredPerLinkPerMinute: 10,
        globalShards: 1,
        globalPerShardPerMinute: 10,
      },
      legacyNames: [],
      policy: { version: null, purpose: null, timezone: null, workerLagSeconds: null },
      coverage: null,
      heartbeatAt: null,
      oldestDueAt: null,
      nextWakeAt: null,
      lastSuccessAt: null,
      overdueJobs: 0,
      expiredLeases: 0,
      routingUnknown: 0,
      sendingUnknown: 0,
      blockedSurveys: 0,
      missingApproval: true,
      counts: {
        opens: 0,
        enquiries: 0,
        attributable: 0,
        confirmedAssignments: 0,
        humanResponses: 0,
        surveyAnswers: 0,
      },
      measurement: {
        timezone: "Asia/Hong_Kong",
        humanResponseSample: 0,
        exclusions: ["synthetic fixture"],
      },
      reasons: ["SERVICE_POLICY_UNAPPROVED"],
    };
  },
);
