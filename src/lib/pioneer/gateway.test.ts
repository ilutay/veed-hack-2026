import { describe, expect, it, vi } from "vitest";

import { canonicalizeJson } from "./canonical";
import { createPioneerTextGateway, PioneerGatewayError } from "./gateway";
import { makeValidateFixture } from "./gateway.test-fixtures";
import {
  RecommendNextInputSchema,
  type RecommendNextInput,
  type RecommendNextRequest,
  type ValidateExerciseInput,
  type ValidateExerciseRequest,
} from "./schemas";

const NOW = "2026-08-22T12:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function makeRecommendInput(): RecommendNextInput {
  return RecommendNextInputSchema.parse({
    requestId: "request:p2:test",
    sessionId: "session:test",
    goal: {
      goalInstanceId: "goal-instance:test",
      goalDefinitionId: "goal-definition:test",
      supportStatus: "supported",
      sessionTimeboxSeconds: 90,
      texts: [
        {
          textClass: "human_claim",
          text: "I want to learn visual hierarchy.",
          sourceKind: "learning_prompt",
          sourceId: "prompt:test",
        },
      ],
    },
    learnerState: {
      snapshotId: "snapshot:test",
      sessionId: "session:test",
      goalInstanceId: "goal-instance:test",
      subskills: [
        {
          subskill: "visual hierarchy",
          phase: "diagnosed",
          uncertainty: "high",
          supportingEvidenceIds: ["evidence:test"],
          counterEvidenceIds: [],
        },
      ],
      derivedBy: "codex",
      stateRuleVersion: "state-rule-v1",
      createdAt: NOW,
    },
    latestEvidence: [
      {
        evidenceId: "evidence:test",
        exerciseId: "exercise:test",
        exerciseRevision: 1,
        validationId: "validation:test",
        gymSpecHash: SHA_A,
        episodeRole: "baseline",
        actionValue: { optionId: "option:b" },
        statedConfidence: "medium",
        assessmentStatus: "scored",
        texts: [
          {
            textClass: "human_claim",
            text: "Option B has a clearer focal point.",
            sourceKind: "human_response",
            sourceId: "response:test",
          },
        ],
      },
    ],
    validatedExerciseMetadata: [
      {
        exerciseId: "exercise:test",
        revision: 1,
        validationId: "validation:test",
        subskill: "visual hierarchy",
        episodeRole: "baseline",
      },
    ],
    eligibleChallenges: [
      {
        challengeTemplateId: "challenge:retry",
        subskill: "visual hierarchy",
        allowedEpisodeRoles: ["retry"],
        actionMode: "layer_order",
        difficulty: "easier",
        preserve: [
          {
            textClass: "authoring_intent",
            text: "Keep the target subskill fixed.",
            authorityKind: "challenge_template",
            authorityId: "challenge:retry",
          },
        ],
        vary: [
          {
            textClass: "authoring_intent",
            text: "Use a new stimulus.",
            authorityKind: "challenge_template",
            authorityId: "challenge:retry",
          },
        ],
        removeShortcuts: [],
        assetManifestId: "asset-manifest:retry",
        estimatedSeconds: 20,
        prevalidatedSpec: {
          fixtureId: "fixture:retry",
          validationScope: "reusable_fixture",
          goalDefinitionId: "goal-definition:test",
          exerciseId: "exercise:retry",
          revision: 1,
          validationId: "validation:retry",
          contentHash: SHA_B,
          responseSchemaSha256: SHA_A,
        },
      },
    ],
    maxEstimatedSeconds: 25,
    policyPromptVersion: "p2-policy-v1",
  });
}

function mockCompletion<TRequest extends Record<string, unknown>>(
  buildContent: (request: TRequest) => Record<string, unknown>,
) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages).toHaveLength(1);
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.tools).toBeUndefined();
    const envelope = JSON.parse(body.messages[0].content) as {
      request: TRequest;
    };
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(buildContent(envelope.request)) } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

