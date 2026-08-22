import type {
  DecideNextOutput,
  InterpretGoalOutput,
} from "../codex/types";
import type {
  NextChallengeRecommendation,
  ValidateExerciseResponse,
} from "../pioneer/schemas";
import { getGymComponentDefinition } from "../contracts/gym-components";

export type GymProviderMode = "live" | "deterministic_skill_policy";

export interface ProviderCallContext {
  signal: AbortSignal;
  deadlineMs: number;
}

export interface InterpretGoalInput {
  sessionId: string;
  goalInstanceId: string;
  rawPrompt: string;
  sessionTimeboxSeconds: number;
}

export interface BindPioneerChoiceInput {
  sessionId: string;
  goalInstanceId: string;
  currentSubskill: string;
  currentPhase: "diagnosed" | "practicing" | "transfer_pending";
  recommendation: PioneerCurriculumChoice;
  eligibleChallengeTemplateIds: string[];
  latestEvidenceIds: string[];
}

export interface GymCodexClient {
  readonly mode: GymProviderMode;
  isReady(): boolean;
  interpretGoal(
    input: InterpretGoalInput,
    context: ProviderCallContext,
  ): Promise<InterpretGoalOutput>;
  /**
   * Codex binds and executes the curriculum choice. It does not choose a
   * different challenge. The engine rejects any output that attempts to do so.
   */
  bindPioneerChoice(
    input: BindPioneerChoiceInput,
    context: ProviderCallContext,
  ): Promise<CodexBoundCurriculumChoice>;
}

export type CodexBoundCurriculumChoice = Pick<
  DecideNextOutput,
  | "decision"
  | "recommendationId"
  | "chosenChallengeTemplateId"
  | "renderContractId"
  | "componentName"
  | "componentSchemaVersion"
  | "reasonCode"
  | "rationale"
  | "citedEvidenceIds"
> & {
  executionProvenance: GymProviderMode;
};

export type PioneerTeachingSignalValidation = Pick<
  ValidateExerciseResponse,
  "validationId" | "judgment" | "confidence" | "reasonCodes"
> & {
  provenance: "live" | "prevalidated";
  summary: string;
};

export interface ValidateTeachingSignalInput {
  sessionId: string;
  goalInstanceId: string;
  goalDefinitionId: string;
  challengeTemplateId: string;
  exerciseId: string;
  intendedTeachingSignal: string;
  fixtureReceiptId: string;
  fixtureContentHash: string;
}

export type PioneerCurriculumChoice = Pick<
  NextChallengeRecommendation,
  | "recommendationId"
  | "recommendedSubskill"
  | "recommendedActionMode"
  | "recommendedChallengeTemplateId"
  | "episodeRole"
  | "rationale"
  | "evidenceIds"
  | "confidence"
> & {
  provenance: "live" | "deterministic_skill_policy";
};

export interface CurriculumEvidence {
  evidenceId: string;
  exerciseId: string;
  challengeTemplateId: string;
  episodeRole: "baseline" | "diagnostic_probe" | "retry" | "held_out_transfer";
  actionValue: unknown;
  criterionOutcomes: Array<{
    criterionId: string;
    outcome: "met" | "partial" | "not_met";
  }>;
  statedConfidence: "low" | "medium" | "high";
  assessmentProvenance: "deterministic_rubric_policy";
}

export interface ChooseNextInput {
  sessionId: string;
  goalInstanceId: string;
  goalDefinitionId: string;
  currentSubskill: string;
  latestEvidence: CurriculumEvidence;
  eligibleChallengeTemplateIds: string[];
  maxEstimatedSeconds: number;
}

export interface GymPioneerClient {
  readonly mode: GymProviderMode;
  isReady(): boolean;
  validateTeachingSignal(
    input: ValidateTeachingSignalInput,
    context: ProviderCallContext,
  ): Promise<PioneerTeachingSignalValidation>;
  /** Pioneer owns this choice. Codex receives the selected ID after this call. */
  chooseNext(
    input: ChooseNextInput,
    context: ProviderCallContext,
  ): Promise<PioneerCurriculumChoice>;
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}

export class DeterministicSkillCodexClient implements GymCodexClient {
  readonly mode = "deterministic_skill_policy" as const;

