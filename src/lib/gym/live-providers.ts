import "../codex/server-only";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { parseCodexActionOutput } from "../codex/schemas";
import {
  createTeamboxActionGatewayClient,
  type TeamboxActionGatewayClient,
} from "../codex/teambox-action-client";
import { TEAMBOX_ACTION_SOCKET_PATH } from "../codex/teambox-protocol";
import type {
  ChallengeTemplateInput,
  CodexAction,
  CodexActionRequestMap,
  CodexActionRunResult,
  DecideNextOutput,
} from "../codex/types";
import { getGymComponentDefinition } from "../contracts/gym-components";
import {
  createPioneerTextGateway,
  type PioneerTextGateway,
} from "../pioneer/gateway";
import {
  NextChallengeRecommendationSchema,
  type EligibleChallengeMetadata,
  type RecommendNextInput,
} from "../pioneer/schemas";

import {
  getGymFixture,
  isGymTemplateId,
  type GymFixtureTemplate,
  type GymTemplateId,
} from "./fixture-inventory";
import type {
  BindPioneerChoiceInput,
  ChooseNextInput,
  CodexBoundCurriculumChoice,
  GymCodexClient,
  GymPioneerClient,
  InterpretGoalInput,
  PioneerCurriculumChoice,
  PioneerTeachingSignalValidation,
  ProviderCallContext,
  ValidateTeachingSignalInput,
} from "./providers";

const GOAL_DEFINITION_ID = "visual-hierarchy.short-form-v1";
const SESSION_TIMEBOX_SECONDS = 90;
const P2_POLICY_VERSION = "pioneer-gym-learning-gain-v1";
const LEARNER_STATE_RULE_VERSION = "pioneer-gym-state-v1";

type RunTeamboxAction = <A extends CodexAction>(
  request: CodexActionRequestMap[A] & { action: A },
  options?: { signal?: AbortSignal },
) => Promise<CodexActionRunResult<A>>;

export interface LiveGymCodexClientOptions {
  gateway?: Pick<TeamboxActionGatewayClient, "run">;
  socketReady?: () => boolean;
}

export interface LiveGymPioneerClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  makeId?: (prefix: string) => string;
  gatewayFactory?: typeof createPioneerTextGateway;
}

function exactStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertLiveCodexResult<A extends CodexAction>(
  action: A,
  result: CodexActionRunResult<A>,
) {
  if (
    result.action !== action ||
    result.source !== "codex_sdk" ||
    result.fallbackReason !== null
  ) {
    throw new Error(`TeamBox returned a non-live ${action} result`);
  }
  return parseCodexActionOutput(
    action,
    JSON.stringify(result.output),
  );
}

function challengePolicy(templateId: GymTemplateId) {
  if (templateId === "retry_focal_order_v1") {
    return {
      contextId: "context_product_card_pair_v1",
      learningObjective: "Preserve a clear promise before proof and action.",
      intendedContrast: "Only the focal order changes while the product copy stays fixed.",
      invariants: ["same subskill", "bounded choice", "prevalidated fixture"],
      learnerPrompt: "Choose the clearer promise to proof to action path.",
      difficulty: "adjacent" as const,
      preserve: ["Keep focal ordering as the target subskill."],
      vary: ["Use a fresh product and information order."],
      removeShortcuts: ["Do not reward surface polish without a clear focal path."],
    };
  }
  if (templateId === "transfer_layer_order_v1") {
    return {
      contextId: "context_vertical_product_story_v1",
      learningObjective: "Transfer focal ordering to a changed construction task.",
      intendedContrast: "Both the context and action mode change while the subskill stays fixed.",
      invariants: ["same subskill", "changed context", "changed action mode"],
      learnerPrompt: "Order the five layers into an intentional product story.",
      difficulty: "harder" as const,
      preserve: ["Keep focal ordering as the target subskill."],
      vary: ["Change the context and require layer construction."],
      removeShortcuts: ["A familiar comparison choice cannot solve this transfer rep."],
    };
  }
  throw new Error(`Template ${templateId} is not eligible for live P2 selection`);
}

