import type { ActionMode, EpisodeRole } from "../codex/types";
import {
  GYM_CONTENT_HASH_VERSION,
  getGymComponentDefinition,
} from "../contracts/gym-components";
import { canonicalSha256 } from "../pioneer/canonical";
import {
  compareArenaPropsSchema,
  buildGymSpecProjection,
  creditAssignmentReplayPropsSchema,
  layerOrderTransferGymPropsSchema,
  safeExerciseFallbackPropsSchema,
  targetedRetryGymPropsSchema,
  type Confidence,
  type CreditAssignmentReplayProps,
  type GymComponentName,
  type ResponseContractRef,
  type StimulusVariant,
} from "../tambo/gym-contract";

import type {
  CurriculumEvidence,
  PioneerTeachingSignalValidation,
} from "./providers";

export type GymTemplateId =
  | "baseline_hierarchy_v1"
  | "retry_focal_order_v1"
  | "transfer_layer_order_v1"
  | "safe_fallback_v1";

export interface GymFixtureTemplate {
  challengeTemplateId: GymTemplateId;
  exerciseId: string;
  episodeRole: EpisodeRole;
  actionMode: ActionMode;
  subskill: string;
  componentName: Exclude<
    GymComponentName,
    "LearningPrompt" | "CreditAssignmentReplay"
  >;
  fixtureReceiptId: string;
  fixtureContentHash: string;
  responseContract: ResponseContractRef;
  estimatedSeconds: number;
}

export type GymFixtureDefinition = Omit<
  GymFixtureTemplate,
  "fixtureContentHash"
>;

export function gymDigest(value: unknown): string {
  return canonicalSha256(value);
}

const choiceResponseContract: ResponseContractRef = {
  schemaId: "visual-hierarchy-choice",
  schemaVersion: "1.0.0",
  schemaSha256: gymDigest({
    type: "object",
    required: ["choiceId"],
    properties: { choiceId: { type: "string" } },
  }),
};

const orderResponseContract: ResponseContractRef = {
  schemaId: "visual-hierarchy-layer-order",
  schemaVersion: "1.0.0",
  schemaSha256: gymDigest({
    type: "object",
    required: ["layerOrder"],
    properties: { layerOrder: { type: "array", minItems: 5, maxItems: 5 } },
  }),
};

const baselineVariants: [StimulusVariant, StimulusVariant] = [
  {
    id: "frame-a",
    label: "Frame A",
    kicker: "NEW RELEASE",
    headline: "Meet the camera that keeps up",
    supportingCopy: "Pocket-sized 4K. Built for motion.",
    cta: "Explore Pocket 4K",
    composition: "competing",
    accent: "coral",
  },
  {
    id: "frame-b",
    label: "Frame B",
    kicker: "NEW RELEASE",
    headline: "Meet the camera that keeps up",
    supportingCopy: "Pocket-sized 4K. Built for motion.",
    cta: "Explore Pocket 4K",
    composition: "clear",
    accent: "lime",
  },
];

const retryVariants: [StimulusVariant, StimulusVariant] = [
  {
    id: "retry-a",
    label: "Frame A",
    kicker: "48 HOUR DROP",
    headline: "One bag. Every weather.",
    supportingCopy: "Sealed seams · 22L · carry-on ready",
    cta: "Shop the drop",
    composition: "balanced",
    accent: "blue",
  },
  {
    id: "retry-b",
    label: "Frame B",
    kicker: "48 HOUR DROP",
    headline: "One bag. Every weather.",
    supportingCopy: "Sealed seams · 22L · carry-on ready",
    cta: "Shop the drop",
    composition: "stacked",
    accent: "violet",
  },
];

/**
 * The stable render contract identifier committed by both the P1 candidate
 * and the Codex UI command.
 */
export function gymFixtureRenderContractId(
  fixtureTemplate: GymFixtureDefinition,
): string {
  return `render_${fixtureTemplate.challengeTemplateId}_v1`;
}

