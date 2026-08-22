import { z } from "zod";

import { parseCodexActionOutput } from "./schemas";
import {
  ACTION_MODES,
  CODEX_ACTIONS,
  CONFIDENCE_LEVELS,
  EPISODE_ROLES,
  GYM_COMPONENT_NAMES,
  LEARNER_PHASES,
  type AnyCodexActionRequest,
  type CodexAction,
  type CodexActionRunResult,
  type SkillReceipt,
} from "./types";

export const TEAMBOX_ACTION_PROTOCOL_VERSION = 1 as const;
export const TEAMBOX_ACTION_MAX_FRAME_BYTES = 64 * 1024;
export const TEAMBOX_ACTION_SOCKET_PATH =
  "/run/pioneer-gym/codex-action.sock" as const;

const boundedIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const shortTextSchema = z.string().max(4_096);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const stringListSchema = z.array(shortTextSchema).max(64);

const interpretGoalOutputSchema = z
  .object({
    goalInstanceId: boundedIdSchema,
    goalDefinitionId: boundedIdSchema,
    rawPrompt: z.string().min(1).max(4_096),
    domain: shortTextSchema,
    targetCapability: shortTextSchema,
    intendedUse: shortTextSchema,
    currentLevel: z.enum(["unknown", "novice", "practiced", "advanced"]),
    sessionTimeboxSeconds: z.number().int().min(15).max(600),
    constraints: stringListSchema,
    supportStatus: z.enum([
      "supported",
      "mapped_with_explanation",
      "unsupported",
    ]),
    interpretationShownToHuman: shortTextSchema,
    clarificationQuestion: shortTextSchema.nullable(),
  })
  .strict();

const challengeTemplateSchema = z
  .object({
    challengeTemplateId: boundedIdSchema,
    goalDefinitionId: boundedIdSchema,
    stimulusReceiptId: boundedIdSchema,
    stimulusReceiptSha256: sha256Schema,
    subskill: shortTextSchema.min(1),
    contextId: boundedIdSchema,
    episodeRole: z.enum(EPISODE_ROLES),
    actionMode: z.enum(ACTION_MODES),
    estimatedSeconds: z.number().int().min(1).max(600),
    learningObjective: shortTextSchema,
    intendedContrast: shortTextSchema,
    invariants: stringListSchema,
    learnerPrompt: shortTextSchema,
    renderContractId: boundedIdSchema,
    componentName: z.enum(GYM_COMPONENT_NAMES),
    componentSchemaVersion: boundedIdSchema,
    prevalidated: z.boolean(),
  })
  .strict();

const interpretGoalRequestSchema = z
  .object({
    action: z.literal("interpret_goal"),
    sessionId: boundedIdSchema,
    goalInstanceId: boundedIdSchema,
    rawPrompt: z.string().min(1).max(4_096),
    sessionTimeboxSeconds: z.number().int().min(15).max(600),
  })
  .strict();

const authorRepRequestSchema = z
  .object({
    action: z.literal("author_rep"),
    sessionId: boundedIdSchema,
    goal: interpretGoalOutputSchema,
    desiredEpisodeRole: z.enum(EPISODE_ROLES),
    currentSubskill: shortTextSchema.min(1).nullable(),
    pioneerRepairHints: stringListSchema,
    maxEstimatedSeconds: z.number().int().min(1).max(600),
    eligibleTemplates: z.array(challengeTemplateSchema).max(32),
  })
  .strict();

const boundedActionValueSchema = z
  .object({
    optionId: boundedIdSchema.nullable(),
    orderedIds: z.array(boundedIdSchema).max(64),
    booleanValue: z.boolean().nullable(),
    numericValue: z.number().finite().nullable(),
  })
  .strict();

const rubricCriterionSchema = z
  .object({
    criterionId: boundedIdSchema,
    description: shortTextSchema,
    acceptableActionIds: z.array(boundedIdSchema).max(64),
    acceptableReasoningTagIds: z.array(boundedIdSchema).max(64),
    requiredForTransfer: z.boolean(),
    partialCountsForTransfer: z.boolean(),
  })
  .strict();

