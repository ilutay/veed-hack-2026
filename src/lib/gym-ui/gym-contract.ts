import { z } from "zod";

import {
  GYM_COMPONENT_NAMES,
  GYM_CONTENT_HASH_VERSION,
  getGymComponentDefinition,
  gymComponentNameSchema,
  type GymComponentName,
} from "../contracts/gym-components";

/** Strict shared boundary for browser events and Codex-issued UI commands. */

export { GYM_COMPONENT_NAMES, gymComponentNameSchema };
export type { GymComponentName };

const idSchema = z.string().trim().min(1).max(160);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const responseContractSchema = z
  .object({
    schemaId: idSchema,
    schemaVersion: idSchema,
    schemaSha256: digestSchema,
  })
  .strict();

export const gymSpecProjectionSchema = z
  .object({
    schemaVersion: z.literal("gym-spec-v1"),
    exerciseId: idSchema,
    revision: z.number().int().positive(),
    challengeTemplateId: idSchema,
    episodeRole: z.enum([
      "baseline",
      "diagnostic_probe",
      "retry",
      "held_out_transfer",
    ]),
    actionMode: z.enum(["choose", "edit", "rank", "layer_order", "explain"]),
    subskill: z.string().trim().min(1).max(240),
    responseContract: responseContractSchema,
    estimatedSeconds: z.number().int().min(1).max(600),
    fixtureImportReceiptId: idSchema,
    renderContract: z
      .object({
        renderContractId: idSchema,
        phase: z.literal("action"),
        componentName: gymComponentNameSchema,
        componentSchemaVersion: idSchema,
        pedagogicalProps: z.record(z.string(), z.unknown()),
        pedagogicalPropsSha256: digestSchema,
      })
      .strict(),
    contentHashVersion: z.literal(GYM_CONTENT_HASH_VERSION),
  })
  .strict();

export type GymSpecProjection = z.infer<typeof gymSpecProjectionSchema>;

export function buildGymSpecProjection(
  input: Omit<
    GymSpecProjection,
    "schemaVersion" | "contentHashVersion"
  >,
): GymSpecProjection {
  return gymSpecProjectionSchema.parse({
    schemaVersion: "gym-spec-v1",
    ...input,
    contentHashVersion: GYM_CONTENT_HASH_VERSION,
  });
}

export const validationReceiptSchema = z
  .object({
    validationId: idSchema,
    exerciseId: idSchema,
    exerciseRevision: z.number().int().positive(),
    judgment: z.literal("PASS"),
    provenance: z.enum(["live", "prevalidated", "fallback"]),
    contentHash: digestSchema,
    contentHashVersion: z.literal(GYM_CONTENT_HASH_VERSION),
    sourceLabel: z.string().trim().min(1).max(80).default("FAL TEXT RECEIPT VERIFIED"),
    detail: z.string().trim().max(320).optional(),
  })
  .strict();

export const learningPromptPropsSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80).default("PIONEER GYM / SESSION 01"),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(420),
    placeholder: z.string().trim().min(1).max(180),
    submitLabel: z.string().trim().min(1).max(48).default("Build my first rep"),
    examples: z.array(z.string().trim().min(1).max(180)).min(1).max(3),
    supportedEnvelope: z.string().trim().min(1).max(300),
    sessionTimeboxSeconds: z.number().int().min(30).max(900).default(90),
  })
  .strict();

export const stimulusAssetSchema = z
  .object({
    src: z
      .string()
      .trim()
      .max(2_048)
      .refine(
        (value) => value.startsWith("/") || value.startsWith("https://"),
        "Asset source must be a local path or HTTPS URL",
      ),
    alt: z.string().trim().min(1).max(240),
    sha256: digestSchema,
  })
  .strict();

export const stimulusVariantSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(60),
    kicker: z.string().trim().max(60).optional(),
    headline: z.string().trim().min(1).max(120),
    supportingCopy: z.string().trim().min(1).max(220),
    cta: z.string().trim().min(1).max(60),
    composition: z.enum(["clear", "competing", "balanced", "stacked"]),
    accent: z.enum(["lime", "coral", "blue", "violet"]).default("lime"),
    asset: stimulusAssetSchema.optional(),
  })
  .strict();

const reasoningTagSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const exerciseCoreSchema = {
  phaseLabel: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(140),
  instruction: z.string().trim().min(1).max(360),
  brief: z.string().trim().min(1).max(500),
  responseContract: responseContractSchema,
  validationReceipt: validationReceiptSchema,
};

export const compareArenaPropsSchema = z
  .object({
    ...exerciseCoreSchema,
    variants: z.array(stimulusVariantSchema).length(2),
    reasoningPrompt: z.string().trim().min(1).max(220),
    reasoningTags: z.array(reasoningTagSchema).min(1).max(6),
    timeLimitSeconds: z.number().int().min(10).max(180),
    submitLabel: z.string().trim().min(1).max(48).default("Commit response"),
  })
  .strict();

const criterionOutcomeSchema = z
  .object({
    criterionId: idSchema,
    label: z.string().trim().min(1).max(100),
    outcome: z.enum(["met", "partial", "not_met", "unscorable"]),
    observation: z.string().trim().min(1).max(420),
  })
  .strict();

const artifactAnchorSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(80),
    note: z.string().trim().min(1).max(280),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    tone: z.enum(["signal", "confound", "neutral"]),
  })
  .strict();

export const creditAssignmentReplayPropsSchema = z
  .object({
    phaseLabel: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(140),
    summary: z.string().trim().min(1).max(500),
    selectedLabel: z.string().trim().min(1).max(100),
    artifact: stimulusVariantSchema,
    anchors: z.array(artifactAnchorSchema).min(1).max(6),
    criteria: z.array(criterionOutcomeSchema).min(1).max(8),
    evidenceId: idSchema,
    confidenceCalibration: z.enum(["under", "aligned", "over", "unknown"]),
    nextLabel: z.string().trim().min(1).max(60).default("Find my next edge"),
  })
  .strict();

export const targetedRetryGymPropsSchema = z
  .object({
    ...exerciseCoreSchema,
    targetConstraint: z.string().trim().min(1).max(300),
    whyThisRep: z.string().trim().min(1).max(420),
    evidenceIds: z.array(idSchema).min(1).max(8),
    variants: z.array(stimulusVariantSchema).length(2),
    reasoningPrompt: z.string().trim().min(1).max(220),
    reasoningTags: z.array(reasoningTagSchema).min(1).max(6),
    submitLabel: z.string().trim().min(1).max(48).default("Test this decision"),
  })
  .strict();

const transferLayerSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(80),
    role: z.enum(["context", "support", "proof", "focal", "action"]),
    copy: z.string().trim().min(1).max(140),
  })
  .strict();

export const layerOrderTransferGymPropsSchema = z
  .object({
    ...exerciseCoreSchema,
    transferLabel: z.string().trim().min(1).max(100),
    changedContext: z.string().trim().min(1).max(220),
    changedAction: z.string().trim().min(1).max(220),
    layers: z.array(transferLayerSchema).min(3).max(7),
    targetBrief: z.string().trim().min(1).max(420),
    submitLabel: z.string().trim().min(1).max(48).default("Submit held-out transfer"),
  })
  .strict();

const fallbackOptionSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(280),
  })
  .strict();

export const safeExerciseFallbackPropsSchema = z
  .object({
    ...exerciseCoreSchema,
    disclosure: z.string().trim().min(1).max(360),
    prompt: z.string().trim().min(1).max(360),
    options: z.array(fallbackOptionSchema).min(2).max(5),
    submitLabel: z.string().trim().min(1).max(48).default("Submit accessible response"),
  })
  .strict();

export const gymComponentSchemas = {
  LearningPrompt: learningPromptPropsSchema,
  CompareArena: compareArenaPropsSchema,
  CreditAssignmentReplay: creditAssignmentReplayPropsSchema,
  TargetedRetryGym: targetedRetryGymPropsSchema,
  LayerOrderTransferGym: layerOrderTransferGymPropsSchema,
  SafeExerciseFallback: safeExerciseFallbackPropsSchema,
} as const satisfies Record<GymComponentName, z.ZodTypeAny>;

