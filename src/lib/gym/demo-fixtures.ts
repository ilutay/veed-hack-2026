import "server-only";

import { randomUUID } from "node:crypto";

import {
  GYM_COMPONENT_DEFINITIONS,
  GYM_CONTENT_HASH_VERSION,
  getGymComponentDefinition,
  type GymComponentName,
} from "../contracts/gym-components";
import type {
  CodexUiCommand,
  CompareArenaProps,
  CreditAssignmentReplayProps,
  GymApiResponse,
  JourneyProgress,
  LayerOrderTransferGymProps,
  LearningPromptProps,
  SafeExerciseFallbackProps,
  StimulusVariant,
  TargetedRetryGymProps,
  UiReceipt,
} from "../tambo/gym-contract";
import {
  buildGymSpecProjection,
  validationReceiptSchema,
} from "../tambo/gym-contract";
import { canonicalSha256 } from "../pioneer/canonical";

export function digest(value: unknown) {
  return canonicalSha256(value);
}

export function makeId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

const responseContract = {
  schemaId: "visual-hierarchy-choice",
  schemaVersion: "1.0.0",
  schemaSha256: digest({
    type: "object",
    required: ["choiceId"],
    properties: { choiceId: { enum: ["frame-a", "frame-b"] } },
  }),
};

const retryResponseContract = {
  schemaId: "visual-hierarchy-retry-choice",
  schemaVersion: "1.0.0",
  schemaSha256: digest({
    type: "object",
    required: ["choiceId"],
    properties: { choiceId: { enum: ["retry-a", "retry-b"] } },
  }),
};

const transferResponseContract = {
  schemaId: "visual-hierarchy-layer-order",
  schemaVersion: "1.0.0",
  schemaSha256: digest({
    type: "object",
    required: ["layerOrder"],
    properties: {
      layerOrder: {
        type: "array",
        items: { type: "string" },
        minItems: 5,
        maxItems: 5,
      },
    },
  }),
};

type ExerciseComponent = {
  [Name in GymComponentName]: (typeof GYM_COMPONENT_DEFINITIONS)[Name]["role"] extends
    | "action"
    | "fallback"
    ? Name
    : never;
}[GymComponentName];

interface DemoFixtureBinding {
  challengeTemplateId: string;
  exerciseId: string;
  revision: number;
  validationId: string;
  componentName: ExerciseComponent;
  episodeRole: "baseline" | "retry" | "held_out_transfer" | "diagnostic_probe";
  actionMode: "choose" | "layer_order";
  fixtureImportReceiptId: string;
  estimatedSeconds: number;
}

export const demoFixtureBindings = {
  baseline: {
    challengeTemplateId: "baseline_hierarchy_v1",
    exerciseId: "baseline-hierarchy-v2",
    revision: 2,
    validationId: "p1_baseline_v2",
    componentName: "CompareArena",
    episodeRole: "baseline",
    actionMode: "choose",
    fixtureImportReceiptId: "fixture_receipt_baseline_hierarchy_v1",
    estimatedSeconds: 28,
  },
  retry: {
    challengeTemplateId: "retry_focal_order_v1",
    exerciseId: "retry-hierarchy-v1",
    revision: 1,
    validationId: "p1_retry_fixture",
    componentName: "TargetedRetryGym",
    episodeRole: "retry",
    actionMode: "choose",
    fixtureImportReceiptId: "fixture_receipt_retry_focal_order_v1",
    estimatedSeconds: 24,
  },
  transfer: {
    challengeTemplateId: "transfer_layer_order_v1",
    exerciseId: "transfer-layer-order-v1",
    revision: 1,
    validationId: "p1_transfer_fixture",
    componentName: "LayerOrderTransferGym",
    episodeRole: "held_out_transfer",
    actionMode: "layer_order",
    fixtureImportReceiptId: "fixture_receipt_transfer_layer_order_v1",
    estimatedSeconds: 30,
  },
  fallback: {
    challengeTemplateId: "safe_fallback_v1",
    exerciseId: "safe-fallback-v1",
    revision: 1,
    validationId: "fallback_fixture_01",
    componentName: "SafeExerciseFallback",
    episodeRole: "diagnostic_probe",
    actionMode: "choose",
    fixtureImportReceiptId: "fixture_receipt_safe_fallback_v1",
    estimatedSeconds: 20,
  },
} as const satisfies Record<string, DemoFixtureBinding>;

