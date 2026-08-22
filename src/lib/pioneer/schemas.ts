import { z } from "zod";

import {
  GYM_CONTENT_HASH_VERSION,
  GYM_SPEC_SCHEMA_VERSION,
  getGymComponentDefinition,
  gymComponentNameSchema,
  isGymComponentAllowedForRenderPhase,
} from "../contracts/gym-components";

export const PIONEER_CONTRACT_VERSION = "pioneer-gym-text-v1" as const;
export const P1_SCHEMA_VERSION = "pioneer-validate-rep-v1" as const;
export const P2_SCHEMA_VERSION = "pioneer-recommend-next-v1" as const;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const IdSchema = z.string().regex(ID_PATTERN);
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const BoundedTextSchema = z.string().min(1).max(2_048);
const ShortTextSchema = z.string().min(1).max(512);
const ConfidenceSchema = z.enum(["low", "medium", "high"]);
const EpisodeRoleSchema = z.enum([
  "baseline",
  "diagnostic_probe",
  "retry",
  "held_out_transfer",
]);
const ActionModeSchema = z.enum([
  "choose",
  "edit",
  "rank",
  "layer_order",
  "explain",
]);

export const AllowedFalTransformSchema = z.enum([
  "identity",
  "trim_whitespace",
  "unicode_nfc",
  "exact_enum_map",
  "parse_explicit_number",
  "split_explicit_list",
  "normalize_explicit_coordinates",
  "exact_equality_compare",
]);

export const FalSourceRefSchema = z
  .object({
    providerRequestId: IdSchema,
    rawTextSha256: Sha256Schema,
    startUtf8Byte: z.number().int().nonnegative(),
    endUtf8Byte: z.number().int().positive(),
    exactSourceText: z.string().max(256),
    transform: AllowedFalTransformSchema,
  })
  .strict()
  .superRefine((sourceRef, context) => {
    if (sourceRef.endUtf8Byte <= sourceRef.startUtf8Byte) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endUtf8Byte"],
        message: "endUtf8Byte must be greater than startUtf8Byte",
      });
    }

    if (Buffer.byteLength(sourceRef.exactSourceText, "utf8") > 256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exactSourceText"],
        message: "fal source excerpts are limited to 256 UTF-8 bytes",
      });
    }
  });

export const FalGroundedSchema = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value,
      sourceRefs: z.array(FalSourceRefSchema).min(1).max(8),
    })
    .strict();

export const SpotCheckReceiptSchema = z
  .object({
    receiptId: IdSchema,
    fixtureId: IdSchema,
    falProviderRequestId: IdSchema,
    falRawTextSha256: Sha256Schema,
    sourceAssetSha256s: z.array(Sha256Schema).min(1).max(16),
    groundedStimulusProjectionSha256: Sha256Schema,
    checkerRole: z.literal("fixture_auditor"),
    checkedAt: IsoTimestampSchema,
    result: z.enum(["pass", "fail"]),
    reasonCodes: z.array(IdSchema).max(16),
    receiptSha256: Sha256Schema,
  })
  .strict();

const NormalizedBoxSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const TypographySchema = z
  .object({
    size: z.number().positive().max(1_000),
    weight: z.number().int().min(1).max(1_000),
    lineCount: z.number().int().positive().max(100),
  })
  .strict();

const StimulusObservationSchema = z
  .object({
    variantId: IdSchema,
    sourceAssetSha256: Sha256Schema,
    visibleCopy: z
      .array(
        z
          .object({
            text: FalGroundedSchema(z.string().max(512)),
            normalizedBox: FalGroundedSchema(NormalizedBoxSchema),
          })
          .strict(),
      )
      .max(12),
    layoutElements: z
      .array(
        z
          .object({
            elementId: IdSchema,
            semanticRole: FalGroundedSchema(z.string().max(128)),
            normalizedBox: FalGroundedSchema(NormalizedBoxSchema),
            typography: FalGroundedSchema(TypographySchema).optional(),
          })
          .strict(),
      )
      .max(12),
    intendedReadingOrder: FalGroundedSchema(
      z.array(IdSchema).min(1).max(12),
    ),
    observedSalienceOrder: FalGroundedSchema(
      z.array(IdSchema).min(1).max(12),
    ),
    technicalQualityNotes: z
      .array(FalGroundedSchema(z.string().max(256)))
      .max(12),
  })
  .strict();

