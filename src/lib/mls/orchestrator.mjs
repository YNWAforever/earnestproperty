import { evaluateRunGate, evaluateSourceHealth } from "./health.mjs";
import { groupExactMatches, matchCanonicalProperty } from "./match.mjs";
import { reconcileProperty } from "./reconcile.mjs";
import { SOURCE_28HSE, SOURCE_OLD_SITE } from "./source-contract.mjs";

const SOURCES = [SOURCE_OLD_SITE, SOURCE_28HSE];

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown failure");
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function failedSource(source, error) {
  return {
    source,
    identityValid: false,
    robotsAllowed: false,
    paginationComplete: false,
    challengeDetected: true,
    advertisedCounts: { sale: 0, rent: 0 },
    pageCounts: { sale: 0, rent: 0 },
    discovered: 0,
    observations: [],
    failures: [{ code: "adapter_exception", detail: safeError(error) }],
    diagnostics: [],
    conflictingDuplicateIds: [],
  };
}

function observationKey(value) {
  return `${value.source}\u0000${value.externalId}\u0000${value.dealType}\u0000${value.contentHash}`;
}

function countsFor(results, grouped, quarantined, sourceFailures) {
  const sourceValues = Object.values(results);
  return {
    discovered: sourceValues.reduce(
      (sum, result) => sum + (Number.isSafeInteger(result.discovered) ? result.discovered : 0),
      0,
    ),
    parsed: sourceValues.reduce(
      (sum, result) =>
        sum +
        (Array.isArray(result.observations)
          ? result.observations.filter((item) => item.validationState === "valid").length
          : 0),
      0,
    ),
    quarantined:
      quarantined +
      sourceValues.reduce(
        (sum, result) =>
          sum +
          (Array.isArray(result.observations)
            ? result.observations.filter((item) => item.validationState !== "valid").length
            : 0),
        0,
      ),
    exactGroups: grouped.size,
    new: 0,
    changed: 0,
    inactive: 0,
    reactivated: 0,
    retainedOverrideFields: 0,
    existingMediaReused: 0,
    mediaValidated: 0,
    mediaUploaded: 0,
    mediaRejected: 0,
    sourceFailures,
  };
}

function evaluationFor(oldSite, hse28) {
  return {
    sourceStatus: { [SOURCE_OLD_SITE]: oldSite, [SOURCE_28HSE]: hse28 },
    counts: { [SOURCE_OLD_SITE]: oldSite.counts, [SOURCE_28HSE]: hse28.counts },
    baselines: { [SOURCE_OLD_SITE]: oldSite.floors, [SOURCE_28HSE]: hse28.floors },
  };
}

function completion(status, evaluation, failureCode = null, failureSummary = null) {
  return { status, ...evaluation, failureCode, failureSummary };
}

function checkInput(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("runDualSourceSync input is required");
  if (input.mode !== "shadow" && input.mode !== "publish") throw new TypeError("invalid mode");
  if (!input.repository || !input.adapters || !input.media || !input.reporter)
    throw new TypeError("repository, adapters, media, and reporter are required");
}

function fieldWrites(reconciliation) {
  return Object.entries(reconciliation.fields).map(([fieldName, field]) => ({
    fieldName,
    lastPublishedValue: field.nextFieldState?.last_published_value ?? field.value,
    overrideValue: field.nextFieldState?.override_value ?? null,
    activeOverride: field.nextFieldState?.active_override === true,
    winningObservationId: field.observationId ?? null,
  }));
}