const assessResponseRequestSchema = z
  .object({
    action: z.literal("assess_response"),
    sessionId: boundedIdSchema,
    goalInstanceId: boundedIdSchema,
    evidenceId: boundedIdSchema,
    responseId: boundedIdSchema,
    exerciseId: boundedIdSchema,
    exerciseRevision: z.number().int().min(1).max(1_000_000),
    episodeRole: z.enum(EPISODE_ROLES),
    validationId: boundedIdSchema,
    gymSpecHash: sha256Schema,
    validatedRepBound: z.boolean(),
    actionValue: boundedActionValueSchema,
    reasoningText: z.string().max(8_192).nullable(),
    reasoningTagIds: z.array(boundedIdSchema).max(64),
    statedConfidence: z.enum(CONFIDENCE_LEVELS),
    reasoningRequired: z.boolean(),
    rubric: z.array(rubricCriterionSchema).min(1).max(32),
  })
  .strict();

const pioneerRecommendationSchema = z
  .object({
    recommendationId: boundedIdSchema,
    recommendedChallengeTemplateId: boundedIdSchema,
    recommendedSubskill: shortTextSchema.min(1),
    recommendedActionMode: z.enum(ACTION_MODES),
    episodeRole: z.enum(["diagnostic_probe", "retry", "held_out_transfer"]),
    evidenceIds: z.array(boundedIdSchema).min(1).max(64),
    confidence: z.enum(CONFIDENCE_LEVELS),
  })
  .strict();

const decideNextRequestSchema = z
  .object({
    action: z.literal("decide_next"),
    sessionId: boundedIdSchema,
    goalInstanceId: boundedIdSchema,
    currentPhase: z.enum(LEARNER_PHASES),
    currentSubskill: shortTextSchema.min(1),
    latestEvidenceIds: z.array(boundedIdSchema).max(64),
    pioneerRecommendation: pioneerRecommendationSchema.nullable(),
    eligibleChallenges: z.array(challengeTemplateSchema).max(32),
    fallbackChallengeTemplateId: boundedIdSchema.nullable(),
    maxEstimatedSeconds: z.number().int().min(1).max(600),
  })
  .strict();

export const teamboxActionRequestSchema = z.discriminatedUnion("action", [
  interpretGoalRequestSchema,
  authorRepRequestSchema,
  assessResponseRequestSchema,
  decideNextRequestSchema,
]);

export const teamboxActionRequestEnvelopeSchema = z
  .object({
    version: z.literal(TEAMBOX_ACTION_PROTOCOL_VERSION),
    requestId: boundedIdSchema,
    actionRequest: teamboxActionRequestSchema,
  })
  .strict();

export interface TeamboxActionRequestEnvelope {
  version: typeof TEAMBOX_ACTION_PROTOCOL_VERSION;
  requestId: string;
  actionRequest: AnyCodexActionRequest;
}

export type TeamboxGatewayErrorCode =
  | "invalid_frame"
  | "invalid_request"
  | "deadline_exceeded"
  | "codex_failed"
  | "internal_error";