function fixtureGymSpecContentHash(
  binding: DemoFixtureBinding,
  pedagogicalProps: Record<string, unknown>,
): string {
  const props = pedagogicalProps as {
    responseContract: typeof responseContract;
  };
  return digest(buildGymSpecProjection({
    exerciseId: binding.exerciseId,
    revision: binding.revision,
    challengeTemplateId: binding.challengeTemplateId,
    episodeRole: binding.episodeRole,
    actionMode: binding.actionMode,
    subskill: "focal ordering",
    responseContract: props.responseContract,
    estimatedSeconds: binding.estimatedSeconds,
    fixtureImportReceiptId: binding.fixtureImportReceiptId,
    renderContract: {
      renderContractId: `${binding.exerciseId}.${binding.componentName}.${binding.revision}`,
      phase: "action",
      componentName: binding.componentName,
      componentSchemaVersion: getGymComponentDefinition(binding.componentName)
        .schemaVersion,
      pedagogicalProps,
      pedagogicalPropsSha256: digest(pedagogicalProps),
    },
  }));
}

export const baselineVariants: [StimulusVariant, StimulusVariant] = [
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

export const learningPromptProps: LearningPromptProps = {
  eyebrow: "PIONEER GYM / 90 SECOND SESSION",
  title: "What do you want to get better at?",
  description:
    "Codex will turn your goal into active reps. Pioneer certifies each teaching signal, then finds your next productive edge from what you actually do.",
  placeholder: "I want to make short-form product videos that feel intentional, not generic.",
  submitLabel: "Build my first rep",
  examples: [
    "Make product videos feel intentional",
    "Improve visual hierarchy in social ads",
    "Know what to cut from a crowded frame",
  ],
  supportedEnvelope:
    "Live demo focus: visual hierarchy for short-form product video. Other prompts are mapped honestly to that practice domain.",
  sessionTimeboxSeconds: 90,
};

export function compareArenaProps(provenance: "live" | "prevalidated" | "fallback"): CompareArenaProps {
  const binding = demoFixtureBindings.baseline;
  const pedagogicalProps: Omit<CompareArenaProps, "validationReceipt"> = {
    phaseLabel: "REP 01 · DIAGNOSTIC",
    title: "Which frame makes the product decision feel intentional?",
    instruction:
      "Choose one frame, name what your eye notices first, then report your confidence.",
    brief:
      "A viewer should understand the promise in one beat and still find the action without competing focal points.",
    responseContract,
    variants: baselineVariants,
    reasoningPrompt: "What created—or weakened—the focal order?",
    reasoningTags: [
      { id: "focal-order", label: "Clear focal order" },
      { id: "competing-type", label: "Type competes" },
      { id: "cta-path", label: "CTA follows promise" },
      { id: "surface-polish", label: "Surface polish" },
    ],
    timeLimitSeconds: 28,
    submitLabel: "Commit response",
  };

  return {
    ...pedagogicalProps,
    validationReceipt: {
      validationId: binding.validationId,
      exerciseId: binding.exerciseId,
      exerciseRevision: binding.revision,
      judgment: "PASS",
      provenance,
      contentHash: fixtureGymSpecContentHash(binding, pedagogicalProps),
      contentHashVersion: GYM_CONTENT_HASH_VERSION,
      sourceLabel:
        provenance === "live"
          ? "FAL TEXT RECEIPT VERIFIED"
          : provenance === "prevalidated"
            ? "PREVALIDATED DEMO REP"
            : "SEPARATELY VALIDATED FALLBACK",
      detail:
        provenance === "live"
          ? "Pioneer certified this exact rep from fal-grounded text."
          : provenance === "prevalidated"
            ? "This immutable rep was certified before the session; it is not a runtime fallback."
            : "The live rep was unavailable, so this separately validated fallback was disclosed.",
    },
  };
}

export function feedbackProps(selectedId = "frame-a", final = false): CreditAssignmentReplayProps {
  const selected = baselineVariants.find((variant) => variant.id === selectedId) ?? baselineVariants[0];

  if (final) {
    return {
      phaseLabel: "TRANSFER · EVIDENCE RECEIPT",
      title: "Transfer shown in this session",
      summary:
        "You preserved the focal promise while changing both context and action mode. That is stronger evidence than succeeding on a near-identical retry.",
      selectedLabel: "Held-out 9:16 layer order",
      artifact: {
        id: "transfer-artifact",
        label: "9:16 product story",
        kicker: "FIELD TEST 03",
        headline: "Rain never gets the last word",
        supportingCopy: "Dry storage. Fast access. One-handed carry.",
        cta: "See it in the field",
        composition: "clear",
        accent: "lime",
      },
      anchors: [
        { id: "promise", label: "Promise first", note: "The focal claim owns the first beat.", x: 46, y: 28, tone: "signal" },
        { id: "proof", label: "Proof second", note: "Evidence supports without stealing the frame.", x: 34, y: 58, tone: "neutral" },
        { id: "action", label: "Action last", note: "The CTA closes the reading path.", x: 56, y: 82, tone: "signal" },
      ],
      criteria: [
        { criterionId: "focal-order", label: "Focal order", outcome: "met", observation: "The promise leads; proof and action remain subordinate." },
        { criterionId: "changed-context", label: "Changed context", outcome: "met", observation: "The decision transferred from compare-choice to layer ordering in 9:16." },
      ],
      evidenceId: "evidence_transfer_01",
      confidenceCalibration: "aligned",
      nextLabel: "Start another session",
    };
  }

  return {
    phaseLabel: "CREDIT ASSIGNMENT",
    title: "The polished frame hid the hierarchy problem",
    summary:
      "Your response favored local polish, but the brief required one decisive visual path. The headline, product, and CTA compete before the promise lands.",
    selectedLabel: selected.label,
    artifact: selected,
    anchors: [
      { id: "headline", label: "Headline", note: "Large type asks for the first beat.", x: 32, y: 26, tone: "confound" },
      { id: "product", label: "Product", note: "Contrast pulls attention sideways.", x: 68, y: 48, tone: "confound" },
      { id: "cta", label: "Action", note: "The action arrives before the promise resolves.", x: 40, y: 80, tone: "neutral" },
    ],
    criteria: [
      { criterionId: "focal-order", label: "Focal order", outcome: "not_met", observation: "The response did not identify the competing first beats." },
      { criterionId: "brief-alignment", label: "Brief alignment", outcome: "partial", observation: "The choice valued polish but did not connect it to the one-beat promise." },
      { criterionId: "confidence", label: "Confidence calibration", outcome: "partial", observation: "High confidence increases the value of a focused retry." },
    ],
    evidenceId: "evidence_baseline_01",
    confidenceCalibration: "over",
    nextLabel: "Find my next edge",
  };
}

export function retryProps(provenance: "live" | "prevalidated" | "fallback"): TargetedRetryGymProps {
  const binding = demoFixtureBindings.retry;
  const pedagogicalProps: Omit<TargetedRetryGymProps, "validationReceipt"> = {
    phaseLabel: "REP 02 · TARGETED RETRY",
    title: "Force one focal decision",
    instruction:
      "Choose the version with the clearest promise → proof → action path. Explain the tradeoff you accepted.",
    brief:
      "The product and copy are held constant. Only the information order changes.",
    responseContract: retryResponseContract,
    targetConstraint: "Make the promise unmistakable before product proof or action.",
    whyThisRep:
      "Pioneer cited your high-confidence miss on focal order. Codex accepted a same-subskill retry that removes surface-polish shortcuts.",
    evidenceIds: ["evidence_baseline_01"],
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

  return {
    ...pedagogicalProps,
    validationReceipt: {
      validationId: binding.validationId,
      exerciseId: binding.exerciseId,
      exerciseRevision: binding.revision,
      judgment: "PASS",
      provenance,
      contentHash: fixtureGymSpecContentHash(binding, pedagogicalProps),
      contentHashVersion: GYM_CONTENT_HASH_VERSION,
      sourceLabel:
        provenance === "live"
          ? "FAL TEXT RECEIPT VERIFIED"
          : provenance === "prevalidated"
            ? "PREVALIDATED DEMO REP"
            : "SEPARATELY VALIDATED FALLBACK",
    },
  };
}

export function transferProps(provenance: "live" | "prevalidated" | "fallback"): LayerOrderTransferGymProps {
  const binding = demoFixtureBindings.transfer;
  const pedagogicalProps: Omit<LayerOrderTransferGymProps, "validationReceipt"> = {
    phaseLabel: "REP 03 · HELD-OUT TRANSFER",
    title: "Build the reading order in a new format",
    instruction:
      "Order the layers from first attention to final action. This changes both the context and what you must do.",
    brief:
      "A vertical field-test story must land the emotional promise, support it with proof, and close with a clear action.",
    responseContract: transferResponseContract,
    transferLabel: "Changed context · changed action · disjoint stimulus",
    changedContext: "Side-by-side product frame → vertical outdoor story",
    changedAction: "Choose a composition → construct its layer order",
    layers: [
      { id: "promise", label: "Emotional promise", role: "focal", copy: "Rain never gets the last word" },
      { id: "context", label: "Field context", role: "context", copy: "Storm trail · frame 03" },
      { id: "proof", label: "Product proof", role: "proof", copy: "Dry storage · fast access" },
      { id: "support", label: "Supporting detail", role: "support", copy: "22L · sealed seams" },
      { id: "action", label: "Action", role: "action", copy: "See it in the field" },
    ],
    targetBrief:
      "Put the promise first, proof before specifications, and the action after the idea is earned.",
    submitLabel: "Submit held-out transfer",
  };

  return {
    ...pedagogicalProps,
    validationReceipt: {
      validationId: binding.validationId,
      exerciseId: binding.exerciseId,
      exerciseRevision: binding.revision,
      judgment: "PASS",
      provenance,
      contentHash: fixtureGymSpecContentHash(binding, pedagogicalProps),
      contentHashVersion: GYM_CONTENT_HASH_VERSION,
      sourceLabel:
        provenance === "live"
          ? "FAL TEXT RECEIPT VERIFIED"
          : provenance === "prevalidated"
            ? "PREVALIDATED HELD-OUT REP"
            : "SEPARATELY VALIDATED FALLBACK",
    },
  };
}

export function fallbackProps(): SafeExerciseFallbackProps {
  const binding = demoFixtureBindings.fallback;
  const pedagogicalProps: Omit<SafeExerciseFallbackProps, "validationReceipt"> = {
    phaseLabel: "SAFE FALLBACK",
    title: "The dynamic rep could not be rendered safely",
    instruction: "Complete this fixed choice so the session can remain observable.",
    brief: "Select the statement that best describes intentional hierarchy.",
    responseContract,
    disclosure:
      "This is not the failed rep and does not reuse its validation. Provider or renderer failure is being disclosed.",
    prompt: "Which description creates the clearest reading path?",
    options: [
      { id: "frame-a", label: "Everything is equally loud", description: "Headline, proof, and action compete for the first beat." },
      { id: "frame-b", label: "Promise, then proof, then action", description: "Each layer earns the next one." },
    ],
    submitLabel: "Submit accessible response",
  };

  return {
    ...pedagogicalProps,
    validationReceipt: {
      validationId: binding.validationId,
      exerciseId: binding.exerciseId,
      exerciseRevision: binding.revision,
      judgment: "PASS",
      provenance: "fallback",
      contentHash: fixtureGymSpecContentHash(binding, pedagogicalProps),
      contentHashVersion: GYM_CONTENT_HASH_VERSION,
      sourceLabel: "SEPARATELY VALIDATED FALLBACK",
    },
  };
}

export function shellCommand(sessionId: string): CodexUiCommand {
  return {
    commandKind: "shell",
    commandId: makeId("command"),
    sessionId,
    issuedBy: "codex",
    component: {
      type: "component",
      id: makeId("component"),
      name: "LearningPrompt",
      props: learningPromptProps,
      streamingState: "done",
    },
    componentSchemaVersion: getGymComponentDefinition("LearningPrompt")
      .schemaVersion,
    issuedAt: new Date().toISOString(),
  };
}

export function exerciseCommand(
  sessionId: string,
  goalInstanceId: string,
  name: ExerciseComponent,
  props: unknown,
  exerciseId: string,
  revision: number,
  validationId: string,
): CodexUiCommand {
  const validationReceipt = validationReceiptSchema.parse(
    (props as { validationReceipt?: unknown }).validationReceipt,
  );
  if (
    validationReceipt.exerciseId !== exerciseId ||
    validationReceipt.exerciseRevision !== revision ||
    validationReceipt.validationId !== validationId
  ) {
    throw new Error(
      "exercise command metadata must exactly match its P1 validation receipt",
    );
  }

  const componentSchemaVersion = getGymComponentDefinition(name).schemaVersion;
  const binding = Object.values(demoFixtureBindings).find(
    (candidate) =>
      candidate.exerciseId === exerciseId &&
      candidate.revision === revision &&
      candidate.componentName === name,
  );
  if (!binding) throw new Error("exercise command has no immutable demo fixture");
  const pedagogicalProps = { ...(props as Record<string, unknown>) };
  delete pedagogicalProps.validationReceipt;
  const pedagogicalPropsSha256 = digest(pedagogicalProps);
  const gymSpecProjection = buildGymSpecProjection({
    exerciseId,
    revision,
    challengeTemplateId: binding.challengeTemplateId,
    episodeRole: binding.episodeRole,
    actionMode: binding.actionMode,
    subskill: "focal ordering",
    responseContract: (pedagogicalProps as { responseContract: typeof responseContract })
      .responseContract,
    estimatedSeconds: binding.estimatedSeconds,
    fixtureImportReceiptId: binding.fixtureImportReceiptId,
    renderContract: {
      renderContractId: `${exerciseId}.${name}.${revision}`,
      phase: "action",
      componentName: name,
      componentSchemaVersion,
      pedagogicalProps,
      pedagogicalPropsSha256,
    },
  });
  return {
    commandKind: "exercise",
    commandPurpose: "exercise",
    commandId: makeId("command"),
    sessionId,
    goalInstanceId,
    episodeId: makeId("episode"),
    exerciseId,
    exerciseRevision: revision,
    issuedBy: "codex",
    renderContractId: `${exerciseId}.${name}.${revision}`,
    component: {
      type: "component",
      id: makeId("component"),
      name,
      props,
      streamingState: "done",
    },
    componentSchemaVersion,
    pedagogicalPropsSha256,
    gymSpecHash: validationReceipt.contentHash,
    gymSpecProjection,
    validationId: validationReceipt.validationId,
    fixtureImportReceiptId: binding.fixtureImportReceiptId,
    issuedAt: new Date().toISOString(),
  };
}

export function progress(active: "prompt" | "validate" | "practice" | "adapt" | "transfer", learningStatus: JourneyProgress["learningStatus"]): JourneyProgress {
  const order = ["prompt", "validate", "practice", "adapt", "transfer"] as const;
  const activeIndex = order.indexOf(active);
  const labels = {
    prompt: "Goal",
    validate: "Certify",
    practice: "Practice",
    adapt: "Adapt",
    transfer: "Transfer",
  };

  return {
    steps: order.map((id, index) => ({
      id,
      label: labels[id],
      state: index < activeIndex ? "complete" : index === activeIndex ? "active" : "upcoming",
    })),
    learningStatus,
  };
}

export function receipt(
  kind: UiReceipt["kind"],
  title: string,
  summary: string,
  status: UiReceipt["status"],
  provenance: UiReceipt["provenance"],
  options: Pick<UiReceipt, "reference" | "evidenceIds"> = {},
): UiReceipt {
  return {
    id: makeId("receipt"),
    kind,
    title,
    summary,
    status,
    provenance,
    ...options,
  };
}

export function promptResponse(sessionId: string): GymApiResponse {
  return {
    sessionId,
    command: shellCommand(sessionId),
    receipts: [],
    progress: progress("prompt", "not_started"),
  };
}