/**
 * Exact learner-facing action props, deliberately excluding the P1 receipt.
 * The receipt contains the candidate hash, so including it here would create
 * a self-referential hash.
 */
export function immutableActionProps(
  fixtureTemplate: GymFixtureDefinition,
): Record<string, unknown> {
  if (fixtureTemplate.challengeTemplateId === "baseline_hierarchy_v1") {
    return {
      phaseLabel: "REP 01 · DIAGNOSTIC",
      title: "Which frame makes the product decision feel intentional?",
      instruction:
        "Choose one frame, name what your eye notices first, then report your confidence.",
      brief:
        "A viewer should understand the promise in one beat and still find the action without competing focal points.",
      responseContract: fixtureTemplate.responseContract,
      variants: baselineVariants,
      reasoningPrompt: "What created or weakened the focal order?",
      reasoningTags: [
        { id: "focal-order", label: "Clear focal order" },
        { id: "competing-type", label: "Type competes" },
        { id: "cta-path", label: "CTA follows promise" },
        { id: "surface-polish", label: "Surface polish" },
      ],
      timeLimitSeconds: fixtureTemplate.estimatedSeconds,
      submitLabel: "Commit response",
    };
  }

  if (fixtureTemplate.challengeTemplateId === "retry_focal_order_v1") {
    return {
      phaseLabel: "REP 02 · TARGETED RETRY",
      title: "Force one focal decision",
      instruction:
        "Choose the version with the clearest promise → proof → action path. Explain the tradeoff you accepted.",
      brief:
        "The product and copy are held constant. Only the information order changes.",
      responseContract: fixtureTemplate.responseContract,
      targetConstraint: "Make the promise unmistakable before proof or action.",
      whyThisRep:
        "Pioneer selected a same-subskill rep to maximize expected learning gain from the latest evidence.",
      evidenceIds: ["latest_curriculum_evidence"],
      variants: retryVariants,
      reasoningPrompt: "What did you deliberately make secondary?",
      reasoningTags: [
        { id: "promise-first", label: "Promise first" },
        { id: "proof-second", label: "Proof second" },
        { id: "action-last", label: "Action last" },
        { id: "accepted-tradeoff", label: "Accepted a tradeoff" },
      ],
      submitLabel: "Test this decision",
    };
  }

  if (fixtureTemplate.challengeTemplateId === "transfer_layer_order_v1") {
    return {
      phaseLabel: "REP 03 · HELD-OUT TRANSFER",
      title: "Build the reading order in a new format",
      instruction:
        "Order the layers from first attention to final action. Both context and action have changed.",
      brief:
        "A vertical field-test story must land the emotional promise, support it with proof, and close with a clear action.",
      responseContract: fixtureTemplate.responseContract,
      transferLabel: "Changed context · changed action · disjoint stimulus",
      changedContext: "Side-by-side product frame → vertical outdoor story",
      changedAction: "Choose a composition → construct its layer order",
      layers: [
        {
          id: "promise",
          label: "Emotional promise",
          role: "focal",
          copy: "Rain never gets the last word",
        },
        {
          id: "context",
          label: "Field context",
          role: "context",
          copy: "Storm trail · frame 03",
        },
        {
          id: "proof",
          label: "Product proof",
          role: "proof",
          copy: "Dry storage · fast access",
        },
        {
          id: "support",
          label: "Supporting detail",
          role: "support",
          copy: "22L · sealed seams",
        },
        {
          id: "action",
          label: "Action",
          role: "action",
          copy: "See it in the field",
        },
      ],
      targetBrief:
        "Put the promise first, proof before specifications, and action after the idea is earned.",
      submitLabel: "Submit held-out transfer",
    };
  }

  return {
    phaseLabel: "SAFE FALLBACK",
    title: "The dynamic rep could not be rendered safely",
    instruction: "Complete this fixed choice so the session remains observable.",
    brief: "Select the statement that best describes intentional hierarchy.",
    responseContract: fixtureTemplate.responseContract,
    disclosure:
      "This separately prevalidated fixture does not reuse a failed rep or its validation.",
    prompt: "Which description creates the clearest reading path?",
    options: [
      {
        id: "frame-a",
        label: "Everything is equally loud",
        description: "Headline, proof, and action compete for the first beat.",
      },
      {
        id: "frame-b",
        label: "Promise, then proof, then action",
        description: "Each layer earns the next one.",
      },
    ],
    submitLabel: "Submit accessible response",
  };
}