export const TextStimulusManifestSchema = z
  .object({
    manifestId: IdSchema,
    manifestVersion: z.literal("stimulus-text-v2"),
    falReceipt: z
      .object({
        provider: z.literal("fal"),
        providerRequestId: IdSchema,
        providerModelId: z.string().min(1).max(128),
        providerResponseTextSha256: Sha256Schema,
        providerResponseUtf8ByteLength: z.number().int().positive(),
        sourceAssetSha256s: z.array(Sha256Schema).min(1).max(16),
        receivedAt: IsoTimestampSchema,
      })
      .strict(),
    observations: z.array(StimulusObservationSchema).min(1).max(2),
    crossVariantParityChecks: z
      .array(
        z
          .object({
            factor: FalGroundedSchema(z.string().max(128)),
            status: FalGroundedSchema(
              z.enum(["equal", "intentionally_varied", "unverified"]),
            ),
            evidence: FalGroundedSchema(z.string().max(256)),
          })
          .strict(),
      )
      .max(16),
    textSource: z.literal("fal"),
    normalizedBy: z.literal("codex_fal_text_adapter"),
    normalizerVersion: IdSchema,
    spotCheckReceipt: SpotCheckReceiptSchema.optional(),
    manifestSha256: Sha256Schema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const variantIds = new Set<string>();
    for (const [index, observation] of manifest.observations.entries()) {
      if (variantIds.has(observation.variantId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations", index, "variantId"],
          message: "variant IDs must be unique",
        });
      }
      variantIds.add(observation.variantId);

      if (!manifest.falReceipt.sourceAssetSha256s.includes(observation.sourceAssetSha256)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations", index, "sourceAssetSha256"],
          message: "observation asset is not bound by the fal receipt",
        });
      }
    }
  });

export const ResponseContractRefSchema = z
  .object({
    schemaId: IdSchema,
    schemaVersion: IdSchema,
    schemaSha256: Sha256Schema,
  })
  .strict();

export const ResolvedResponseSchemaSchema = ResponseContractRefSchema.extend({
  jsonSchema: z.record(z.string(), z.unknown()),
}).strict();

export const RenderContractSchema = z
  .object({
    renderContractId: IdSchema,
    phase: z.enum(["action", "feedback"]),
    componentName: gymComponentNameSchema,
    componentSchemaVersion: IdSchema,
    pedagogicalProps: z.record(z.string(), z.unknown()),
    pedagogicalPropsSha256: Sha256Schema,
  })
  .strict()
  .superRefine((contract, context) => {
    const definition = getGymComponentDefinition(contract.componentName);
    if (contract.componentSchemaVersion !== definition.schemaVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["componentSchemaVersion"],
        message: `component schema version must be ${definition.schemaVersion}`,
      });
    }
    if (
      !isGymComponentAllowedForRenderPhase(
        contract.componentName,
        contract.phase,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["componentName"],
        message: `${contract.componentName} cannot serve the ${contract.phase} render phase`,
      });
    }
  });

export const TransferTemplateBasisSchema = z
  .object({
    sourceChallengeTemplateId: IdSchema,
    sourceExerciseId: IdSchema,
    sourceRevision: z.number().int().positive(),
    sourceContentHash: Sha256Schema,
    sourceSubskill: BoundedTextSchema,
    sourceContextId: IdSchema,
    sourceActionMode: ActionModeSchema,
    requireSameSubskill: z.literal(true),
    requireChangedContext: z.literal(true),
    requireChangedActionMode: z.literal(true),
    requireDisjointStimulusAssets: z.literal(true),
  })
  .strict();

