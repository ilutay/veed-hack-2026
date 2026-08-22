import type {
  AssessResponseOutput,
  AuthorRepOutput,
  ChallengeTemplateInput,
  CodexAction,
  CodexActionOutputMap,
  CodexActionRequestMap,
  CriterionEvidenceOutput,
  DecideNextOutput,
  DecideNextRequest,
  InterpretGoalOutput,
  InterpretGoalRequest,
} from "./types";

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function inferCurrentLevel(
  prompt: string,
): InterpretGoalOutput["currentLevel"] {
  if (/\b(advanced|expert|professional|senior)\b/iu.test(prompt)) {
    return "advanced";
  }
  if (/\b(practiced|intermediate|some experience)\b/iu.test(prompt)) {
    return "practiced";
  }
  if (/\b(beginner|novice|new to|starting)\b/iu.test(prompt)) {
    return "novice";
  }
  return "unknown";
}

function fallbackGoal(request: InterpretGoalRequest): InterpretGoalOutput {
  const prompt = request.rawPrompt.trim();
  const directlySupported =
    /\b(visual|hierarchy|composition|layout|focal|attention|design|edit(?:ing)?|video|short[ -]?form|product video|typography)\b/iu.test(
      prompt,
    );
  const nearby =
    /\b(creative|brand|marketing|content|presentation|slide|advertis(?:e|ing)|storytell(?:ing)?)\b/iu.test(
      prompt,
    );

  const supportStatus = directlySupported
    ? "supported"
    : nearby
      ? "mapped_with_explanation"
      : "unsupported";
  const supported = supportStatus !== "unsupported";

  return {
    goalInstanceId: request.goalInstanceId,
    goalDefinitionId: supported
      ? "visual-hierarchy.short-form-v1"
      : "unsupported.v1",
    rawPrompt: request.rawPrompt,
    domain: supported ? "visual communication" : "unsupported",
    targetCapability: supported
      ? "visual hierarchy in short-form product video"
      : "outside the current demo envelope",
    intendedUse: supported
      ? "Make attention and focal order feel intentional in a short-form product video."
      : "The current demo can teach visual hierarchy for short-form product video.",
    currentLevel: inferCurrentLevel(prompt),
    sessionTimeboxSeconds: request.sessionTimeboxSeconds,
    constraints: supported
      ? [
          "visual hierarchy only",
          "learner must take an observable action",
          "held-out transfer gates the learning claim",
        ]
      : ["current demo supports visual hierarchy in short-form product video"],
    supportStatus,
    interpretationShownToHuman: supported
      ? supportStatus === "supported"
        ? "We'll practice making focal order intentional in a short-form product video."
        : "I'll map that goal to visual hierarchy in a short-form product video for this demo."
      : "This demo currently supports visual hierarchy in short-form product video; your goal is outside that envelope.",
    clarificationQuestion: null,
  };
}

function isReceiptBound(template: ChallengeTemplateInput): boolean {
  return (
    template.stimulusReceiptId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(template.stimulusReceiptSha256)
  );
}

function compareAuthorCandidates(
  left: ChallengeTemplateInput,
  right: ChallengeTemplateInput,
  desiredRole: string,
  currentSubskill: string | null,
): number {
  const roleDelta =
    Number(right.episodeRole === desiredRole) -
    Number(left.episodeRole === desiredRole);
  if (roleDelta !== 0) return roleDelta;

  const skillDelta =
    Number(right.subskill === currentSubskill) -
    Number(left.subskill === currentSubskill);
  if (skillDelta !== 0) return skillDelta;

  const timeDelta = left.estimatedSeconds - right.estimatedSeconds;
  if (timeDelta !== 0) return timeDelta;
  return left.challengeTemplateId.localeCompare(right.challengeTemplateId);
}