/** The exact canonical P1 candidate projection committed by gym-jcs-v1. */
export function gymFixtureCandidateProjection(
  fixtureTemplate: GymFixtureDefinition,
  pedagogicalProps: Record<string, unknown> =
    immutableActionProps(fixtureTemplate),
): Record<string, unknown> {
  const renderContractId = gymFixtureRenderContractId(fixtureTemplate);
  return buildGymSpecProjection({
    exerciseId: fixtureTemplate.exerciseId,
    revision: 1,
    challengeTemplateId: fixtureTemplate.challengeTemplateId,
    episodeRole: fixtureTemplate.episodeRole,
    actionMode: fixtureTemplate.actionMode,
    subskill: fixtureTemplate.subskill,
    responseContract: fixtureTemplate.responseContract,
    estimatedSeconds: fixtureTemplate.estimatedSeconds,
    fixtureImportReceiptId: fixtureTemplate.fixtureReceiptId,
    renderContract: {
      renderContractId,
      phase: "action",
      componentName: fixtureTemplate.componentName,
      componentSchemaVersion: getGymComponentDefinition(
        fixtureTemplate.componentName,
      ).schemaVersion,
      pedagogicalProps,
      pedagogicalPropsSha256: gymDigest(pedagogicalProps),
    },
  });
}

export function gymFixtureCandidateHash(
  fixtureTemplate: GymFixtureDefinition,
  pedagogicalProps?: Record<string, unknown>,
): string {
  return gymDigest(
    gymFixtureCandidateProjection(fixtureTemplate, pedagogicalProps),
  );
}

function fixture(
  value: GymFixtureDefinition,
): GymFixtureTemplate {
  return {
    ...value,
    fixtureContentHash: gymFixtureCandidateHash(value),
  };
}

const inventory: Record<GymTemplateId, GymFixtureTemplate> = {
  baseline_hierarchy_v1: fixture({
    challengeTemplateId: "baseline_hierarchy_v1",
    exerciseId: "exercise_baseline_hierarchy_v1",
    episodeRole: "baseline",
    actionMode: "choose",
    subskill: "focal ordering",
    componentName: "CompareArena",
    fixtureReceiptId: "fixture_receipt_baseline_hierarchy_v1",
    responseContract: choiceResponseContract,
    estimatedSeconds: 28,
  }),
  retry_focal_order_v1: fixture({
    challengeTemplateId: "retry_focal_order_v1",
    exerciseId: "exercise_retry_focal_order_v1",
    episodeRole: "retry",
    actionMode: "choose",
    subskill: "focal ordering",
    componentName: "TargetedRetryGym",
    fixtureReceiptId: "fixture_receipt_retry_focal_order_v1",
    responseContract: choiceResponseContract,
    estimatedSeconds: 24,
  }),
  transfer_layer_order_v1: fixture({
    challengeTemplateId: "transfer_layer_order_v1",
    exerciseId: "exercise_transfer_layer_order_v1",
    episodeRole: "held_out_transfer",
    actionMode: "layer_order",
    subskill: "focal ordering",
    componentName: "LayerOrderTransferGym",
    fixtureReceiptId: "fixture_receipt_transfer_layer_order_v1",
    responseContract: orderResponseContract,
    estimatedSeconds: 30,
  }),
  safe_fallback_v1: fixture({
    challengeTemplateId: "safe_fallback_v1",
    exerciseId: "exercise_safe_fallback_v1",
    episodeRole: "diagnostic_probe",
    actionMode: "choose",
    subskill: "focal ordering",
    componentName: "SafeExerciseFallback",
    fixtureReceiptId: "fixture_receipt_safe_fallback_v1",
    responseContract: choiceResponseContract,
    estimatedSeconds: 20,
  }),
};

