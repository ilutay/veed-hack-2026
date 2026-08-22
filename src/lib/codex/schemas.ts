import {
  ACTION_MODES,
  EPISODE_ROLES,
  GYM_COMPONENT_NAMES,
  type AssessResponseOutput,
  type AuthorRepOutput,
  type CodexAction,
  type CodexActionOutputMap,
  type DecideNextOutput,
  type InterpretGoalOutput,
} from "./types";

export type JsonSchema = Readonly<Record<string, unknown>>;

const stringSchema = { type: "string" } as const;
const stringArraySchema = { type: "array", items: stringSchema } as const;

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

function nullableEnumSchema(values: readonly string[]) {
  return {
    anyOf: [{ type: "string", enum: values }, { type: "null" }],
  } as const;
}

export const interpretGoalOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalInstanceId: stringSchema,
    goalDefinitionId: stringSchema,
    rawPrompt: stringSchema,
    domain: stringSchema,
    targetCapability: stringSchema,
    intendedUse: stringSchema,
    currentLevel: {
      type: "string",
      enum: ["unknown", "novice", "practiced", "advanced"],
    },
    sessionTimeboxSeconds: { type: "integer" },
    constraints: stringArraySchema,
    supportStatus: {
      type: "string",
      enum: ["supported", "mapped_with_explanation", "unsupported"],
    },
    interpretationShownToHuman: stringSchema,
    clarificationQuestion: nullableStringSchema,
  },
  required: [
    "goalInstanceId",
    "goalDefinitionId",
    "rawPrompt",
    "domain",
    "targetCapability",
    "intendedUse",
    "currentLevel",
    "sessionTimeboxSeconds",
    "constraints",
    "supportStatus",
    "interpretationShownToHuman",
    "clarificationQuestion",
  ],
} as const satisfies JsonSchema;

export const authorRepOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["selected", "blocked"] },
    goalDefinitionId: stringSchema,
    challengeTemplateId: nullableStringSchema,
    stimulusReceiptId: nullableStringSchema,
    stimulusReceiptSha256: nullableStringSchema,
    episodeRole: nullableEnumSchema(EPISODE_ROLES),
    subskill: nullableStringSchema,
    contextId: nullableStringSchema,
    actionMode: nullableEnumSchema(ACTION_MODES),
    learningObjective: nullableStringSchema,
    intendedContrast: nullableStringSchema,
    invariants: stringArraySchema,
    learnerPrompt: nullableStringSchema,
    authoringRationale: stringSchema,
    repairHintsApplied: stringArraySchema,
  },
  required: [
    "status",
    "goalDefinitionId",
    "challengeTemplateId",
    "stimulusReceiptId",
    "stimulusReceiptSha256",
    "episodeRole",
    "subskill",
    "contextId",
    "actionMode",
    "learningObjective",
    "intendedContrast",
    "invariants",
    "learnerPrompt",
    "authoringRationale",
    "repairHintsApplied",
  ],
} as const satisfies JsonSchema;

const criterionEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    criterionId: stringSchema,
    outcome: {
      type: "string",
      enum: ["met", "partial", "not_met", "unscorable"],
    },
    observationCode: {
      type: "string",
      enum: [
        "bounded_evidence_satisfies_criterion",
        "one_evidence_channel_missing",
        "bounded_evidence_does_not_satisfy_criterion",
        "criterion_has_no_deterministic_rule",
        "validated_rep_binding_missing",
        "observable_response_missing",
      ],
    },
    evidenceRefs: stringArraySchema,
  },
  required: ["criterionId", "outcome", "observationCode", "evidenceRefs"],
} as const;

export const assessResponseOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    evidenceId: stringSchema,
    responseId: stringSchema,
    exerciseId: stringSchema,
    exerciseRevision: { type: "integer" },
    episodeRole: { type: "string", enum: EPISODE_ROLES },
    validationId: stringSchema,
    gymSpecHash: stringSchema,
    assessmentStatus: {
      type: "string",
      enum: ["scored", "abstained", "needs_more_evidence"],
    },
    criterionEvidence: { type: "array", items: criterionEvidenceSchema },
    confidenceCalibration: {
      type: "string",
      enum: ["under", "aligned", "over", "unknown"],
    },
    assessorVersion: stringSchema,
    reasonCodes: stringArraySchema,
  },
  required: [
    "evidenceId",
    "responseId",
    "exerciseId",
    "exerciseRevision",
    "episodeRole",
    "validationId",
    "gymSpecHash",
    "assessmentStatus",
    "criterionEvidence",
    "confidenceCalibration",
    "assessorVersion",
    "reasonCodes",
  ],
} as const satisfies JsonSchema;