function toCodexChallenge(templateId: GymTemplateId): ChallengeTemplateInput {
  const fixture = getGymFixture(templateId);
  const policy = challengePolicy(templateId);
  return {
    challengeTemplateId: fixture.challengeTemplateId,
    goalDefinitionId: GOAL_DEFINITION_ID,
    stimulusReceiptId: fixture.fixtureReceiptId,
    stimulusReceiptSha256: fixture.fixtureContentHash,
    subskill: fixture.subskill,
    contextId: policy.contextId,
    episodeRole: fixture.episodeRole,
    actionMode: fixture.actionMode,
    estimatedSeconds: fixture.estimatedSeconds,
    learningObjective: policy.learningObjective,
    intendedContrast: policy.intendedContrast,
    invariants: policy.invariants,
    learnerPrompt: policy.learnerPrompt,
    renderContractId: `render_${fixture.challengeTemplateId}_v1`,
    componentName: fixture.componentName,
    componentSchemaVersion: getGymComponentDefinition(fixture.componentName)
      .schemaVersion,
    prevalidated: true,
  };
}

function assertExactBinding(
  output: DecideNextOutput,
  input: BindPioneerChoiceInput,
  selected: ChallengeTemplateInput,
) {
  const recommendation = input.recommendation;
  if (
    output.decision !== "accept" ||
    output.recommendationId !== recommendation.recommendationId ||
    output.chosenChallengeTemplateId !==
      recommendation.recommendedChallengeTemplateId ||
    output.stimulusReceiptId !== selected.stimulusReceiptId ||
    output.stimulusReceiptSha256 !== selected.stimulusReceiptSha256 ||
    output.episodeRole !== recommendation.episodeRole ||
    output.actionMode !== recommendation.recommendedActionMode ||
    output.renderContractId !== selected.renderContractId ||
    output.componentName !== selected.componentName ||
    output.componentSchemaVersion !== selected.componentSchemaVersion ||
    output.provenanceLabel !== "live_pioneer" ||
    !exactStringArray(output.citedEvidenceIds, input.latestEvidenceIds)
  ) {
    throw new Error(
      "Codex did not bind the exact evidence-bound Pioneer curriculum choice",
    );
  }
}

export class LiveGymCodexClient implements GymCodexClient {
  readonly mode = "live" as const;
  private readonly gateway: Pick<TeamboxActionGatewayClient, "run">;
  private readonly socketReady: () => boolean;

  constructor(options: LiveGymCodexClientOptions = {}) {
    this.gateway = options.gateway ?? createTeamboxActionGatewayClient();
    this.socketReady =
      options.socketReady ?? (() => existsSync(TEAMBOX_ACTION_SOCKET_PATH));
  }

  isReady() {
    return this.socketReady();
  }

  async interpretGoal(
    input: InterpretGoalInput,
    context: ProviderCallContext,
  ) {
    const result = await (this.gateway.run as RunTeamboxAction)(
      {
        action: "interpret_goal",
        sessionId: input.sessionId,
        goalInstanceId: input.goalInstanceId,
        rawPrompt: input.rawPrompt,
        sessionTimeboxSeconds: input.sessionTimeboxSeconds,
      },
      { signal: context.signal },
    );
    const output = assertLiveCodexResult("interpret_goal", result);
    if (
      output.goalInstanceId !== input.goalInstanceId ||
      output.rawPrompt !== input.rawPrompt ||
      output.sessionTimeboxSeconds !== input.sessionTimeboxSeconds
    ) {
      throw new Error("Codex goal interpretation is not bound to the exact input");
    }
    return output;
  }