export function getGymFixture(templateId: GymTemplateId): GymFixtureTemplate {
  return inventory[templateId];
}

export function isGymTemplateId(value: string): value is GymTemplateId {
  return Object.prototype.hasOwnProperty.call(inventory, value);
}

function validationReceipt(
  fixtureTemplate: GymFixtureTemplate,
  validation?: PioneerTeachingSignalValidation,
) {
  return {
    validationId:
      validation?.validationId ?? `prevalidated_${fixtureTemplate.challengeTemplateId}`,
    judgment: "PASS" as const,
    exerciseId: fixtureTemplate.exerciseId,
    exerciseRevision: 1,
    provenance: validation?.provenance ?? ("prevalidated" as const),
    contentHash: fixtureTemplate.fixtureContentHash,
    contentHashVersion: GYM_CONTENT_HASH_VERSION,
    sourceLabel:
      validation?.provenance === "live"
        ? "LIVE PIONEER · FAL TEXT RECEIPT VERIFIED"
        : "PREVALIDATED DEMO FIXTURE",
    detail:
      validation?.summary ??
      "This exact fixture is pinned. The runtime is not claiming a live provider judgment.",
  };
}

export function actionProps(
  fixtureTemplate: GymFixtureTemplate,
  validation?: PioneerTeachingSignalValidation,
): Record<string, unknown> {
  const receipt = validationReceipt(fixtureTemplate, validation);
  const pedagogicalProps = immutableActionProps(fixtureTemplate);

  if (fixtureTemplate.challengeTemplateId === "baseline_hierarchy_v1") {
    return compareArenaPropsSchema.parse({
      ...pedagogicalProps,
      validationReceipt: receipt,
    });
  }

  if (fixtureTemplate.challengeTemplateId === "retry_focal_order_v1") {
    return targetedRetryGymPropsSchema.parse({
      ...pedagogicalProps,
      validationReceipt: receipt,
    });
  }

  if (fixtureTemplate.challengeTemplateId === "transfer_layer_order_v1") {
    return layerOrderTransferGymPropsSchema.parse({
      ...pedagogicalProps,
      validationReceipt: receipt,
    });
  }

  return safeExerciseFallbackPropsSchema.parse({
    ...pedagogicalProps,
    validationReceipt: receipt,
  });
}

function readChoice(actionValue: unknown): string | null {
  if (!actionValue || typeof actionValue !== "object") return null;
  const choice = (actionValue as { choiceId?: unknown }).choiceId;
  return typeof choice === "string" ? choice : null;
}

function readOrder(actionValue: unknown): string[] {
  if (!actionValue || typeof actionValue !== "object") return [];
  const order = (actionValue as { layerOrder?: unknown }).layerOrder;
  return Array.isArray(order) && order.every((item) => typeof item === "string")
    ? order
    : [];
}