/** Uses the caller-owned advisory-lock session; this function never creates a DB client/session. */
export async function runDualSourceSync(input) {
  checkInput(input);
  const { repository, reporter, signal } = input;
  let runId = null;
  let evaluation = { sourceStatus: {}, counts: {}, baselines: {} };
  let publicationCommitted = false;
  try {
    runId = (
      await repository.beginRun({
        scheduledFor: input.scheduledFor,
        mode: input.mode,
        parserVersion: input.parserVersion,
      })
    ).runId;
    const settled = await Promise.allSettled([
      input.adapters.oldSite.collect(),
      input.adapters.hse28.collect(),
    ]);
    const results = {
      [SOURCE_OLD_SITE]:
        settled[0].status === "fulfilled"
          ? settled[0].value
          : failedSource(SOURCE_OLD_SITE, settled[0].reason),
      [SOURCE_28HSE]:
        settled[1].status === "fulfilled"
          ? settled[1].value
          : failedSource(SOURCE_28HSE, settled[1].reason),
    };
    const persisted = new Map();
    for (const source of SOURCES) {
      const observations = results[source].observations;
      const refs = await repository.saveObservations(runId, observations);
      observations.forEach((observation, index) => {
        if (refs[index]) persisted.set(observationKey(observation), refs[index]);
      });
    }
    const history = await Promise.all(
      SOURCES.map((source) => repository.getHealthyCountHistory(source, 7)),
    );
    const decisions = {
      [SOURCE_OLD_SITE]: evaluateSourceHealth(results[SOURCE_OLD_SITE], {
        previousSuccessful: history[0][0],
        rollingCounts: history[0],
      }),
      [SOURCE_28HSE]: evaluateSourceHealth(results[SOURCE_28HSE], {
        previousSuccessful: history[1][0],
        rollingCounts: history[1],
      }),
    };
    evaluation = evaluationFor(decisions[SOURCE_OLD_SITE], decisions[SOURCE_28HSE]);
    await repository.recordRunEvaluation(runId, evaluation);
    const gate = evaluateRunGate({
      oldSite: decisions[SOURCE_OLD_SITE],
      hse28: decisions[SOURCE_28HSE],
    });
    const sourceFailures = settled.filter((item) => item.status === "rejected").length;
    const sourceObservations =
      gate.mode === "degraded"
        ? results[SOURCE_28HSE].observations
        : [...results[SOURCE_OLD_SITE].observations, ...results[SOURCE_28HSE].observations];
    const grouping = groupExactMatches(sourceObservations);
    const counts = countsFor(
      results,
      grouping.matched,
      grouping.quarantined.length,
      sourceFailures,
    );
    if (gate.mode === "blocked") {
      const outcome = {
        runId,
        status: "blocked",
        evaluation,
        gate,
        counts,
        proposals: [],
        quarantines: grouping.quarantined,
      };
      await reporter.writeRunArtifacts(outcome);
      await repository.finishRun(runId, completion("blocked", evaluation));
      return outcome;
    }
    if (input.mode === "publish") {
      const streak = await repository.getApprovedHealthyShadowStreak(input.scheduledFor);
      if (input.publishEnabled !== true || gate.mayPublishUpserts !== true || streak.length < 7) {
        const outcome = {
          runId,
          status: "blocked",
          evaluation,
          gate,
          counts,
          proposals: [],
          quarantines: grouping.quarantined,
        };
        await reporter.writeRunArtifacts(outcome);
        await repository.finishRun(runId, completion("blocked", evaluation));
        return outcome;
      }
    }
    const groups = [...grouping.matched.entries()].map(([matchKey, observations]) => ({
      matchKey,
      observations,
    }));
    const candidates = await repository.findCanonicalCandidates(
      groups.map((group) => group.matchKey),
    );
    const links = await repository.loadSourceLinks(
      groups.flatMap((group) =>
        group.observations.map((item) => ({
          source: item.source,
          externalId: item.externalId,
          dealType: item.dealType,
        })),
      ),
    );
    const propertyIds = candidates.map((candidate) => candidate.id);
    const [estateIdsBySlug, fieldStates, lifecycleStates] = await Promise.all([
      repository.loadEstateIdsBySlug(
        groups.flatMap((group) =>
          group.observations.map((item) => item.fields?.estate_slug).filter(Boolean),
        ),
      ),
      repository.loadFieldStates(propertyIds),
      repository.loadLifecycleStates(propertyIds),
    ]);
    const lifecycleByProperty = new Map(lifecycleStates.map((item) => [item.property_id, item]));
    const proposedLinks = [],
      proposals = [],
      quarantines = [...grouping.quarantined];
    for (const group of groups) {
      const match = matchCanonicalProperty(group, candidates, links);
      if (match.kind === "ambiguous") {
        quarantines.push({ code: match.reason, matchKey: group.matchKey });
        continue;
      }
      const observations = group.observations.map((item) => ({
        ...item,
        id: persisted.get(observationKey(item))?.id,
      }));
      const prepared = await input.media.prepareListingMedia({
        mode: input.mode === "publish" ? "upload" : "validate",
        observation: observations[0],
        isNew: match.kind === "new",
        rightsConfirmed: input.mediaRightsConfirmed,
        repository,
        signal,
      });
      counts.mediaValidated += input.mode === "shadow" ? 1 : 0;
      counts.mediaUploaded += prepared.uploadCount ?? 0;
      if (!prepared.publishable) {
        counts.mediaRejected += 1;
        counts.quarantined += 1;
        quarantines.push({
          code: "media_preparation_failed",
          matchKey: group.matchKey,
          reasons: prepared.reasons,
        });
        continue;
      }
      const reconciliation = reconcileProperty({
        kind: match.kind === "existing" ? "update" : "new",
        current: match.kind === "existing" ? match.property : {},
        listingNo: match.listingNo,
        observations,
        persistedObservationRefs: observations
          .map((item) => persisted.get(observationKey(item)))
          .filter(Boolean),
        fieldStates:
          match.kind === "existing"
            ? fieldStates.filter((state) => state.property_id === match.propertyId)
            : [],
        lifecycleState: lifecycleByProperty.get(match.propertyId),
        estateIdsBySlug,
        preparedImages: prepared.prepared ? [prepared.prepared] : [],
      });
      if (reconciliation.validationEvidence.blockingCodes.length) {
        quarantines.push(...reconciliation.quarantines);
        continue;
      }
      reconciliation.canonical.images = prepared.images ?? reconciliation.canonical.images;
      const base = {
        links: observations.map((item) => ({
          source: item.source,
          externalId: item.externalId,
          dealType: item.dealType,
          matchKey: item.matchKey,
          observedAt: item.fetchedAt,
        })),
        fields: fieldWrites(reconciliation),
        lifecycle: { consecutiveAbsentHealthyRuns: 0, inactiveReason: null, inactiveAt: null },
        events: [],
      };
      const proposal =
        match.kind === "existing"
          ? {
              ...base,
              kind: "update",
              propertyId: match.propertyId,
              expectedUpdatedAt: match.property.updated_at,
              canonical: reconciliation.canonical,
            }
          : { ...base, kind: "new", canonical: reconciliation.canonical };
      proposals.push(proposal);
      counts[proposal.kind === "new" ? "new" : "changed"] += 1;
      counts.retainedOverrideFields += proposal.fields.filter(
        (field) => field.activeOverride,
      ).length;
      if (match.kind === "existing")
        proposedLinks.push(
          ...observations.map((item) => ({
            propertyId: match.propertyId,
            source: item.source,
            externalId: item.externalId,
            dealType: item.dealType,
            matchKey: item.matchKey,
            observedAt: item.fetchedAt,
          })),
        );
    }
    if (proposedLinks.length) await repository.saveProposedLinks(runId, proposedLinks);
    if (input.mode === "shadow") {
      const status = gate.mode === "degraded" ? "degraded" : "shadow_healthy";
      const outcome = { runId, status, evaluation, gate, counts, proposals, quarantines };
      await reporter.writeRunArtifacts(outcome);
      await repository.finishRun(runId, completion(status, evaluation));
      return outcome;
    }
    await repository.assertLockSession({ signal });
    const published = await repository.publishBatch({
      runId,
      mode: "publish",
      publishEnabled: true,
      proposals,
      signal,
    });
    publicationCommitted = true;
    counts.new = published.inserted;
    counts.changed = published.updated;
    const status = gate.mode === "degraded" ? "degraded" : "healthy";
    const outcome = { runId, status, evaluation, gate, counts, proposals, quarantines };
    await reporter.writeRunArtifacts(outcome);
    await repository.finishRun(runId, completion(status, evaluation));
    return outcome;
  } catch (error) {
    if (runId) {
      const failureCode = publicationCommitted
        ? "artifact_write_failed_after_publish"
        : "orchestrator_failed";
      const failureSummary = safeError(error);
      try {
        await reporter.writeRunArtifacts({
          runId,
          status: "failed",
          evaluation,
          counts: {},
          failureCode,
          failureSummary,
        });
      } catch {}
      try {
        await repository.finishRun(
          runId,
          completion("failed", evaluation, failureCode, failureSummary),
        );
      } catch {}
    }
    throw error;
  }
}