function fallbackAuthor(
  request: CodexActionRequestMap["author_rep"],
): AuthorRepOutput {
  const candidates = request.eligibleTemplates
    .filter(
      (template) =>
        template.goalDefinitionId === request.goal.goalDefinitionId &&
        template.estimatedSeconds <= request.maxEstimatedSeconds &&
        isReceiptBound(template),
    )
    .sort((left, right) =>
      compareAuthorCandidates(
        left,
        right,
        request.desiredEpisodeRole,
        request.currentSubskill,
      ),
    );
  const chosen = candidates[0];

  if (!chosen) {
    return {
      status: "blocked",
      goalDefinitionId: request.goal.goalDefinitionId,
      challengeTemplateId: null,
      stimulusReceiptId: null,
      stimulusReceiptSha256: null,
      episodeRole: null,
      subskill: null,
      contextId: null,
      actionMode: null,
      learningObjective: null,
      intendedContrast: null,
      invariants: [],
      learnerPrompt: null,
      authoringRationale:
        "No time-compatible template with an exact fal-derived stimulus receipt matched this goal.",
      repairHintsApplied: [],
    };
  }

  const repairHintsApplied = request.pioneerRepairHints.filter((hint) =>
    [
      chosen.learningObjective,
      chosen.intendedContrast,
      ...chosen.invariants,
      chosen.learnerPrompt,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(hint.toLocaleLowerCase()),
  );

  return {
    status: "selected",
    goalDefinitionId: chosen.goalDefinitionId,
    challengeTemplateId: chosen.challengeTemplateId,
    stimulusReceiptId: chosen.stimulusReceiptId,
    stimulusReceiptSha256: chosen.stimulusReceiptSha256,
    episodeRole: chosen.episodeRole,
    subskill: chosen.subskill,
    contextId: chosen.contextId,
    actionMode: chosen.actionMode,
    learningObjective: chosen.learningObjective,
    intendedContrast: chosen.intendedContrast,
    invariants: [...chosen.invariants],
    learnerPrompt: chosen.learnerPrompt,
    authoringRationale: `Selected the shortest receipt-bound ${chosen.episodeRole} rep compatible with the current goal and subskill.`,
    repairHintsApplied,
  };
}

function fallbackAssessment(
  request: CodexActionRequestMap["assess_response"],
): AssessResponseOutput {
  const actionIds = uniqueSorted([
    ...(request.actionValue.optionId ? [request.actionValue.optionId] : []),
    ...request.actionValue.orderedIds,
  ]);
  const reasoningTagIds = uniqueSorted(request.reasoningTagIds);
  const hasBoundedAction =
    actionIds.length > 0 ||
    request.actionValue.booleanValue !== null ||
    request.actionValue.numericValue !== null;
  const hasReasoning =
    reasoningTagIds.length > 0 || Boolean(request.reasoningText?.trim());
  const hasObservableResponse = hasBoundedAction || hasReasoning;

  let assessmentStatus: AssessResponseOutput["assessmentStatus"];
  if (!request.validatedRepBound) {
    assessmentStatus = "abstained";
  } else if (!hasObservableResponse || (request.reasoningRequired && !hasReasoning)) {
    assessmentStatus = "needs_more_evidence";
  } else {
    assessmentStatus = "scored";
  }

  const criterionEvidence: CriterionEvidenceOutput[] = request.rubric.map(
    (criterion) => {
      if (!request.validatedRepBound || !hasObservableResponse) {
        return {
          criterionId: criterion.criterionId,
          outcome: "unscorable",
          observationCode: !request.validatedRepBound
            ? "validated_rep_binding_missing"
            : "observable_response_missing",
          evidenceRefs: [],
        };
      }

      const matchingActionIds = actionIds.filter((id) =>
        criterion.acceptableActionIds.includes(id),
      );
      const matchingTagIds = reasoningTagIds.filter((id) =>
        criterion.acceptableReasoningTagIds.includes(id),
      );
      const requiresAction = criterion.acceptableActionIds.length > 0;
      const requiresTag = criterion.acceptableReasoningTagIds.length > 0;
      const requiredChannels = Number(requiresAction) + Number(requiresTag);
      const matchedChannels =
        Number(matchingActionIds.length > 0) + Number(matchingTagIds.length > 0);

      const outcome =
        requiredChannels === 0
          ? "unscorable"
          : matchedChannels === requiredChannels
            ? "met"
            : matchedChannels > 0
              ? "partial"
              : "not_met";
      const evidenceRefs = uniqueSorted([
        ...matchingActionIds,
        ...matchingTagIds,
        ...(request.reasoningText?.trim() ? [request.responseId] : []),
      ]);

      return {
        criterionId: criterion.criterionId,
        outcome,
        observationCode:
          outcome === "met"
            ? "bounded_evidence_satisfies_criterion"
            : outcome === "partial"
              ? "one_evidence_channel_missing"
              : outcome === "not_met"
                ? "bounded_evidence_does_not_satisfy_criterion"
                : "criterion_has_no_deterministic_rule",
        evidenceRefs,
      };
    },
  );

  const scoredOutcomes = criterionEvidence.map((item) => item.outcome);
  const looksSuccessful =
    scoredOutcomes.length > 0 &&
    scoredOutcomes.every((outcome) => outcome === "met" || outcome === "partial");
  const confidenceCalibration =
    assessmentStatus !== "scored"
      ? "unknown"
      : looksSuccessful
        ? request.statedConfidence === "low"
          ? "under"
          : "aligned"
        : request.statedConfidence === "high"
          ? "over"
          : "aligned";

  const reasonCodes = uniqueSorted([
    assessmentStatus,
    ...(request.reasoningRequired && !hasReasoning
      ? ["required_reasoning_missing"]
      : []),
    ...(!request.validatedRepBound ? ["validated_rep_binding_missing"] : []),
  ]);

  return {
    evidenceId: request.evidenceId,
    responseId: request.responseId,
    exerciseId: request.exerciseId,
    exerciseRevision: request.exerciseRevision,
    episodeRole: request.episodeRole,
    validationId: request.validationId,
    gymSpecHash: request.gymSpecHash,
    assessmentStatus,
    criterionEvidence,
    confidenceCalibration,
    assessorVersion: "codex-deterministic-rubric-v1",
    reasonCodes,
  };
}

function rolePriority(phase: DecideNextRequest["currentPhase"]): string[] {
  if (phase === "transfer_pending") {
    return ["held_out_transfer", "retry", "diagnostic_probe"];
  }
  if (phase === "unexplored") {
    return ["diagnostic_probe", "retry", "held_out_transfer"];
  }
  return ["retry", "diagnostic_probe", "held_out_transfer"];
}

function safeDecisionCandidates(
  request: DecideNextRequest,
): ChallengeTemplateInput[] {
  if (request.currentPhase === "transfer_shown") return [];
  const priority = rolePriority(request.currentPhase);

  return request.eligibleChallenges
    .filter(
      (candidate) =>
        candidate.prevalidated &&
        candidate.subskill === request.currentSubskill &&
        candidate.estimatedSeconds <= request.maxEstimatedSeconds &&
        isReceiptBound(candidate) &&
        candidate.episodeRole !== "baseline",
    )
    .sort((left, right) => {
      const roleDelta =
        priority.indexOf(left.episodeRole) - priority.indexOf(right.episodeRole);
      if (roleDelta !== 0) return roleDelta;
      const timeDelta = left.estimatedSeconds - right.estimatedSeconds;
      if (timeDelta !== 0) return timeDelta;
      return left.challengeTemplateId.localeCompare(right.challengeTemplateId);
    });
}

function recommendationMatches(
  request: DecideNextRequest,
  candidate: ChallengeTemplateInput,
): boolean {
  const recommendation = request.pioneerRecommendation;
  if (!recommendation) return false;
  return (
    recommendation.recommendedChallengeTemplateId ===
      candidate.challengeTemplateId &&
    recommendation.recommendedSubskill === candidate.subskill &&
    recommendation.recommendedActionMode === candidate.actionMode &&
    recommendation.episodeRole === candidate.episodeRole &&
    recommendation.evidenceIds.length > 0 &&
    recommendation.evidenceIds.every((id) =>
      request.latestEvidenceIds.includes(id),
    )
  );
}

function decisionFromCandidate(
  decision: DecideNextOutput["decision"],
  request: DecideNextRequest,
  chosen: ChallengeTemplateInput,
  reasonCode: string,
  rationale: string,
): DecideNextOutput {
  const recommendation = request.pioneerRecommendation;
  return {
    decision,
    recommendationId: recommendation?.recommendationId ?? null,
    chosenChallengeTemplateId: chosen.challengeTemplateId,
    stimulusReceiptId: chosen.stimulusReceiptId,
    stimulusReceiptSha256: chosen.stimulusReceiptSha256,
    episodeRole: chosen.episodeRole,
    actionMode: chosen.actionMode,
    renderContractId: chosen.renderContractId,
    componentName: chosen.componentName,
    componentSchemaVersion: chosen.componentSchemaVersion,
    reasonCode,
    rationale,
    citedEvidenceIds:
      decision === "accept" && recommendation
        ? uniqueSorted(recommendation.evidenceIds)
        : uniqueSorted(request.latestEvidenceIds),
    provenanceLabel:
      decision === "accept"
        ? "live_pioneer"
        : decision === "override"
          ? "codex_override"
          : "deterministic_fallback",
  };
}

function fallbackDecision(request: DecideNextRequest): DecideNextOutput {
  const candidates = safeDecisionCandidates(request);
  const matchingRecommendation = candidates.find((candidate) =>
    recommendationMatches(request, candidate),
  );
  if (matchingRecommendation) {
    return decisionFromCandidate(
      "accept",
      request,
      matchingRecommendation,
      "pioneer_recommendation_matches_inventory",
      "Accepted the live Pioneer recommendation because its full semantic tuple and evidence references match an eligible prevalidated challenge.",
    );
  }

  const declaredFallback = request.fallbackChallengeTemplateId
    ? candidates.find(
        (candidate) =>
          candidate.challengeTemplateId === request.fallbackChallengeTemplateId,
      )
    : undefined;
  const chosen = declaredFallback ?? candidates[0];
  if (!chosen) {
    return {
      decision: "block",
      recommendationId: request.pioneerRecommendation?.recommendationId ?? null,
      chosenChallengeTemplateId: null,
      stimulusReceiptId: null,
      stimulusReceiptSha256: null,
      episodeRole: null,
      actionMode: null,
      renderContractId: null,
      componentName: null,
      componentSchemaVersion: null,
      reasonCode: "no_safe_eligible_challenge",
      rationale:
        "No prevalidated, receipt-bound challenge matches the current subskill and timebox.",
      citedEvidenceIds: uniqueSorted(request.latestEvidenceIds),
      provenanceLabel: "blocked",
    };
  }

  if (request.pioneerRecommendation) {
    return decisionFromCandidate(
      "override",
      request,
      chosen,
      "pioneer_recommendation_not_feasible",
      "Overrode the Pioneer recommendation because its tuple or evidence binding did not match the eligible inventory; selected the declared deterministic branch.",
    );
  }

  return decisionFromCandidate(
    "deterministic_fallback",
    request,
    chosen,
    "pioneer_recommendation_unavailable",
    "Selected a disclosed deterministic prevalidated challenge because no Pioneer recommendation was available.",
  );
}

export function deterministicCodexFallback<A extends CodexAction>(
  request: CodexActionRequestMap[A],
): CodexActionOutputMap[A] {
  switch (request.action) {
    case "interpret_goal":
      return fallbackGoal(request) as CodexActionOutputMap[A];
    case "author_rep":
      return fallbackAuthor(request) as CodexActionOutputMap[A];
    case "assess_response":
      return fallbackAssessment(request) as CodexActionOutputMap[A];
    case "decide_next":
      return fallbackDecision(request) as CodexActionOutputMap[A];
  }
}