  async bindPioneerChoice(
    input: BindPioneerChoiceInput,
    context: ProviderCallContext,
  ): Promise<CodexBoundCurriculumChoice> {
    const eligibleChallenges = input.eligibleChallengeTemplateIds.map(
      (templateId) => {
        if (!isGymTemplateId(templateId)) {
          throw new Error(`Unknown eligible challenge ${templateId}`);
        }
        return toCodexChallenge(templateId);
      },
    );
    const selected = eligibleChallenges.find(
      (challenge) =>
        challenge.challengeTemplateId ===
        input.recommendation.recommendedChallengeTemplateId,
    );
    if (!selected) {
      throw new Error("Pioneer choice is outside the Codex eligible inventory");
    }

    const result = await (this.gateway.run as RunTeamboxAction)(
      {
        action: "decide_next",
        sessionId: input.sessionId,
        goalInstanceId: input.goalInstanceId,
        currentPhase: input.currentPhase,
        currentSubskill: input.currentSubskill,
        latestEvidenceIds: input.latestEvidenceIds,
        pioneerRecommendation: {
          recommendationId: input.recommendation.recommendationId,
          recommendedChallengeTemplateId:
            input.recommendation.recommendedChallengeTemplateId,
          recommendedSubskill: input.recommendation.recommendedSubskill,
          recommendedActionMode:
            input.recommendation.recommendedActionMode,
          episodeRole: input.recommendation.episodeRole,
          evidenceIds: input.recommendation.evidenceIds,
          confidence: input.recommendation.confidence,
        },
        eligibleChallenges,
        fallbackChallengeTemplateId: null,
        maxEstimatedSeconds: Math.max(
          ...eligibleChallenges.map((challenge) => challenge.estimatedSeconds),
        ),
      },
      { signal: context.signal },
    );
    const output = assertLiveCodexResult("decide_next", result);
    assertExactBinding(output, input, selected);

    return {
      decision: output.decision,
      recommendationId: output.recommendationId,
      chosenChallengeTemplateId: output.chosenChallengeTemplateId,
      renderContractId: output.renderContractId,
      componentName: output.componentName,
      componentSchemaVersion: output.componentSchemaVersion,
      reasonCode: output.reasonCode,
      rationale: output.rationale,
      citedEvidenceIds: output.citedEvidenceIds,
      executionProvenance: "live",
    };
  }
}

function authoringIntent(
  templateId: GymTemplateId,
  text: string,
) {
  return {
    textClass: "authoring_intent" as const,
    text,
    authorityKind: "challenge_template" as const,
    authorityId: templateId,
  };
}

function toPioneerChallenge(
  templateId: GymTemplateId,
): EligibleChallengeMetadata {
  const fixture = getGymFixture(templateId);
  const policy = challengePolicy(templateId);
  if (
    fixture.episodeRole !== "retry" &&
    fixture.episodeRole !== "held_out_transfer" &&
    fixture.episodeRole !== "diagnostic_probe"
  ) {
    throw new Error(`Template ${templateId} has an invalid P2 episode role`);
  }
  return {
    challengeTemplateId: fixture.challengeTemplateId,
    subskill: fixture.subskill,
    allowedEpisodeRoles: [fixture.episodeRole],
    actionMode: fixture.actionMode,
    difficulty: policy.difficulty,
    preserve: policy.preserve.map((text) => authoringIntent(templateId, text)),
    vary: policy.vary.map((text) => authoringIntent(templateId, text)),
    removeShortcuts: policy.removeShortcuts.map((text) =>
      authoringIntent(templateId, text),
    ),
    assetManifestId: `asset_manifest_${templateId}`,
    estimatedSeconds: fixture.estimatedSeconds,
    prevalidatedSpec: {
      fixtureId: fixture.fixtureReceiptId,
      validationScope: "reusable_fixture",
      goalDefinitionId: GOAL_DEFINITION_ID,
      exerciseId: fixture.exerciseId,
      revision: 1,
      validationId: `prevalidated_${templateId}`,
      contentHash: fixture.fixtureContentHash,
      responseSchemaSha256: fixture.responseContract.schemaSha256,
    },
  };
}

function phaseForEvidence(
  fixture: GymFixtureTemplate,
): "diagnosed" | "practicing" | "transfer_pending" {
  if (fixture.episodeRole === "baseline") return "diagnosed";
  if (fixture.episodeRole === "retry") return "practicing";
  return "transfer_pending";
}

function uncertaintyForEvidence(
  input: ChooseNextInput,
): "high" | "medium" | "low" {
  const focalCriterion = input.latestEvidence.criterionOutcomes.find(
    (criterion) => criterion.criterionId === "focal-order",
  );
  return focalCriterion?.outcome === "met" ? "low" : "high";
}

