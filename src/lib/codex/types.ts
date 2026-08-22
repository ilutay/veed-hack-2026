import {
  GYM_COMPONENT_NAMES,
  type GymComponentName,
} from "../contracts/gym-components";

export { GYM_COMPONENT_NAMES };
export type { GymComponentName };

export const CODEX_ACTIONS = [
  "interpret_goal",
  "author_rep",
  "assess_response",
  "decide_next",
] as const;

export type CodexAction = (typeof CODEX_ACTIONS)[number];

export const CODEX_ORCHESTRATOR_SKILL = {
  name: "pioneer-gym",
  relativePath: "codex/skills/pioneer-gym/SKILL.md",
} as const;

export const CODEX_STAGE_SKILL_BY_ACTION = {
  interpret_goal: {
    name: "pioneer-gym-goal-intake",
    relativePath: "codex/skills/pioneer-gym-goal-intake/SKILL.md",
  },
  author_rep: {
    name: "pioneer-gym-rep-authoring",
    relativePath: "codex/skills/pioneer-gym-rep-authoring/SKILL.md",
  },
  assess_response: {
    name: "pioneer-gym-response-assessment",
    relativePath: "codex/skills/pioneer-gym-response-assessment/SKILL.md",
  },
  decide_next: {
    name: "pioneer-gym-next-decision",
    relativePath: "codex/skills/pioneer-gym-next-decision/SKILL.md",
  },
} as const satisfies Readonly<
  Record<CodexAction, { name: string; relativePath: string }>
>;

export const EPISODE_ROLES = [
  "baseline",
  "diagnostic_probe",
  "retry",
  "held_out_transfer",
] as const;

export type EpisodeRole = (typeof EPISODE_ROLES)[number];

export const ACTION_MODES = [
  "choose",
  "edit",
  "rank",
  "layer_order",
  "explain",
] as const;

export type ActionMode = (typeof ACTION_MODES)[number];

export const LEARNER_PHASES = [
  "unexplored",
  "diagnosed",
  "practicing",
  "transfer_pending",
  "transfer_shown",
] as const;