export const RubricSpecSchema = z
  .object({
    rubricId: IdSchema,
    criteria: z
      .array(
        z
          .object({
            criterionId: IdSchema,
            description: BoundedTextSchema,
            acceptableEvidence: z.array(ShortTextSchema).min(1).max(12),
            disallowedShortcuts: z.array(ShortTextSchema).max(12),
            requiredForTransfer: z.boolean(),
            partialCountsForTransfer: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    allowsMultipleDefensibleAnswers: z.boolean(),
    assessorVersion: IdSchema,
  })
  .strict()
  .superRefine((rubric, context) => {
    const criterionIds = new Set<string>();
    for (const [index, criterion] of rubric.criteria.entries()) {
      if (criterionIds.has(criterion.criterionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["criteria", index, "criterionId"],
          message: "criterion IDs must be unique",
        });
      }
      criterionIds.add(criterion.criterionId);
    }
  });

export const GymSpecSchema = z
  .object({
    schemaVersion: z.literal(GYM_SPEC_SCHEMA_VERSION),
    exerciseId: IdSchema,
    challengeTemplateId: IdSchema,
    revision: z.number().int().positive(),
    goalDefinitionId: IdSchema,
    episodeRole: EpisodeRoleSchema,
    domain: BoundedTextSchema,
    subskill: BoundedTextSchema,
    contextId: IdSchema,
    learningObjective: BoundedTextSchema,
    intendedContrast: BoundedTextSchema,
    invariants: z.array(ShortTextSchema).max(16),
    variants: z
      .array(
        z
          .object({
            variantId: IdSchema,
            assetRefs: z
              .array(
                z
                  .object({
                    assetId: IdSchema,
                    sha256: Sha256Schema,
                  })
                  .strict(),
              )
              .min(1)
              .max(8),
            pedagogicalDifference: BoundedTextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(2),
    textStimulusManifest: TextStimulusManifestSchema,
    renderFrame: z
      .object({
        width: z.number().int().positive().max(8_192),
        height: z.number().int().positive().max(8_192),
        aspectRatio: z.string().regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/),
        learnerVisibleText: z.array(ShortTextSchema).max(24),
        assistiveText: z.array(ShortTextSchema).max(24),
      })
      .strict(),
    actionMode: ActionModeSchema,
    learnerPrompt: BoundedTextSchema,
    responseContract: ResponseContractRefSchema,
    renderContracts: z.array(RenderContractSchema).min(1).max(2),
    rubric: RubricSpecSchema,
    feedbackPlan: z
      .object({
        artifactAnchors: z.array(IdSchema).max(24),
        revealAfterResponse: z.boolean(),
        explanationTemplateId: IdSchema,
      })
      .strict(),
    retryPlan: z
      .object({
        sameSubskill: z.literal(true),
        changedStimulus: z.literal(true),
        allowedActionModes: z.array(ActionModeSchema).min(1).max(5),
      })
      .strict(),
    transferPlan: z
      .object({
        required: z.literal(true),
        changedContext: ShortTextSchema,
        changedActionMode: ShortTextSchema,
        hiddenUntilSelected: z.literal(true),
        acceptanceRule: z
          .object({
            ruleVersion: z.literal("transfer-rule-v1"),
            requiredCriterionIds: z.array(IdSchema).max(16),
            reasoningRequired: z.boolean(),
            confidenceIsGate: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    transferTemplateBasis: TransferTemplateBasisSchema.optional(),
    provenance: z
      .object({
        authoredBy: z.literal("codex"),
        authoringPromptVersion: IdSchema,
        assetManifestId: IdSchema,
        contentHash: Sha256Schema,
        contentHashVersion: z.literal(GYM_CONTENT_HASH_VERSION),
      })
      .strict(),
    createdAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((spec, context) => {
    const actionContracts = spec.renderContracts.filter(
      (contract) => contract.phase === "action",
    );
    const feedbackContracts = spec.renderContracts.filter(
      (contract) => contract.phase === "feedback",
    );
    if (actionContracts.length !== 1 || feedbackContracts.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renderContracts"],
        message: "a GymSpec requires exactly one action and at most one feedback contract",
      });
    }

    const isTransfer = spec.episodeRole === "held_out_transfer";
    if (isTransfer !== Boolean(spec.transferTemplateBasis)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transferTemplateBasis"],
        message: "only a held-out transfer requires and may contain transferTemplateBasis",
      });
    }

    const requiredCriteria = spec.rubric.criteria
      .filter((criterion) => criterion.requiredForTransfer)
      .map((criterion) => criterion.criterionId)
      .sort();
    const acceptanceCriteria = [
      ...spec.transferPlan.acceptanceRule.requiredCriterionIds,
    ].sort();
    if (JSON.stringify(requiredCriteria) !== JSON.stringify(acceptanceCriteria)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transferPlan", "acceptanceRule", "requiredCriterionIds"],
        message: "transfer criteria must exactly match rubric criteria marked requiredForTransfer",
      });
    }

    const variantIds = new Set(spec.variants.map((variant) => variant.variantId));
    const observationIds = new Set(
      spec.textStimulusManifest.observations.map((item) => item.variantId),
    );
    if (
      variantIds.size !== observationIds.size ||
      [...variantIds].some((variantId) => !observationIds.has(variantId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["textStimulusManifest", "observations"],
        message: "every candidate variant requires exactly one fal observation",
      });
    }
  });

export const ValidationScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("session_bound"),
      sessionId: IdSchema,
      goalInstanceId: IdSchema,
      goalDefinitionId: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("reusable_fixture"),
      fixtureId: IdSchema,
      goalDefinitionId: IdSchema,
    })
    .strict(),
]);