function toRecommendNextInput(
  input: ChooseNextInput,
  requestId: string,
  now: Date,
): RecommendNextInput {
  if (input.goalDefinitionId !== GOAL_DEFINITION_ID) {
    throw new Error("P2 goal is outside the supported live goal definition");
  }
  if (!isGymTemplateId(input.latestEvidence.challengeTemplateId)) {
    throw new Error("Latest evidence is outside the registered fixture inventory");
  }
  const evidenceFixture = getGymFixture(
    input.latestEvidence.challengeTemplateId,
  );
  if (
    input.latestEvidence.exerciseId !== evidenceFixture.exerciseId ||
    input.latestEvidence.episodeRole !== evidenceFixture.episodeRole
  ) {
    throw new Error("Latest evidence is not bound to its registered fixture");
  }
  const eligibleChallenges = input.eligibleChallengeTemplateIds.map(
    (templateId) => {
      if (!isGymTemplateId(templateId)) {
        throw new Error(`Unknown eligible challenge ${templateId}`);
      }
      return toPioneerChallenge(templateId);
    },
  );
  const criterionTexts = input.latestEvidence.criterionOutcomes.map(
    (criterion) => ({
      textClass: "assessor_outcome" as const,
      text: `Criterion ${criterion.criterionId} was assessed as ${criterion.outcome}.`,
      criterionId: criterion.criterionId,
      outcome: criterion.outcome,
      evidenceRefs: [input.latestEvidence.evidenceId],
    }),
  );
  const createdAt = now.toISOString();

  return {
    requestId,
    sessionId: input.sessionId,
    goal: {
      goalInstanceId: input.goalInstanceId,
      goalDefinitionId: input.goalDefinitionId,
      supportStatus: "mapped_with_explanation",
      sessionTimeboxSeconds: SESSION_TIMEBOX_SECONDS,
      texts: [
        {
          textClass: "authoring_intent",
          text: "Maximize expected transferable learning gain per minute for intentional visual hierarchy.",
          authorityKind: "goal_definition",
          authorityId: input.goalDefinitionId,
        },
      ],
    },
    learnerState: {
      snapshotId: `snapshot_${requestId}`,
      sessionId: input.sessionId,
      goalInstanceId: input.goalInstanceId,
      subskills: [
        {
          subskill: input.currentSubskill,
          phase: phaseForEvidence(evidenceFixture),
          uncertainty: uncertaintyForEvidence(input),
          supportingEvidenceIds:
            uncertaintyForEvidence(input) === "low"
              ? [input.latestEvidence.evidenceId]
              : [],
          counterEvidenceIds:
            uncertaintyForEvidence(input) === "high"
              ? [input.latestEvidence.evidenceId]
              : [],
        },
      ],
      derivedBy: "codex",
      stateRuleVersion: LEARNER_STATE_RULE_VERSION,
      createdAt,
    },
    latestEvidence: [
      {
        evidenceId: input.latestEvidence.evidenceId,
        exerciseId: input.latestEvidence.exerciseId,
        exerciseRevision: 1,
        validationId: `prevalidated_${evidenceFixture.challengeTemplateId}`,
        gymSpecHash: evidenceFixture.fixtureContentHash,
        episodeRole: input.latestEvidence.episodeRole,
        actionValue: input.latestEvidence.actionValue,
        statedConfidence: input.latestEvidence.statedConfidence,
        assessmentStatus: "scored",
        texts: criterionTexts,
      },
    ],
    validatedExerciseMetadata: [
      {
        exerciseId: evidenceFixture.exerciseId,
        revision: 1,
        validationId: `prevalidated_${evidenceFixture.challengeTemplateId}`,
        subskill: evidenceFixture.subskill,
        episodeRole: evidenceFixture.episodeRole,
      },
    ],
    eligibleChallenges,
    maxEstimatedSeconds: input.maxEstimatedSeconds,
    policyPromptVersion: P2_POLICY_VERSION,
  };
}