export type LearnerPhase = (typeof LEARNER_PHASES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SkillReceipt {
  name: string;
  relativePath: string;
  sha256: string;
  utf8ByteLength: number;
}

export interface InterpretGoalRequest {
  action: "interpret_goal";
  sessionId: string;
  goalInstanceId: string;
  rawPrompt: string;
  sessionTimeboxSeconds: number;
}

export interface InterpretGoalOutput {
  goalInstanceId: string;
  goalDefinitionId: string;
  rawPrompt: string;
  domain: string;
  targetCapability: string;
  intendedUse: string;
  currentLevel: "unknown" | "novice" | "practiced" | "advanced";
  sessionTimeboxSeconds: number;
  constraints: string[];
  supportStatus: "supported" | "mapped_with_explanation" | "unsupported";
  interpretationShownToHuman: string;
  clarificationQuestion: string | null;
}

export interface ChallengeTemplateInput {
  challengeTemplateId: string;
  goalDefinitionId: string;
  stimulusReceiptId: string;
  stimulusReceiptSha256: string;
  subskill: string;
  contextId: string;
  episodeRole: EpisodeRole;
  actionMode: ActionMode;
  estimatedSeconds: number;
  learningObjective: string;
  intendedContrast: string;
  invariants: string[];
  learnerPrompt: string;
  renderContractId: string;
  componentName: GymComponentName;
  componentSchemaVersion: string;
  prevalidated: boolean;
}

export interface AuthorRepRequest {
  action: "author_rep";
  sessionId: string;
  goal: InterpretGoalOutput;
  desiredEpisodeRole: EpisodeRole;
  currentSubskill: string | null;
  pioneerRepairHints: string[];
  maxEstimatedSeconds: number;
  eligibleTemplates: ChallengeTemplateInput[];
}

export interface AuthorRepOutput {
  status: "selected" | "blocked";
  goalDefinitionId: string;
  challengeTemplateId: string | null;
  stimulusReceiptId: string | null;
  stimulusReceiptSha256: string | null;
  episodeRole: EpisodeRole | null;
  subskill: string | null;
  contextId: string | null;
  actionMode: ActionMode | null;
  learningObjective: string | null;
  intendedContrast: string | null;
  invariants: string[];
  learnerPrompt: string | null;
  authoringRationale: string;
  repairHintsApplied: string[];
}

export interface RubricCriterionInput {
  criterionId: string;
  description: string;
  acceptableActionIds: string[];
  acceptableReasoningTagIds: string[];
  requiredForTransfer: boolean;
  partialCountsForTransfer: boolean;
}

export interface BoundedActionValue {
  optionId: string | null;
  orderedIds: string[];
  booleanValue: boolean | null;
  numericValue: number | null;
}

export interface AssessResponseRequest {
  action: "assess_response";
  sessionId: string;
  goalInstanceId: string;
  evidenceId: string;
  responseId: string;
  exerciseId: string;
  exerciseRevision: number;
  episodeRole: EpisodeRole;
  validationId: string;
  gymSpecHash: string;
  validatedRepBound: boolean;
  actionValue: BoundedActionValue;
  reasoningText: string | null;
  reasoningTagIds: string[];
  statedConfidence: Confidence;
  reasoningRequired: boolean;
  rubric: RubricCriterionInput[];
}

export type CriterionOutcome = "met" | "partial" | "not_met" | "unscorable";

export interface CriterionEvidenceOutput {
  criterionId: string;
  outcome: CriterionOutcome;
  observationCode:
    | "bounded_evidence_satisfies_criterion"
    | "one_evidence_channel_missing"
    | "bounded_evidence_does_not_satisfy_criterion"
    | "criterion_has_no_deterministic_rule"
    | "validated_rep_binding_missing"
    | "observable_response_missing";
  evidenceRefs: string[];
}

export interface AssessResponseOutput {
  evidenceId: string;
  responseId: string;
  exerciseId: string;
  exerciseRevision: number;
  episodeRole: EpisodeRole;
  validationId: string;
  gymSpecHash: string;
  assessmentStatus: "scored" | "abstained" | "needs_more_evidence";
  criterionEvidence: CriterionEvidenceOutput[];
  confidenceCalibration: "under" | "aligned" | "over" | "unknown";
  assessorVersion: string;
  reasonCodes: string[];
}

export interface PioneerRecommendationInput {
  recommendationId: string;
  recommendedChallengeTemplateId: string;
  recommendedSubskill: string;
  recommendedActionMode: ActionMode;
  episodeRole: Exclude<EpisodeRole, "baseline">;
  evidenceIds: string[];
  confidence: Confidence;
}

export interface DecideNextRequest {
  action: "decide_next";
  sessionId: string;
  goalInstanceId: string;
  currentPhase: LearnerPhase;
  currentSubskill: string;
  latestEvidenceIds: string[];
  pioneerRecommendation: PioneerRecommendationInput | null;
  eligibleChallenges: ChallengeTemplateInput[];
  fallbackChallengeTemplateId: string | null;
  maxEstimatedSeconds: number;
}

export type NextDecision =
  | "accept"
  | "override"
  | "deterministic_fallback"
  | "block";

export interface DecideNextOutput {
  decision: NextDecision;
  recommendationId: string | null;
  chosenChallengeTemplateId: string | null;
  stimulusReceiptId: string | null;
  stimulusReceiptSha256: string | null;
  episodeRole: EpisodeRole | null;
  actionMode: ActionMode | null;
  renderContractId: string | null;
  componentName: GymComponentName | null;
  componentSchemaVersion: string | null;
  reasonCode: string;
  rationale: string;
  citedEvidenceIds: string[];
  provenanceLabel:
    | "live_pioneer"
    | "codex_override"
    | "deterministic_fallback"
    | "blocked";
}

export interface CodexActionRequestMap {
  interpret_goal: InterpretGoalRequest;
  author_rep: AuthorRepRequest;
  assess_response: AssessResponseRequest;
  decide_next: DecideNextRequest;
}

export interface CodexActionOutputMap {
  interpret_goal: InterpretGoalOutput;
  author_rep: AuthorRepOutput;
  assess_response: AssessResponseOutput;
  decide_next: DecideNextOutput;
}

export type AnyCodexActionRequest = CodexActionRequestMap[CodexAction];

export type CodexRunSource =
  | "codex_sdk"
  | "deterministic_skill_policy"
  | "deterministic_fallback";

export type CodexFallbackReason =
  | "offline_requested"
  | "sdk_unavailable"
  | "sdk_turn_failed"
  | "deadline_exceeded"
  | "tool_policy_violation"
  | "invalid_structured_output";

export interface CodexActionRunResult<A extends CodexAction> {
  action: A;
  source: CodexRunSource;
  output: CodexActionOutputMap[A];
  skillReceipts: SkillReceipt[];
  fallbackReason: CodexFallbackReason | null;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  } | null;
}