export const decideNextOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: {
      type: "string",
      enum: ["accept", "override", "deterministic_fallback", "block"],
    },
    recommendationId: nullableStringSchema,
    chosenChallengeTemplateId: nullableStringSchema,
    stimulusReceiptId: nullableStringSchema,
    stimulusReceiptSha256: nullableStringSchema,
    episodeRole: nullableEnumSchema(EPISODE_ROLES),
    actionMode: nullableEnumSchema(ACTION_MODES),
    renderContractId: nullableStringSchema,
    componentName: nullableEnumSchema(GYM_COMPONENT_NAMES),
    componentSchemaVersion: nullableStringSchema,
    reasonCode: stringSchema,
    rationale: stringSchema,
    citedEvidenceIds: stringArraySchema,
    provenanceLabel: {
      type: "string",
      enum: [
        "live_pioneer",
        "codex_override",
        "deterministic_fallback",
        "blocked",
      ],
    },
  },
  required: [
    "decision",
    "recommendationId",
    "chosenChallengeTemplateId",
    "stimulusReceiptId",
    "stimulusReceiptSha256",
    "episodeRole",
    "actionMode",
    "renderContractId",
    "componentName",
    "componentSchemaVersion",
    "reasonCode",
    "rationale",
    "citedEvidenceIds",
    "provenanceLabel",
  ],
} as const satisfies JsonSchema;

export const CODEX_ACTION_OUTPUT_SCHEMAS: Readonly<
  Record<CodexAction, JsonSchema>
> = {
  interpret_goal: interpretGoalOutputSchema,
  author_rep: authorRepOutputSchema,
  assess_response: assessResponseOutputSchema,
  decide_next: decideNextOutputSchema,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

function isInterpretGoalOutput(value: unknown): value is InterpretGoalOutput {
  if (!isObject(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "goalInstanceId",
      "goalDefinitionId",
      "rawPrompt",
      "domain",
      "targetCapability",
      "intendedUse",
      "currentLevel",
      "sessionTimeboxSeconds",
      "constraints",
      "supportStatus",
      "interpretationShownToHuman",
      "clarificationQuestion",
    ])
  ) {
    return false;
  }

  return (
    typeof value.goalInstanceId === "string" &&
    typeof value.goalDefinitionId === "string" &&
    typeof value.rawPrompt === "string" &&
    typeof value.domain === "string" &&
    typeof value.targetCapability === "string" &&
    typeof value.intendedUse === "string" &&
    isOneOf(value.currentLevel, [
      "unknown",
      "novice",
      "practiced",
      "advanced",
    ] as const) &&
    Number.isInteger(value.sessionTimeboxSeconds) &&
    isStringArray(value.constraints) &&
    isOneOf(value.supportStatus, [
      "supported",
      "mapped_with_explanation",
      "unsupported",
    ] as const) &&
    typeof value.interpretationShownToHuman === "string" &&
    isNullableString(value.clarificationQuestion)
  );
}

function isAuthorRepOutput(value: unknown): value is AuthorRepOutput {
  if (!isObject(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "status",
      "goalDefinitionId",
      "challengeTemplateId",
      "stimulusReceiptId",
      "stimulusReceiptSha256",
      "episodeRole",
      "subskill",
      "contextId",
      "actionMode",
      "learningObjective",
      "intendedContrast",
      "invariants",
      "learnerPrompt",
      "authoringRationale",
      "repairHintsApplied",
    ])
  ) {
    return false;
  }

  return (
    isOneOf(value.status, ["selected", "blocked"] as const) &&
    typeof value.goalDefinitionId === "string" &&
    isNullableString(value.challengeTemplateId) &&
    isNullableString(value.stimulusReceiptId) &&
    isNullableString(value.stimulusReceiptSha256) &&
    (value.episodeRole === null || isOneOf(value.episodeRole, EPISODE_ROLES)) &&
    isNullableString(value.subskill) &&
    isNullableString(value.contextId) &&
    (value.actionMode === null || isOneOf(value.actionMode, ACTION_MODES)) &&
    isNullableString(value.learningObjective) &&
    isNullableString(value.intendedContrast) &&
    isStringArray(value.invariants) &&
    isNullableString(value.learnerPrompt) &&
    typeof value.authoringRationale === "string" &&
    isStringArray(value.repairHintsApplied)
  );
}