function abortAwareFetch(
  fetchImpl: typeof fetch,
  context: ProviderCallContext,
): typeof fetch {
  return (resource, init) => {
    const signals = [
      context.signal,
      AbortSignal.timeout(Math.max(1, Math.floor(context.deadlineMs))),
    ];
    if (init?.signal) signals.push(init.signal);
    return fetchImpl(resource, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}

export class LiveGymPioneerClient implements GymPioneerClient {
  readonly mode = "live" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly makeId: (prefix: string) => string;
  private readonly gatewayFactory: typeof createPioneerTextGateway;

  constructor(options: LiveGymPioneerClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.makeId =
      options.makeId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.gatewayFactory = options.gatewayFactory ?? createPioneerTextGateway;
  }

  isReady() {
    return Boolean(
      this.apiKey && this.model && typeof this.fetchImpl === "function",
    );
  }

  async validateTeachingSignal(
    input: ValidateTeachingSignalInput,
    context: ProviderCallContext,
  ): Promise<PioneerTeachingSignalValidation> {
    if (context.signal.aborted) throw context.signal.reason;
    if (!isGymTemplateId(input.challengeTemplateId)) {
      throw new Error("P1 fixture is outside the immutable inventory");
    }
    const fixture = getGymFixture(input.challengeTemplateId);
    if (
      input.goalDefinitionId !== GOAL_DEFINITION_ID ||
      input.exerciseId !== fixture.exerciseId ||
      input.fixtureReceiptId !== fixture.fixtureReceiptId ||
      input.fixtureContentHash !== fixture.fixtureContentHash ||
      input.intendedTeachingSignal !== fixture.subskill
    ) {
      throw new Error("P1 fixture receipt does not match the immutable fixture");
    }
    return {
      validationId: `prevalidated_${fixture.challengeTemplateId}`,
      judgment: "PASS",
      confidence: "high",
      reasonCodes: ["prevalidated_fixture_exact_hash"],
      provenance: "prevalidated",
      summary:
        "This immutable demo fixture was prevalidated. No live P1 judgment is being claimed.",
    };
  }

  async chooseNext(
    input: ChooseNextInput,
    context: ProviderCallContext,
  ): Promise<PioneerCurriculumChoice> {
    if (!this.isReady()) {
      throw new Error("Live Pioneer P2 is not configured");
    }
    if (context.signal.aborted) throw context.signal.reason;
    const request = toRecommendNextInput(
      input,
      this.makeId("p2_request"),
      this.now(),
    );
    const gateway: PioneerTextGateway = this.gatewayFactory({
      apiKey: this.apiKey,
      model: this.model,
      workflowMode: "live",
      fetchImpl: abortAwareFetch(this.fetchImpl, context),
      // P2 currently projects only Codex-derived assessment outcomes and pinned
      // authoring intent. Any accidental fal-grounded field must fail closed
      // until a receipt resolver is explicitly wired.
      resolveFalText: () => {
        throw new Error("Unexpected fal source lookup in live P2 projection");
      },
      now: this.now,
    });
    const result = await gateway.recommendNext(request);
    if (context.signal.aborted) throw context.signal.reason;
    if (result.kind !== "live") {
      throw new Error(
        `Pioneer did not return a live P2 recommendation: ${result.fallback.reason}`,
      );
    }
    const response = NextChallengeRecommendationSchema.parse(result.response);
    if (
      !input.eligibleChallengeTemplateIds.includes(
        response.recommendedChallengeTemplateId,
      ) ||
      !exactStringArray(response.evidenceIds, [input.latestEvidence.evidenceId])
    ) {
      throw new Error(
        "Pioneer recommendation is outside the exact curriculum and evidence bound",
      );
    }
    return {
      recommendationId: response.recommendationId,
      recommendedSubskill: response.recommendedSubskill,
      recommendedActionMode: response.recommendedActionMode,
      recommendedChallengeTemplateId:
        response.recommendedChallengeTemplateId,
      episodeRole: response.episodeRole,
      rationale: response.rationale,
      evidenceIds: response.evidenceIds,
      confidence: response.confidence,
      provenance: "live",
    };
  }
}