export function assessFixtureResponse(input: {
  fixture: GymFixtureTemplate;
  evidenceId: string;
  actionValue: unknown;
  statedConfidence: Confidence;
}): CurriculumEvidence {
  let focalOrderMet = false;
  if (input.fixture.challengeTemplateId === "baseline_hierarchy_v1") {
    focalOrderMet = readChoice(input.actionValue) === "frame-b";
  } else if (input.fixture.challengeTemplateId === "retry_focal_order_v1") {
    focalOrderMet = readChoice(input.actionValue) === "retry-b";
  } else if (input.fixture.challengeTemplateId === "transfer_layer_order_v1") {
    const order = readOrder(input.actionValue);
    focalOrderMet =
      order.indexOf("promise") >= 0 &&
      order.indexOf("proof") > order.indexOf("promise") &&
      order.indexOf("action") > order.indexOf("proof");
  } else {
    focalOrderMet = readChoice(input.actionValue) === "frame-b";
  }

  return {
    evidenceId: input.evidenceId,
    exerciseId: input.fixture.exerciseId,
    challengeTemplateId: input.fixture.challengeTemplateId,
    episodeRole: input.fixture.episodeRole,
    actionValue: input.actionValue,
    criterionOutcomes: [
      {
        criterionId: "focal-order",
        outcome: focalOrderMet ? "met" : "not_met",
      },
    ],
    statedConfidence: input.statedConfidence,
    assessmentProvenance: "deterministic_rubric_policy",
  };
}

export function feedbackProps(input: {
  fixture: GymFixtureTemplate;
  evidence: CurriculumEvidence;
  selectedLabel?: string;
}): CreditAssignmentReplayProps {
  const met = input.evidence.criterionOutcomes[0]?.outcome === "met";
  const transfer = input.fixture.episodeRole === "held_out_transfer";
  const selected =
    input.fixture.challengeTemplateId === "retry_focal_order_v1"
      ? retryVariants.find((variant) => variant.id === readChoice(input.evidence.actionValue)) ?? retryVariants[0]
      : baselineVariants.find((variant) => variant.id === readChoice(input.evidence.actionValue)) ?? baselineVariants[0];

  const artifact: StimulusVariant = transfer
    ? {
        id: "transfer-artifact",
        label: "9:16 product story",
        kicker: "FIELD TEST 03",
        headline: "Rain never gets the last word",
        supportingCopy: "Dry storage. Fast access. One-handed carry.",
        cta: "See it in the field",
        composition: "clear",
        accent: "lime",
      }
    : selected;

  return creditAssignmentReplayPropsSchema.parse({
    phaseLabel: transfer ? "TRANSFER · EVIDENCE RECEIPT" : "CREDIT ASSIGNMENT",
    title: transfer
      ? met
        ? "The decision transferred to a changed action"
        : "The changed action exposed the remaining edge"
      : met
        ? "You found the focal path"
        : "Competing first beats hid the promise",
    summary: transfer
      ? met
        ? "You preserved promise → proof → action while both context and action changed. This is transfer evidence, not a guarantee of learning."
        : "This held-out response did not yet preserve the target order. The receipt records evidence without claiming learning."
      : met
        ? "Your response put the promise first and kept proof and action subordinate. Pioneer can now spend the next rep on the highest-value uncertainty."
        : "Your response favored a competing cue before the promise landed. Pioneer can use that precise edge to choose the next rep.",
    selectedLabel: input.selectedLabel ?? artifact.label,
    artifact,
    anchors: [
      { id: "promise", label: "Promise", note: "The intended first beat.", x: 38, y: 28, tone: met ? "signal" : "confound" },
      { id: "proof", label: "Proof", note: "Supports the promise without stealing it.", x: 62, y: 56, tone: "neutral" },
      { id: "action", label: "Action", note: "Closes the reading path.", x: 48, y: 82, tone: met ? "signal" : "neutral" },
    ],
    criteria: [
      {
        criterionId: "focal-order",
        label: "Focal order",
        outcome: met ? "met" : "not_met",
        observation: met
          ? "The bounded response preserves promise before proof and action."
          : "The bounded response does not preserve the target focal order.",
      },
    ],
    evidenceId: input.evidence.evidenceId,
    confidenceCalibration: met
      ? input.evidence.statedConfidence === "low"
        ? "under"
        : "aligned"
      : input.evidence.statedConfidence === "high"
        ? "over"
        : "aligned",
    nextLabel: transfer ? "Start another session" : "Find my next edge",
  });
}