export const PioneerTextBindingSchema = z
  .object({
    bindingId: IdSchema,
    job: z.enum(["validate_rep", "recommend_next"]),
    schemaVersion: IdSchema,
    requestProjectionSha256: Sha256Schema,
  })
  .strict();

export const PioneerTextBindingEchoSchema = PioneerTextBindingSchema.pick({
  bindingId: true,
  requestProjectionSha256: true,
}).strict();

export const ValidateExerciseRequestSchema = z
  .object({
    requestId: IdSchema,
    binding: PioneerTextBindingSchema.extend({
      job: z.literal("validate_rep"),
    }).strict(),
    scope: ValidationScopeSchema,
    candidate: GymSpecSchema,
    resolvedResponseSchema: ResolvedResponseSchemaSchema,
    transferSourceRep: GymSpecSchema.optional(),
    expectedTransferComparisonHash: Sha256Schema.optional(),
    validatorPromptVersion: IdSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.scope.goalDefinitionId !== request.candidate.goalDefinitionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "goalDefinitionId"],
        message: "validation scope and candidate goalDefinitionId must match",
      });
    }
    const isTransfer = request.candidate.episodeRole === "held_out_transfer";
    const hasTransferInputs = Boolean(
      request.transferSourceRep && request.expectedTransferComparisonHash,
    );
    if (isTransfer !== hasTransferInputs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transferSourceRep"],
        message: "held-out transfer validation requires its source rep and comparison hash",
      });
    }
  });

const ValidateExerciseInputShape = Object.fromEntries(
  Object.entries(ValidateExerciseRequestSchema.shape).filter(
    ([key]) => key !== "binding",
  ),
) as Omit<typeof ValidateExerciseRequestSchema.shape, "binding">;
export const ValidateExerciseInputSchema = z
  .object(ValidateExerciseInputShape)
  .strict();

export const ValidateExerciseResponseSchema = z
  .object({
    validationId: IdSchema,
    requestId: IdSchema,
    bindingEcho: PioneerTextBindingEchoSchema,
    exerciseId: IdSchema,
    exerciseRevision: z.number().int().positive(),
    scope: ValidationScopeSchema,
    goalDefinitionId: IdSchema,
    candidateContentHash: Sha256Schema,
    contentHashVersion: z.literal("gym-jcs-v1"),
    transferComparisonHash: Sha256Schema.optional(),
    judgment: z.enum(["PASS", "REJECT", "ABSTAIN"]),
    intendedTeachingSignal: BoundedTextSchema,
    isolatedFactors: z.array(ShortTextSchema).max(24),
    confounds: z
      .array(
        z
          .object({
            code: IdSchema,
            severity: z.enum(["blocking", "material", "minor"]),
            evidenceRefs: z.array(IdSchema).max(16),
            repairHint: ShortTextSchema,
          })
          .strict(),
      )
      .max(24),
    reasonCodes: z.array(IdSchema).max(24),
    confidence: ConfidenceSchema,
    modelVersion: z.string().min(1).max(128),
    createdAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.judgment === "PASS" &&
      response.confounds.some(
        (confound) =>
          confound.severity === "blocking" || confound.severity === "material",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confounds"],
        message: "PASS cannot contain blocking or material confounds",
      });
    }
  });

