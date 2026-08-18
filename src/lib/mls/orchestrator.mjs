import { evaluateRunGate, evaluateSourceHealth } from "./health.mjs";
import { groupExactMatches, matchCanonicalProperty } from "./match.mjs";
import { nextLifecycleState, reconcileProperty } from "./reconcile.mjs";
import { SOURCE_28HSE, SOURCE_OLD_SITE } from "./source-contract.mjs";

const SOURCES = [SOURCE_OLD_SITE, SOURCE_28HSE];
const CANONICAL_KEYS = [
  "listing_no",
  "canonical_property_no",
  "title_zh",
  "title_en",
  "deal_type",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
];
const NEW_CANONICAL_METADATA_KEYS = [
  "featured",
  "management_fee",
  "video_url",
  "floorplan_url",
  "source_site",
  "legacy_detail_id",
  "legacy_property_no",
  "legacy_url",
];

function plainData(value) {
  if (Array.isArray(value)) return value.map(plainData);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).map((key) => [key, plainData(value[key])]));
  return value;
}

function projectCanonical(canonical, kind) {
  const keys =
    kind === "new" ? [...CANONICAL_KEYS, ...NEW_CANONICAL_METADATA_KEYS] : CANONICAL_KEYS;
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(canonical, key))
      .map((key) => [key, plainData(canonical[key])]),
  );
}

function mediaResult(value) {
  return {
    candidateResults: Array.isArray(value.candidateResults)
      ? value.candidateResults
      : Array.isArray(value.results)
        ? value.results
        : [],
    preparedMedia: value.preparedMedia ?? value.prepared ?? null,
  };
}

function safeCurrentImages(match) {
  const images = match.kind === "existing" ? match.property?.images : [];
  return Array.isArray(images) ? plainData(images) : [];
}

function lifecycleFor(reconciliation, match, lifecycleState, gate) {
  const current = match.kind === "existing" ? match.property : {};
  const consecutive = lifecycleState?.consecutive_absent_healthy_runs ?? 0;
  const next = nextLifecycleState({
    consecutive: Number.isSafeInteger(consecutive) && consecutive >= 0 ? consecutive : 0,
    seen: true,
    mayAdvanceInactivity: gate.mayAdvanceInactivity === true,
    currentStatus: current.status ?? reconciliation.canonical.status,
    hasStatusOverride: reconciliation.fields.status?.nextFieldState?.active_override === true,
  });
  if (next.statusChange === "active" && reconciliation.canonical.status === "inactive") {
    reconciliation.canonical.status = "active";
    reconciliation.fields.status = {
      ...reconciliation.fields.status,
      value: "active",
      changed: true,
      observationId: null,
      nextFieldState: {
        last_published_value: "active",
        override_value: null,
        active_override: false,
      },
    };
  }
  return { consecutiveAbsentHealthyRuns: next.consecutive, inactiveReason: null, inactiveAt: null };
}

function sameLink(link, observation) {
  return (
    link?.source === observation.source &&
    (link.external_listing_id ?? link.externalId) === observation.externalId &&
    (link.deal_type ?? link.dealType) === observation.dealType
  );
}