export type TeamboxActionResponseEnvelope =
  | {
      version: typeof TEAMBOX_ACTION_PROTOCOL_VERSION;
      requestId: string;
      ok: true;
      result: CodexActionRunResult<CodexAction>;
    }
  | {
      version: typeof TEAMBOX_ACTION_PROTOCOL_VERSION;
      requestId: string;
      ok: false;
      error: { code: TeamboxGatewayErrorCode; message: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function parseTeamboxActionRequestEnvelope(
  value: unknown,
): TeamboxActionRequestEnvelope {
  return teamboxActionRequestEnvelopeSchema.parse(
    value,
  ) as TeamboxActionRequestEnvelope;
}

export function parseTeamboxActionResponseEnvelope(
  value: unknown,
  expectedRequestId: string,
  expectedAction: CodexAction,
  expectedSkillReceipts: readonly SkillReceipt[],
): TeamboxActionResponseEnvelope {
  if (!isRecord(value) || value.version !== TEAMBOX_ACTION_PROTOCOL_VERSION) {
    throw new Error("TeamBox gateway returned an invalid response envelope");
  }
  if (value.requestId !== expectedRequestId || typeof value.ok !== "boolean") {
    throw new Error("TeamBox gateway response binding failed");
  }

  if (!value.ok) {
    if (!hasOnlyKeys(value, ["version", "requestId", "ok", "error"])) {
      throw new Error("TeamBox gateway error response has extra fields");
    }
    const error = value.error;
    if (
      !isRecord(error) ||
      !hasOnlyKeys(error, ["code", "message"]) ||
      ![
        "invalid_frame",
        "invalid_request",
        "deadline_exceeded",
        "codex_failed",
        "internal_error",
      ].includes(String(error.code)) ||
      typeof error.message !== "string"
    ) {
      throw new Error("TeamBox gateway returned an invalid error");
    }
    return value as TeamboxActionResponseEnvelope;
  }

  if (!hasOnlyKeys(value, ["version", "requestId", "ok", "result"])) {
    throw new Error("TeamBox gateway success response has extra fields");
  }
  const result = value.result;
  if (
    !isRecord(result) ||
    !hasOnlyKeys(result, [
      "action",
      "source",
      "output",
      "skillReceipts",
      "fallbackReason",
      "usage",
    ]) ||
    result.action !== expectedAction ||
    result.source !== "codex_sdk" ||
    result.fallbackReason !== null ||
    !Array.isArray(result.skillReceipts)
  ) {
    throw new Error("TeamBox gateway returned an invalid live Codex result");
  }
  for (const receipt of result.skillReceipts) {
    if (
      !isRecord(receipt) ||
      !hasOnlyKeys(receipt, [
        "name",
        "relativePath",
        "sha256",
        "utf8ByteLength",
      ]) ||
      typeof receipt.name !== "string" ||
      typeof receipt.relativePath !== "string" ||
      typeof receipt.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      typeof receipt.utf8ByteLength !== "number" ||
      !Number.isInteger(receipt.utf8ByteLength) ||
      receipt.utf8ByteLength <= 0
    ) {
      throw new Error("TeamBox gateway returned an invalid skill receipt");
    }
  }
  if (
    expectedSkillReceipts.length !== 2 ||
    result.skillReceipts.length !== expectedSkillReceipts.length ||
    result.skillReceipts.some((receipt, index) => {
      const expected = expectedSkillReceipts[index];
      return (
        !expected ||
        receipt.name !== expected.name ||
        receipt.relativePath !== expected.relativePath ||
        receipt.sha256 !== expected.sha256 ||
        receipt.utf8ByteLength !== expected.utf8ByteLength
      );
    })
  ) {
    throw new Error(
      "TeamBox live Codex result is not bound to the checked-in action skills",
    );
  }
  if (result.usage !== null) {
    if (
      !isRecord(result.usage) ||
      !hasOnlyKeys(result.usage, [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
      ]) ||
      !Object.values(result.usage).every(Number.isInteger)
    ) {
      throw new Error("TeamBox gateway returned invalid usage data");
    }
  }
  if (!CODEX_ACTIONS.includes(result.action as CodexAction)) {
    throw new Error("TeamBox gateway returned an unknown action");
  }
  parseCodexActionOutput(
    expectedAction,
    JSON.stringify(result.output),
  );
  return value as TeamboxActionResponseEnvelope;
}

export function encodeTeamboxFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.byteLength > TEAMBOX_ACTION_MAX_FRAME_BYTES) {
    throw new TeamboxFrameError(
      `TeamBox frame exceeds ${TEAMBOX_ACTION_MAX_FRAME_BYTES} bytes`,
    );
  }
  const frame = Buffer.allocUnsafe(4 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

export class TeamboxFrameError extends Error {}

export class TeamboxFrameDecoder {
  private buffer = Buffer.alloc(0);

  get bufferedBytes(): number {
    return this.buffer.byteLength;
  }

  push(chunk: Buffer): unknown[] {
    if (chunk.byteLength === 0) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values: unknown[] = [];
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > TEAMBOX_ACTION_MAX_FRAME_BYTES) {
        throw new TeamboxFrameError("Invalid TeamBox frame length");
      }
      if (this.buffer.byteLength < 4 + length) break;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      try {
        values.push(JSON.parse(payload));
      } catch {
        throw new TeamboxFrameError("TeamBox frame contains invalid JSON");
      }
    }
    return values;
  }
}