export const LearnerStateSnapshotSchema = z
  .object({
    snapshotId: IdSchema,
    sessionId: IdSchema,
    goalInstanceId: IdSchema,
    subskills: z
      .array(
        z
          .object({
            subskill: BoundedTextSchema,
            phase: z.enum([
              "unexplored",
              "diagnosed",
              "practicing",
              "transfer_pending",
              "transfer_shown",
            ]),
            uncertainty: z.enum(["high", "medium", "low"]),
            supportingEvidenceIds: z.array(IdSchema).max(32),
            counterEvidenceIds: z.array(IdSchema).max(32),
            verifiedByEvidenceId: IdSchema.optional(),
          })
          .strict(),
      )
      .max(24),
    derivedBy: z.literal("codex"),
    stateRuleVersion: IdSchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();

const FalGroundedObservationTextSchema = z
  .object({
    textClass: z.literal("fal_grounded_observation"),
    text: z.string().min(1).max(512),
    manifestSha256: Sha256Schema,
    sourceRefs: z.array(FalSourceRefSchema).min(1).max(8),
  })
  .strict();

const HumanClaimTextSchema = z
  .object({
    textClass: z.literal("human_claim"),
    text: z.string().min(1).max(512),
    sourceKind: z.enum(["learning_prompt", "human_response"]),
    sourceId: IdSchema,
  })
  .strict();

const AssessorOutcomeTextSchema = z
  .object({
    textClass: z.literal("assessor_outcome"),
    text: z.string().min(1).max(512),
    criterionId: IdSchema,
    outcome: z.enum(["met", "partial", "not_met", "unscorable"]),
    evidenceRefs: z.array(IdSchema).max(16),
    falSourceRefs: z.array(FalSourceRefSchema).min(1).max(8).optional(),
  })
  .strict();

export const AuthoringIntentTextSchema = z
  .object({
    textClass: z.literal("authoring_intent"),
    text: z.string().min(1).max(512),
    authorityKind: z.enum([
      "goal_definition",
      "gym_spec",
      "challenge_template",
    ]),
    authorityId: IdSchema,
    authorityHash: Sha256Schema.optional(),
  })
  .strict();

export const PioneerEvidenceTextSchema = z.discriminatedUnion("textClass", [
  FalGroundedObservationTextSchema,
  HumanClaimTextSchema,
  AssessorOutcomeTextSchema,
  AuthoringIntentTextSchema,
]);

export const PioneerEvidenceProjectionSchema = z
  .object({
    evidenceId: IdSchema,
    exerciseId: IdSchema,
    exerciseRevision: z.number().int().positive(),
    validationId: IdSchema,
    gymSpecHash: Sha256Schema,
    episodeRole: EpisodeRoleSchema,
    actionValue: z.unknown(),
    statedConfidence: ConfidenceSchema,
    assessmentStatus: z.enum([
      "scored",
      "abstained",
      "needs_more_evidence",
    ]),
    texts: z.array(PioneerEvidenceTextSchema).max(32),
  })
  .strict();

export const PioneerGoalProjectionSchema = z
  .object({
    goalInstanceId: IdSchema,
    goalDefinitionId: IdSchema,
    supportStatus: z.enum([
      "supported",
      "mapped_with_explanation",
      "unsupported",
    ]),
    sessionTimeboxSeconds: z.number().int().positive().max(3_600),
    texts: z
      .array(z.union([HumanClaimTextSchema, AuthoringIntentTextSchema]))
      .min(1)
      .max(12),
  })
  .strict();

export const EligibleChallengeMetadataSchema = z
  .object({
    challengeTemplateId: IdSchema,
    subskill: BoundedTextSchema,
    allowedEpisodeRoles: z
      .array(z.enum(["diagnostic_probe", "retry", "held_out_transfer"]))
      .min(1)
      .max(3),
    actionMode: ActionModeSchema,
    difficulty: z.enum(["easier", "adjacent", "harder"]),
    preserve: z.array(AuthoringIntentTextSchema).max(12),
    vary: z.array(AuthoringIntentTextSchema).max(12),
    removeShortcuts: z.array(AuthoringIntentTextSchema).max(12),
    assetManifestId: IdSchema,
    estimatedSeconds: z.number().int().positive().max(3_600),
    prevalidatedSpec: z
      .object({
        fixtureId: IdSchema,
        validationScope: z.literal("reusable_fixture"),
        goalDefinitionId: IdSchema,
        exerciseId: IdSchema,
        revision: z.number().int().positive(),
        validationId: IdSchema,
        contentHash: Sha256Schema,
        responseSchemaSha256: Sha256Schema,
        transferComparisonHash: Sha256Schema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const RecommendNextRequestSchema = z
  .object({
    requestId: IdSchema,
    binding: PioneerTextBindingSchema.extend({
      job: z.literal("recommend_next"),
    }).strict(),
    sessionId: IdSchema,
    goal: PioneerGoalProjectionSchema,
    learnerState: LearnerStateSnapshotSchema,
    latestEvidence: z.array(PioneerEvidenceProjectionSchema).min(1).max(3),
    validatedExerciseMetadata: z
      .array(
        z
          .object({
            exerciseId: IdSchema,
            revision: z.number().int().positive(),
            validationId: IdSchema,
            subskill: BoundedTextSchema,
            episodeRole: EpisodeRoleSchema,
          })
          .strict(),
      )
      .max(16),
    eligibleChallenges: z
      .array(EligibleChallengeMetadataSchema)
      .min(1)
      .max(6),
    maxEstimatedSeconds: z.number().int().positive().max(3_600),
    policyPromptVersion: IdSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const textCount =
      request.goal.texts.length +
      request.latestEvidence.reduce(
        (count, evidence) => count + evidence.texts.length,
        0,
      ) +
      request.eligibleChallenges.reduce(
        (count, challenge) =>
          count +
          challenge.preserve.length +
          challenge.vary.length +
          challenge.removeShortcuts.length,
        0,
      );
    if (textCount > 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latestEvidence"],
        message: "P2 accepts at most 32 classified text entries in total",
      });
    }

    const challengeIds = new Set<string>();
    for (const [index, challenge] of request.eligibleChallenges.entries()) {
      if (challengeIds.has(challenge.challengeTemplateId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eligibleChallenges", index, "challengeTemplateId"],
          message: "eligible challenge IDs must be unique",
        });
      }
      challengeIds.add(challenge.challengeTemplateId);
    }

    if (request.goal.goalInstanceId !== request.learnerState.goalInstanceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["learnerState", "goalInstanceId"],
        message: "goal and learner state instances must match",
      });
    }
    if (request.sessionId !== request.learnerState.sessionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["learnerState", "sessionId"],
        message: "request and learner state sessions must match",
      });
    }
  });

