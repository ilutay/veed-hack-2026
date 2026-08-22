import { getGymComponentDefinition } from "../contracts/gym-components";

import {
  computeGroundedStimulusProjectionHash,
  computeGymContentHash,
  computePedagogicalPropsHash,
  computeResolvedResponseSchemaHash,
  computeSpotCheckReceiptHash,
  computeTextStimulusManifestHash,
  sha256Hex,
} from "./canonical";
import {
  ValidateExerciseInputSchema,
  type FalSourceRef,
  type GymSpec,
  type TextStimulusManifest,
  type ValidateExerciseInput,
} from "./schemas";

export const PIONEER_TEST_NOW = "2026-08-22T12:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function makeSourceRef(
  rawText: string,
  exactSourceText: string,
  transform: FalSourceRef["transform"],
): FalSourceRef {
  const startIndex = rawText.indexOf(exactSourceText);
  if (startIndex < 0) throw new Error("test source excerpt is missing");
  return {
    providerRequestId: "fal-request:test",
    rawTextSha256: sha256Hex(rawText),
    startUtf8Byte: Buffer.byteLength(rawText.slice(0, startIndex), "utf8"),
    endUtf8Byte:
      Buffer.byteLength(rawText.slice(0, startIndex), "utf8") +
      Buffer.byteLength(exactSourceText, "utf8"),
    exactSourceText,
    transform,
  };
}