const componentContentSchema = z
  .object({
    type: z.literal("component"),
    id: idSchema,
    name: gymComponentNameSchema,
    props: z.unknown(),
    streamingState: z.literal("done").default("done"),
  })
  .strict();

const shellUiCommandSchema = z
  .object({
    commandKind: z.literal("shell"),
    commandId: idSchema,
    sessionId: idSchema,
    issuedBy: z.literal("codex"),
    component: componentContentSchema.extend({ name: z.literal("LearningPrompt") }),
    componentSchemaVersion: z.literal(
      getGymComponentDefinition("LearningPrompt").schemaVersion,
    ),
    issuedAt: z.string().min(1),
  })
  .strict();

const exerciseUiCommandSchema = z
  .object({
    commandKind: z.literal("exercise"),
    commandPurpose: z.enum(["exercise", "feedback"]),
    commandId: idSchema,
    sessionId: idSchema,
    goalInstanceId: idSchema,
    episodeId: idSchema,
    exerciseId: idSchema,
    exerciseRevision: z.number().int().positive(),
    issuedBy: z.literal("codex"),
    renderContractId: idSchema,
    component: componentContentSchema,
    componentSchemaVersion: idSchema,
    pedagogicalPropsSha256: digestSchema,
    gymSpecHash: digestSchema,
    gymSpecProjection: gymSpecProjectionSchema,
    validationId: idSchema,
    fixtureImportReceiptId: idSchema.optional(),
    issuedAt: z.string().min(1),
  })
  .strict()
  .superRefine((command, context) => {
    const definition = getGymComponentDefinition(command.component.name);
    if (definition.role === "shell") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["component", "name"],
        message: "a shell-only component cannot be issued as an exercise",
      });
    }
    const expectedRole =
      command.commandPurpose === "feedback" ? "feedback" : undefined;
    if (
      (expectedRole && definition.role !== expectedRole) ||
      (!expectedRole &&
        definition.role !== "action" &&
        definition.role !== "fallback")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["component", "name"],
        message: `component role does not match ${command.commandPurpose} command`,
      });
    }
    if (command.componentSchemaVersion !== definition.schemaVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["componentSchemaVersion"],
        message: `component schema version must be ${definition.schemaVersion}`,
      });
    }
  });

export const codexUiCommandSchema = z.discriminatedUnion("commandKind", [
  shellUiCommandSchema,
  exerciseUiCommandSchema,
]);

export const uiReceiptSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["p1_validation", "assessment", "p2_recommendation", "codex_decision", "transfer"]),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(600),
    status: z.enum(["pass", "reject", "abstain", "scored", "accepted", "overridden", "pending", "shown", "not_shown"]),
    provenance: z.enum([
      "live",
      "prevalidated",
      "deterministic_skill_policy",
      "deterministic_rubric_policy",
      "fallback",
    ]),
    reference: z.string().trim().min(1).max(180).optional(),
    evidenceIds: z.array(idSchema).max(12).optional(),
  })
  .strict();

const journeyStepSchema = z
  .object({
    id: z.enum(["prompt", "validate", "practice", "adapt", "transfer"]),
    label: z.string().trim().min(1).max(40),
    state: z.enum(["upcoming", "active", "complete", "blocked"]),
  })
  .strict();

export const journeyProgressSchema = z
  .object({
    steps: z.array(journeyStepSchema).length(5),
    learningStatus: z.enum(["not_started", "diagnosed", "practicing", "transfer_pending", "transfer_shown"]),
  })
  .strict();

export const gymApiResponseSchema = z
  .object({
    sessionId: idSchema,
    command: codexUiCommandSchema,
    receipts: z.array(uiReceiptSchema).default([]),
    progress: journeyProgressSchema.optional(),
    message: z.string().trim().min(1).max(600).optional(),
  })
  .strict();