function isCriterionEvidence(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    hasOnlyKeys(value, [
      "criterionId",
      "outcome",
      "observationCode",
      "evidenceRefs",
    ]) &&
    typeof value.criterionId === "string" &&
    isOneOf(value.outcome, [
      "met",
      "partial",
      "not_met",
      "unscorable",
    ] as const) &&
    isOneOf(value.observationCode, [
      "bounded_evidence_satisfies_criterion",
      "one_evidence_channel_missing",
      "bounded_evidence_does_not_satisfy_criterion",
      "criterion_has_no_deterministic_rule",
      "validated_rep_binding_missing",
      "observable_response_missing",
    ] as const) &&
    isStringArray(value.evidenceRefs)
  );
}

function isAssessResponseOutput(value: unknown): value is AssessResponseOutput {
  if (!isObject(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "evidenceId",
      "responseId",
      "exerciseId",
      "exerciseRevision",
      "episodeRole",
      "validationId",
      "gymSpecHash",
      "assessmentStatus",
      "criterionEvidence",
      "confidenceCalibration",
      "assessorVersion",
      "reasonCodes",
    ])
  ) {
    return false;
  }

  return (
    typeof value.evidenceId === "string" &&
    typeof value.responseId === "string" &&
    typeof value.exerciseId === "string" &&
    Number.isInteger(value.exerciseRevision) &&
    isOneOf(value.episodeRole, EPISODE_ROLES) &&
    typeof value.validationId === "string" &&
    typeof value.gymSpecHash === "string" &&
    isOneOf(value.assessmentStatus, [
      "scored",
      "abstained",
      "needs_more_evidence",
    ] as const) &&
    Array.isArray(value.criterionEvidence) &&
    value.criterionEvidence.every(isCriterionEvidence) &&
    isOneOf(value.confidenceCalibration, [
      "under",
      "aligned",
      "over",
      "unknown",
    ] as const) &&
    typeof value.assessorVersion === "string" &&
    isStringArray(value.reasonCodes)
  );
}

function isDecideNextOutput(value: unknown): value is DecideNextOutput {
  if (!isObject(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "decision",
      "recommendationId",
      "chosenChallengeTemplateId",
      "stimulusReceiptId",
      "stimulusReceiptSha256",
      "episodeRole",
      "actionMode",
      "renderContractId",
      "componentName",
      "componentSchemaVersion",
      "reasonCode",
      "rationale",
      "citedEvidenceIds",
      "provenanceLabel",
    ])
  ) {
    return false;
  }

  return (
    isOneOf(value.decision, [
      "accept",
      "override",
      "deterministic_fallback",
      "block",
    ] as const) &&
    isNullableString(value.recommendationId) &&
    isNullableString(value.chosenChallengeTemplateId) &&
    isNullableString(value.stimulusReceiptId) &&
    isNullableString(value.stimulusReceiptSha256) &&
    (value.episodeRole === null || isOneOf(value.episodeRole, EPISODE_ROLES)) &&
    (value.actionMode === null || isOneOf(value.actionMode, ACTION_MODES)) &&
    isNullableString(value.renderContractId) &&
    (value.componentName === null ||
      isOneOf(value.componentName, GYM_COMPONENT_NAMES)) &&
    isNullableString(value.componentSchemaVersion) &&
    typeof value.reasonCode === "string" &&
    typeof value.rationale === "string" &&
    isStringArray(value.citedEvidenceIds) &&
    isOneOf(value.provenanceLabel, [
      "live_pioneer",
      "codex_override",
      "deterministic_fallback",
      "blocked",
    ] as const)
  );
}

export function parseCodexActionOutput<A extends CodexAction>(
  action: A,
  jsonText: string,
): CodexActionOutputMap[A] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new Error("Codex returned non-JSON structured output", { cause: error });
  }

  const valid =
    action === "interpret_goal"
      ? isInterpretGoalOutput(parsed)
      : action === "author_rep"
        ? isAuthorRepOutput(parsed)
        : action === "assess_response"
          ? isAssessResponseOutput(parsed)
          : isDecideNextOutput(parsed);

  if (!valid) {
    throw new Error(`Codex output failed the ${action} runtime schema check`);
  }

  return parsed as CodexActionOutputMap[A];
}