describe("PioneerTextGateway", () => {
  it("canonicalizes objects deterministically", () => {
    expect(canonicalizeJson({ z: 1, a: [true, "x"] })).toBe(
      '{"a":[true,"x"],"z":1}',
    );
  });

  it("rejects an unregistered render component before P1 transport", async () => {
    const { input } = makeValidateFixture();
    const invalidInput = structuredClone(input) as unknown as {
      candidate: { renderContracts: Array<{ componentName: string }> };
    };
    invalidInput.candidate.renderContracts[0].componentName = "ContrastChoice";
    const fetchImpl = vi.fn();
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
    });

    await expect(
      gateway.validateExercise(invalidInput as unknown as ValidateExerciseInput),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses an explicit non-live P1 fallback when configuration is absent", async () => {
    const { input } = makeValidateFixture();
    const gateway = createPioneerTextGateway({
      workflowMode: "dry-run",
      apiKey: "",
      model: "",
    });
    const result = await gateway.validateExercise(input);
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.fallback).toMatchObject({
        judgment: "ABSTAIN",
        reason: "dry_run",
      });
    }
    expect(result.receipt).toMatchObject({
      textParts: 1,
      multimodalParts: 0,
      toolCount: 0,
    });
  });

  it("sends one text message and accepts a strictly bound live P1 response", async () => {
    const { input, rawFalText } = makeValidateFixture();
    const fetchImpl = mockCompletion<ValidateExerciseRequest>((request) => ({
      validationId: "validation:p1:live",
      requestId: request.requestId,
      bindingEcho: {
        bindingId: request.binding.bindingId,
        requestProjectionSha256: request.binding.requestProjectionSha256,
      },
      exerciseId: request.candidate.exerciseId,
      exerciseRevision: request.candidate.revision,
      scope: request.scope,
      goalDefinitionId: request.candidate.goalDefinitionId,
      candidateContentHash: request.candidate.provenance.contentHash,
      contentHashVersion: "gym-jcs-v1",
      judgment: "PASS",
      intendedTeachingSignal: "Recognize a clear focal point.",
      isolatedFactors: ["hierarchy"],
      confounds: [],
      reasonCodes: ["signal_isolated"],
      confidence: "high",
      modelVersion: "pioneer-test",
      createdAt: NOW,
    }));
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      resolveFalText: () => rawFalText,
    });
    const result = await gateway.validateExercise(input);
    expect(result.kind).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts a supplied eligible P2 recommendation and no executable command", async () => {
    const input = makeRecommendInput();
    const fetchImpl = mockCompletion<RecommendNextRequest>((request) => ({
      recommendationId: "recommendation:p2:live",
      requestId: request.requestId,
      bindingEcho: {
        bindingId: request.binding.bindingId,
        requestProjectionSha256: request.binding.requestProjectionSha256,
      },
      recommendedSubskill: "visual hierarchy",
      recommendedActionMode: "layer_order",
      recommendedChallengeTemplateId: "challenge:retry",
      episodeRole: "retry",
      challengeProfile: {
        preserve: ["Keep the target subskill fixed."],
        vary: ["Use a new stimulus."],
        removeShortcuts: [],
        targetDifficulty: "easier",
      },
      rationale: "The learner needs a more observable focal-point decision.",
      evidenceIds: ["evidence:test"],
      uncertaintyToResolve: "Whether the learner can construct hierarchy.",
      confidence: "medium",
      modelVersion: "pioneer-test",
      createdAt: NOW,
    }));
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      resolveFalText: () => null,
    });
    const result = await gateway.recommendNext(input);
    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.response.recommendedChallengeTemplateId).toBe(
        "challenge:retry",
      );
      expect(result.response).not.toHaveProperty("componentName");
      expect(result.response).not.toHaveProperty("tool");
    }
  });

  it("fails closed on a mismatched binding echo", async () => {
    const input = makeRecommendInput();
    const fetchImpl = mockCompletion<RecommendNextRequest>((request) => ({
      recommendationId: "recommendation:p2:bad-echo",
      requestId: request.requestId,
      bindingEcho: {
        bindingId: "bind:wrong",
        requestProjectionSha256: request.binding.requestProjectionSha256,
      },
      recommendedSubskill: "visual hierarchy",
      recommendedActionMode: "layer_order",
      recommendedChallengeTemplateId: "challenge:retry",
      episodeRole: "retry",
      challengeProfile: {
        preserve: ["Keep the target subskill fixed."],
        vary: ["Use a new stimulus."],
        removeShortcuts: [],
        targetDifficulty: "easier",
      },
      rationale: "Retry.",
      evidenceIds: ["evidence:test"],
      uncertaintyToResolve: "Construction skill.",
      confidence: "low",
      modelVersion: "pioneer-test",
      createdAt: NOW,
    }));
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      resolveFalText: () => null,
    });
    const result = await gateway.recommendNext(input);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "fallback",
      fallback: { reason: "binding_mismatch" },
    });
    expect(gateway.getTransportRecord("request:p2:test")).toMatchObject({
      status: "invalid_response",
      fallbackReason: "binding_mismatch",
      receipt: { textParts: 1, multimodalParts: 0, toolCount: 0 },
    });
  });

  it("rejects URL-bearing evidence before transport", async () => {
    const input = makeRecommendInput();
    input.goal.texts[0].text = "Inspect https://invalid.example as the stimulus.";
    const gateway = createPioneerTextGateway({ workflowMode: "dry-run" });
    await expect(gateway.recommendNext(input)).rejects.toBeInstanceOf(
      PioneerGatewayError,
    );
  });

  it("enforces the exact application token bound before transport", async () => {
    const input = makeRecommendInput();
    const fetchImpl = vi.fn();
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      resolveFalText: () => null,
      countTokens: () => ({ count: 6_001, tokenizerId: "test-tokenizer" }),
    });
    await expect(gateway.recommendNext(input)).rejects.toMatchObject({
      code: "request_too_large",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