function changeEvents({
  kind,
  canonical,
  reconciliation,
  current,
  observations,
  sourceLinks,
  lifecycle,
}) {
  const events = [];
  if (kind === "new") {
    events.push({
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: plainData(canonical),
      winningObservationId: observations[0]?.id ?? null,
      reason: null,
    });
  } else {
    for (const [fieldName, field] of Object.entries(reconciliation.fields)) {
      if (!field.changed) continue;
      const oldValue = current[fieldName] ?? null;
      const newValue = canonical[fieldName];
      let changeType = "changed";
      let reason = null;
      let winningObservationId = field.observationId ?? null;
      if (fieldName === "status" && newValue === "inactive") {
        changeType = "inactive";
        reason = lifecycle.inactiveReason;
        winningObservationId = null;
      } else if (fieldName === "status" && oldValue === "inactive") {
        changeType = "reactivated";
        winningObservationId = null;
      }
      events.push({
        changeType,
        fieldName,
        oldValue: plainData(oldValue),
        newValue: plainData(newValue),
        winningObservationId,
        reason,
      });
    }
  }
  for (const observation of observations) {
    const existing = sourceLinks.find((link) => sameLink(link, observation));
    if (existing?.status === "active") continue;
    events.push({
      changeType: "link_change",
      fieldName: null,
      oldValue: existing
        ? {
            source: observation.source,
            externalId: observation.externalId,
            dealType: observation.dealType,
            matchKey: existing.match_key ?? existing.matchKey,
            status: existing.status,
          }
        : null,
      newValue: {
        source: observation.source,
        externalId: observation.externalId,
        dealType: observation.dealType,
        matchKey: observation.matchKey,
        status: "active",
      },
      winningObservationId: observation.id ?? null,
      reason: null,
    });
  }
  return events;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown failure");
  return message
    .replace(/<[^>]*>/g, "[redacted_html]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"'<>]+/gi, "[redacted_connection]")
    .replace(
      /\b(?:authorization|api[_-]?key|password|secret|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      (match) => `${match.split(/[:=]/)[0]}=[redacted]`,
    )
    .replace(
      /\b(?:params?|parameters|values?)\s*[:=]\s*(?:\[[^\]]*\]|\{[^}]*\})/gi,
      "[redacted_sql_parameters]",
    )
    .replace(/\$(?:\d+|\{[^}]+\})/g, "[redacted_sql_parameter]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
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
  let postCommitPhase = null;
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
    const proposedLinks = [];
    const work = [];
    const quarantines = [...grouping.quarantined];
    const proposals = [];
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
      if (!observations[0]?.id) {
        counts.quarantined += 1;
        quarantines.push({ code: "persisted_observation_missing", matchKey: group.matchKey });
        continue;
      }
      work.push({ group, match, observations });
      if (match.kind === "existing") {
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
    }
    if (proposedLinks.length) await repository.saveProposedLinks(runId, proposedLinks);

    let lockVerified = false;
    for (const { group, match, observations } of work) {
      const currentImages = safeCurrentImages(match);
      if (input.mode === "publish" && !lockVerified) {
        await repository.assertLockSession({ signal });
        lockVerified = true;
      }
      const prepared = await input.media.prepareListingMedia({
        mode: input.mode === "publish" ? "upload" : "validate",
        observation: observations[0],
        observationId: observations[0].id,
        propertyId: match.kind === "existing" ? match.propertyId : null,
        currentImages,
        allowedMediaHosts: input.mediaAllowedHosts,
        blobStore: input.blobStore,
        isNew: match.kind === "new",
        rightsConfirmed: input.mediaRightsConfirmed,
        repository,
        signal,
      });
      const media = mediaResult(prepared);
      counts.mediaValidated += input.mode === "shadow" ? 1 : 0;
      counts.mediaUploaded += prepared.uploadCount ?? 0;
      if (match.kind === "existing") {
        counts.existingMediaReused += media.candidateResults.filter(
          (candidate) =>
            candidate?.ownedMediaAssetId != null && candidate?.sourceUrl === candidate?.ownedUrl,
        ).length;
      }
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
        preparedImages: media.preparedMedia ? [media.preparedMedia] : [],
        currentOwnedImages: currentImages,
      });
      if (reconciliation.validationEvidence.blockingCodes.length) {
        counts.quarantined += Math.max(1, reconciliation.quarantines.length);
        quarantines.push(...reconciliation.quarantines);
        continue;
      }
      reconciliation.canonical.images = Array.isArray(prepared.images)
        ? plainData(prepared.images)
        : reconciliation.canonical.images;
      const lifecycle = lifecycleFor(
        reconciliation,
        match,
        lifecycleByProperty.get(match.propertyId),
        gate,
      );
      const kind = match.kind === "existing" ? "update" : "new";
      const canonical = projectCanonical(reconciliation.canonical, kind);
      const base = {
        links: observations.map((item) => ({
          source: item.source,
          externalId: item.externalId,
          dealType: item.dealType,
          matchKey: item.matchKey,
          observedAt: item.fetchedAt,
        })),
        fields: fieldWrites(reconciliation),
        lifecycle,
        events: changeEvents({
          kind,
          canonical,
          reconciliation,
          current: match.kind === "existing" ? match.property : {},
          observations,
          sourceLinks: links,
          lifecycle,
        }),
      };
      const proposal =
        kind === "update"
          ? {
              ...base,
              kind,
              propertyId: match.propertyId,
              expectedUpdatedAt: match.property.updated_at,
              canonical,
            }
          : { ...base, kind, canonical };
      proposals.push(proposal);
      counts[kind === "new" ? "new" : "changed"] += 1;
      counts.retainedOverrideFields += proposal.fields.filter(
        (field) => field.activeOverride,
      ).length;
    }
    if (input.mode === "shadow") {
      const status = gate.mode === "degraded" ? "degraded" : "shadow_healthy";
      const outcome = { runId, status, evaluation, gate, counts, proposals, quarantines };
      await reporter.writeRunArtifacts(outcome);
      await repository.finishRun(runId, completion(status, evaluation));
      return outcome;
    }
    if (!lockVerified) await repository.assertLockSession({ signal });
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
    postCommitPhase = "artifacts";
    await reporter.writeRunArtifacts(outcome);
    postCommitPhase = "finish";
    await repository.finishRun(runId, completion(status, evaluation));
    return outcome;
  } catch (error) {
    if (runId) {
      const failureCode = !publicationCommitted
        ? "orchestrator_failed"
        : postCommitPhase === "artifacts"
          ? "artifact_write_failed_after_publish"
          : "run_finalization_failed_after_publish";
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