export function makeValidateFixture(): {
  input: ValidateExerciseInput;
  rawFalText: string;
} {
  const rawFalText = [
    "headline-role",
    "[0.1,0.1,0.8,0.2]",
    '["title-a"]',
    '["title-a","body-a"]',
  ].join("\n");
  const assetSha = SHA_B;

  const manifestBase = {
    manifestId: "manifest:test",
    manifestVersion: "stimulus-text-v2" as const,
    falReceipt: {
      provider: "fal" as const,
      providerRequestId: "fal-request:test",
      providerModelId: "test-only-fal-text-receipt",
      providerResponseTextSha256: sha256Hex(rawFalText),
      providerResponseUtf8ByteLength: Buffer.byteLength(rawFalText, "utf8"),
      sourceAssetSha256s: [assetSha],
      receivedAt: PIONEER_TEST_NOW,
    },
    observations: [
      {
        variantId: "variant:a",
        sourceAssetSha256: assetSha,
        visibleCopy: [],
        layoutElements: [
          {
            elementId: "title-a",
            semanticRole: {
              value: "headline-role",
              sourceRefs: [
                makeSourceRef(rawFalText, "headline-role", "identity"),
              ],
            },
            normalizedBox: {
              value: [0.1, 0.1, 0.8, 0.2] as [number, number, number, number],
              sourceRefs: [
                makeSourceRef(
                  rawFalText,
                  "[0.1,0.1,0.8,0.2]",
                  "normalize_explicit_coordinates",
                ),
              ],
            },
          },
        ],
        intendedReadingOrder: {
          value: ["title-a"],
          sourceRefs: [
            makeSourceRef(rawFalText, '["title-a"]', "split_explicit_list"),
          ],
        },
        observedSalienceOrder: {
          value: ["title-a", "body-a"],
          sourceRefs: [
            makeSourceRef(
              rawFalText,
              '["title-a","body-a"]',
              "split_explicit_list",
            ),
          ],
        },
        technicalQualityNotes: [],
      },
    ],
    crossVariantParityChecks: [],
    textSource: "fal" as const,
    normalizedBy: "codex_fal_text_adapter" as const,
    normalizerVersion: "test-normalizer-v1",
    manifestSha256: SHA_A,
  };
  const groundedHash = computeGroundedStimulusProjectionHash(
    manifestBase as TextStimulusManifest,
  );
  const spotBase = {
    receiptId: "spot-check:test",
    fixtureId: "fixture:test",
    falProviderRequestId: "fal-request:test",
    falRawTextSha256: sha256Hex(rawFalText),
    sourceAssetSha256s: [assetSha],
    groundedStimulusProjectionSha256: groundedHash,
    checkerRole: "fixture_auditor" as const,
    checkedAt: PIONEER_TEST_NOW,
    result: "pass" as const,
    reasonCodes: [],
    receiptSha256: SHA_A,
  };
  spotBase.receiptSha256 = computeSpotCheckReceiptHash(spotBase);
  const manifest = {
    ...manifestBase,
    spotCheckReceipt: spotBase,
  } as TextStimulusManifest;
  manifest.manifestSha256 = computeTextStimulusManifestHash(manifest);

  const responseJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: { optionId: { type: "string" } },
    required: ["optionId"],
  };
  const responseSchemaSha = computeResolvedResponseSchemaHash(responseJsonSchema);
  const renderProps = {
    prompt: "Which layout has clearer hierarchy?",
    variantIds: ["variant:a"],
  };
  const candidateBase = {
    schemaVersion: "gym-spec-v1" as const,
    exerciseId: "exercise:p1:test",
    challengeTemplateId: "challenge:p1:test",
    revision: 1,
    goalDefinitionId: "goal-definition:test",
    episodeRole: "baseline" as const,
    domain: "visual design",
    subskill: "visual hierarchy",
    contextId: "context:landing-page",
    learningObjective: "Recognize a clear focal point.",
    intendedContrast: "Hierarchy only.",
    invariants: ["copy", "color"],
    variants: [
      {
        variantId: "variant:a",
        assetRefs: [{ assetId: "asset:a", sha256: assetSha }],
        pedagogicalDifference: "Single focal point.",
      },
    ],
    textStimulusManifest: manifest,
    renderFrame: {
      width: 1280,
      height: 720,
      aspectRatio: "16:9",
      learnerVisibleText: ["Which layout has clearer hierarchy?"],
      assistiveText: ["One layout option"],
    },
    actionMode: "choose" as const,
    learnerPrompt: "Choose the layout with the clearest hierarchy.",
    responseContract: {
      schemaId: "response:choice",
      schemaVersion: "v1",
      schemaSha256: responseSchemaSha,
    },
    renderContracts: [
      {
        renderContractId: "render:choice",
        phase: "action" as const,
        componentName: "CompareArena",
        componentSchemaVersion:
          getGymComponentDefinition("CompareArena").schemaVersion,
        pedagogicalProps: renderProps,
        pedagogicalPropsSha256: computePedagogicalPropsHash(renderProps),
      },
    ],
    rubric: {
      rubricId: "rubric:test",
      criteria: [
        {
          criterionId: "criterion:focal-point",
          description: "Identifies the focal point.",
          acceptableEvidence: ["option choice"],
          disallowedShortcuts: ["copy preference"],
          requiredForTransfer: true,
          partialCountsForTransfer: false,
        },
      ],
      allowsMultipleDefensibleAnswers: true,
      assessorVersion: "assessor-v1",
    },
    feedbackPlan: {
      artifactAnchors: ["title-a"],
      revealAfterResponse: true,
      explanationTemplateId: "feedback:test",
    },
    retryPlan: {
      sameSubskill: true as const,
      changedStimulus: true as const,
      allowedActionModes: ["layer_order" as const],
    },
    transferPlan: {
      required: true as const,
      changedContext: "A different composition.",
      changedActionMode: "Order the layers.",
      hiddenUntilSelected: true as const,
      acceptanceRule: {
        ruleVersion: "transfer-rule-v1" as const,
        requiredCriterionIds: ["criterion:focal-point"],
        reasoningRequired: true,
        confidenceIsGate: false as const,
      },
    },
    provenance: {
      authoredBy: "codex" as const,
      authoringPromptVersion: "author-v1",
      assetManifestId: "asset-manifest:test",
      contentHash: SHA_A,
      contentHashVersion: "gym-jcs-v1" as const,
    },
    createdAt: PIONEER_TEST_NOW,
  };
  candidateBase.provenance.contentHash = computeGymContentHash(
    candidateBase as GymSpec,
  );
  const input = ValidateExerciseInputSchema.parse({
    requestId: "request:p1:test",
    scope: {
      kind: "reusable_fixture",
      fixtureId: "fixture:test",
      goalDefinitionId: "goal-definition:test",
    },
    candidate: candidateBase,
    resolvedResponseSchema: {
      ...candidateBase.responseContract,
      jsonSchema: responseJsonSchema,
    },
    validatorPromptVersion: "p1-validator-v1",
  });
  return { input, rawFalText };
}