  isReady() {
    return true;
  }

  async interpretGoal(
    input: InterpretGoalInput,
    context: ProviderCallContext,
  ): Promise<InterpretGoalOutput> {
    assertNotAborted(context.signal);
    return {
      goalInstanceId: input.goalInstanceId,
      goalDefinitionId: "visual-hierarchy.short-form-v1",
      rawPrompt: input.rawPrompt,
      domain: "short-form product video",
      targetCapability: "intentional visual hierarchy",
      intendedUse: "make fast product-video composition decisions",
      currentLevel: "unknown",
      sessionTimeboxSeconds: input.sessionTimeboxSeconds,
      constraints: ["90-second session", "bounded observable responses"],
      supportStatus: "mapped_with_explanation",
      interpretationShownToHuman:
        "This session maps your goal to intentional visual hierarchy in short-form product video.",
      clarificationQuestion: null,
    };
  }

  async bindPioneerChoice(
    input: BindPioneerChoiceInput,
    context: ProviderCallContext,
  ): Promise<CodexBoundCurriculumChoice> {
    assertNotAborted(context.signal);
    const selected = input.recommendation.recommendedChallengeTemplateId;
    const componentName =
      selected === "transfer_layer_order_v1"
        ? "LayerOrderTransferGym"
        : "TargetedRetryGym";
    return {
      decision: "accept",
      recommendationId: input.recommendation.recommendationId,
      chosenChallengeTemplateId: selected,
      renderContractId: `render_${selected}_v1`,
      componentName,
      componentSchemaVersion:
        getGymComponentDefinition(componentName).schemaVersion,
      reasonCode: "pioneer_choice_bound",
      rationale:
        "Codex bound the exact Pioneer curriculum choice to a registered renderer contract.",
      citedEvidenceIds: input.latestEvidenceIds,
      executionProvenance: "deterministic_skill_policy",
    };
  }
}

export class DeterministicSkillPioneerClient implements GymPioneerClient {
  readonly mode = "deterministic_skill_policy" as const;

  isReady() {
    return true;
  }

  async validateTeachingSignal(
    input: ValidateTeachingSignalInput,
    context: ProviderCallContext,
  ): Promise<PioneerTeachingSignalValidation> {
    assertNotAborted(context.signal);
    return {
      validationId: `prevalidated_${input.challengeTemplateId}`,
      judgment: "PASS",
      confidence: "high",
      reasonCodes: ["prevalidated_fixture_exact_hash"],
      provenance: "prevalidated",
      summary:
        "A pinned fixture receipt certifies one visual-hierarchy teaching signal. No live Pioneer claim is being made.",
    };
  }

  async chooseNext(
    input: ChooseNextInput,
    context: ProviderCallContext,
  ): Promise<PioneerCurriculumChoice> {
    assertNotAborted(context.signal);
    const mastered = input.latestEvidence.criterionOutcomes.some(
      (criterion) =>
        criterion.criterionId === "focal-order" && criterion.outcome === "met",
    );
    const wantsTransfer =
      mastered &&
      input.eligibleChallengeTemplateIds.includes("transfer_layer_order_v1");
    const selected = wantsTransfer
      ? "transfer_layer_order_v1"
      : input.eligibleChallengeTemplateIds.includes("retry_focal_order_v1")
        ? "retry_focal_order_v1"
        : input.eligibleChallengeTemplateIds[0];

    if (!selected) throw new Error("Pioneer received no eligible curriculum choices");

    return {
      recommendationId: `recommendation_${input.latestEvidence.evidenceId}`,
      recommendedSubskill: "focal ordering",
      recommendedActionMode:
        selected === "transfer_layer_order_v1" ? "layer_order" : "choose",
      recommendedChallengeTemplateId: selected,
      episodeRole:
        selected === "transfer_layer_order_v1" ? "held_out_transfer" : "retry",
      rationale: wantsTransfer
        ? "The learner showed the focal-order criterion, so a changed-context action has the highest expected learning gain."
        : "The evidence still has a focal-order edge, so a targeted same-subskill retry has the highest expected learning gain.",
      evidenceIds: [input.latestEvidence.evidenceId],
      confidence: "medium",
      provenance: "deterministic_skill_policy",
    };
  }
}