const RecommendNextInputShape = Object.fromEntries(
  Object.entries(RecommendNextRequestSchema.shape).filter(
    ([key]) => key !== "binding",
  ),
) as Omit<typeof RecommendNextRequestSchema.shape, "binding">;
export const RecommendNextInputSchema = z.object(RecommendNextInputShape).strict();

export const NextChallengeRecommendationSchema = z
  .object({
    recommendationId: IdSchema,
    requestId: IdSchema,
    bindingEcho: PioneerTextBindingEchoSchema,
    recommendedSubskill: BoundedTextSchema,
    recommendedActionMode: ActionModeSchema,
    recommendedChallengeTemplateId: IdSchema,
    episodeRole: z.enum(["retry", "held_out_transfer", "diagnostic_probe"]),
    challengeProfile: z
      .object({
        preserve: z.array(ShortTextSchema).max(12),
        vary: z.array(ShortTextSchema).max(12),
        removeShortcuts: z.array(ShortTextSchema).max(12),
        targetDifficulty: z.enum(["easier", "adjacent", "harder"]),
      })
      .strict(),
    rationale: BoundedTextSchema,
    evidenceIds: z.array(IdSchema).min(1).max(16),
    uncertaintyToResolve: BoundedTextSchema,
    confidence: ConfidenceSchema,
    alternative: z
      .object({
        subskill: BoundedTextSchema,
        actionMode: ActionModeSchema,
        reason: ShortTextSchema,
      })
      .strict()
      .optional(),
    modelVersion: z.string().min(1).max(128),
    createdAt: IsoTimestampSchema,
  })
  .strict();

export type FalSourceRef = z.infer<typeof FalSourceRefSchema>;
export type AllowedFalTransform = z.infer<
  typeof AllowedFalTransformSchema
>;
export type TextStimulusManifest = z.infer<typeof TextStimulusManifestSchema>;
export type GymSpec = z.infer<typeof GymSpecSchema>;
export type ValidateExerciseInput = z.input<typeof ValidateExerciseInputSchema>;
export type ValidateExerciseRequest = z.infer<typeof ValidateExerciseRequestSchema>;
export type ValidateExerciseResponse = z.infer<typeof ValidateExerciseResponseSchema>;
export type RecommendNextInput = z.input<typeof RecommendNextInputSchema>;
export type RecommendNextRequest = z.infer<typeof RecommendNextRequestSchema>;
export type NextChallengeRecommendation = z.infer<
  typeof NextChallengeRecommendationSchema
>;
export type EligibleChallengeMetadata = z.infer<
  typeof EligibleChallengeMetadataSchema
>;