export type LearningPromptProps = z.infer<typeof learningPromptPropsSchema>;
export type StimulusVariant = z.infer<typeof stimulusVariantSchema>;
export type CompareArenaProps = z.infer<typeof compareArenaPropsSchema>;
export type CreditAssignmentReplayProps = z.infer<typeof creditAssignmentReplayPropsSchema>;
export type TargetedRetryGymProps = z.infer<typeof targetedRetryGymPropsSchema>;
export type LayerOrderTransferGymProps = z.infer<typeof layerOrderTransferGymPropsSchema>;
export type SafeExerciseFallbackProps = z.infer<typeof safeExerciseFallbackPropsSchema>;
export type ResponseContractRef = z.infer<typeof responseContractSchema>;
export type CodexUiCommand = z.infer<typeof codexUiCommandSchema>;
export type ExerciseUiCommand = Extract<CodexUiCommand, { commandKind: "exercise" }>;
export type UiReceipt = z.infer<typeof uiReceiptSchema>;
export type JourneyProgress = z.infer<typeof journeyProgressSchema>;
export type GymApiResponse = z.infer<typeof gymApiResponseSchema>;

export type Confidence = "low" | "medium" | "high";

export interface ExerciseSubmissionDraft {
  actionValue: unknown;
  responseContract: ResponseContractRef;
  reasoningText?: string;
  reasoningTagIds?: string[];
  statedConfidence: Confidence;
}

const eventIdentityShape = {
  eventId: idSchema,
  idempotencyKey: idSchema,
  sessionId: idSchema,
  sourceComponentId: idSchema,
  clientCreatedAt: z.string().min(1),
};

const exerciseEventContextShape = {
  commandId: idSchema,
  goalInstanceId: idSchema,
  episodeId: idSchema,
  exerciseId: idSchema,
  exerciseRevision: z.number().int().positive(),
  validationId: idSchema,
  renderContractId: idSchema,
};

const startEventSchema = z
  .object({
    ...eventIdentityShape,
    type: z.literal("start"),
    payload: z.object({ rawPrompt: z.string().trim().min(3).max(280) }).strict(),
  })
  .strict();

const exerciseSubmittedEventSchema = z
  .object({
    ...eventIdentityShape,
    ...exerciseEventContextShape,
    type: z.literal("exercise.submitted"),
    payload: z
      .object({
        responseId: idSchema,
        action: responseContractSchema.extend({ value: z.unknown() }),
        reasoningText: z.string().trim().min(1).max(1_200).optional(),
        reasoningTagIds: z.array(idSchema).max(12),
        statedConfidence: z.enum(["low", "medium", "high"]),
        submittedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const feedbackAcknowledgedEventSchema = z
  .object({
    ...eventIdentityShape,
    ...exerciseEventContextShape,
    type: z.literal("feedback.acknowledged"),
    payload: z.object({ evidenceId: idSchema }).strict(),
  })
  .strict();

const componentFailedEventSchema = z
  .object({
    ...eventIdentityShape,
    type: z.literal("ui.component_failed"),
    commandId: idSchema.optional(),
    goalInstanceId: idSchema.optional(),
    episodeId: idSchema.optional(),
    exerciseId: idSchema.optional(),
    exerciseRevision: z.number().int().positive().optional(),
    validationId: idSchema.optional(),
    renderContractId: idSchema.optional(),
    payload: z
      .object({
        errorCode: z.string().trim().min(1).max(120),
        failedCommandId: idSchema,
      })
      .strict(),
  })
  .strict();

export const humanUiEventSchema = z.discriminatedUnion("type", [
  startEventSchema,
  exerciseSubmittedEventSchema,
  feedbackAcknowledgedEventSchema,
  componentFailedEventSchema,
]);

export const gymApiRequestSchema = z
  .object({
    sessionId: idSchema.optional(),
    event: humanUiEventSchema,
  })
  .strict();

export type HumanUiEvent = z.infer<typeof humanUiEventSchema>;
export type GymApiRequest = z.infer<typeof gymApiRequestSchema>;

export function parseComponentProps(command: CodexUiCommand) {
  const schema = gymComponentSchemas[command.component.name];
  return schema.safeParse(command.component.props);
}
