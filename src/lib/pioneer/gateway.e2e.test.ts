import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createPioneerTextGateway } from "./gateway";
import {
  makeValidateFixture,
  PIONEER_TEST_NOW,
} from "./gateway.test-fixtures";
import {
  RecommendNextInputSchema,
  type RecommendNextInput,
  type RecommendNextRequest,
  type ValidateExerciseRequest,
} from "./schemas";

const NOW = "2026-08-22T12:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function makeRecommendInput(): RecommendNextInput {
  return RecommendNextInputSchema.parse({
    requestId: "request:p2:e2e",
    sessionId: "session:e2e",
    goal: {
      goalInstanceId: "goal-instance:e2e",
      goalDefinitionId: "visual-hierarchy.short-form-v1",
      supportStatus: "supported",
      sessionTimeboxSeconds: 90,
      texts: [
        {
          textClass: "human_claim",
          text: "Teach me to make visual hierarchy decisions.",
          sourceKind: "learning_prompt",
          sourceId: "prompt:e2e",
        },
      ],
    },
    learnerState: {
      snapshotId: "snapshot:e2e",
      sessionId: "session:e2e",
      goalInstanceId: "goal-instance:e2e",
      subskills: [
        {
          subskill: "visual hierarchy",
          phase: "diagnosed",
          uncertainty: "high",
          supportingEvidenceIds: ["evidence:e2e"],
          counterEvidenceIds: [],
        },
      ],
      derivedBy: "codex",
      stateRuleVersion: "state-rule-v1",
      createdAt: NOW,
    },
    latestEvidence: [
      {
        evidenceId: "evidence:e2e",
        exerciseId: "exercise:e2e",
        exerciseRevision: 1,
        validationId: "validation:e2e",
        gymSpecHash: SHA_A,
        episodeRole: "baseline",
        actionValue: { optionId: "frame-b" },
        statedConfidence: "medium",
        assessmentStatus: "scored",
        texts: [
          {
            textClass: "human_claim",
            text: "Frame B establishes one focal point.",
            sourceKind: "human_response",
            sourceId: "response:e2e",
          },
        ],
      },
    ],
    validatedExerciseMetadata: [
      {
        exerciseId: "exercise:e2e",
        revision: 1,
        validationId: "validation:e2e",
        subskill: "visual hierarchy",
        episodeRole: "baseline",
      },
    ],
    eligibleChallenges: [
      {
        challengeTemplateId: "challenge:retry:e2e",
        subskill: "visual hierarchy",
        allowedEpisodeRoles: ["retry"],
        actionMode: "layer_order",
        difficulty: "easier",
        preserve: [
          {
            textClass: "authoring_intent",
            text: "Keep the target subskill fixed.",
            authorityKind: "challenge_template",
            authorityId: "challenge:retry:e2e",
          },
        ],
        vary: [
          {
            textClass: "authoring_intent",
            text: "Use a new stimulus.",
            authorityKind: "challenge_template",
            authorityId: "challenge:retry:e2e",
          },
        ],
        removeShortcuts: [],
        assetManifestId: "asset-manifest:retry:e2e",
        estimatedSeconds: 20,
        prevalidatedSpec: {
          fixtureId: "fixture:retry:e2e",
          validationScope: "reusable_fixture",
          goalDefinitionId: "visual-hierarchy.short-form-v1",
          exerciseId: "exercise:retry:e2e",
          revision: 1,
          validationId: "validation:retry:e2e",
          contentHash: SHA_B,
          responseSchemaSha256: SHA_A,
        },
      },
    ],
    maxEstimatedSeconds: 25,
    policyPromptVersion: "p2-curriculum-optimizer-v1",
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseOneTextOnlyMessage(rawBody: string): unknown {
  const body = JSON.parse(rawBody) as {
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown;
    tool_choice?: unknown;
  };
  expect(Object.keys(body).sort()).toEqual([
    "messages",
    "model",
    "stream",
    "temperature",
  ]);
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]).toEqual({
    role: "user",
    content: expect.any(String),
  });
  expect(body.tools).toBeUndefined();
  expect(body.tool_choice).toBeUndefined();

  const content = body.messages[0].content as string;
  expect(content).not.toMatch(
    /https?:\/\/|file:\/\/|blob:|data:[^,;]+;base64,|\bwww\./i,
  );
  return JSON.parse(content) as unknown;
}

function makeP1Response(
  request: ValidateExerciseRequest,
  bindingId = request.binding.bindingId,
): Record<string, unknown> {
  return {
    validationId: "validation:p1:e2e",
    requestId: request.requestId,
    bindingEcho: {
      bindingId,
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
    createdAt: PIONEER_TEST_NOW,
  };
}

const openServers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  openServers.clear();
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  openServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("loopback Pioneer server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}

describe("PioneerTextGateway E2E", () => {
  it("uses real fetch and HTTP for one strictly bound P1 text message", async () => {
    const { input, rawFalText } = makeValidateFixture();
    let callCount = 0;
    let resolveHandled!: () => void;
    const handled = new Promise<void>((resolve) => {
      resolveHandled = resolve;
    });

    const endpoint = await listen(async (request, response) => {
      callCount += 1;
      try {
        expect(request.method).toBe("POST");
        expect(request.headers["x-api-key"]).toBe("TEST_ONLY");

        const envelope = parseOneTextOnlyMessage(
          await readBody(request),
        ) as {
          job: string;
          request: ValidateExerciseRequest;
        };
        expect(envelope.job).toBe("validate_rep");
        expect(envelope.request.requestId).toBe("request:p1:test");

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(makeP1Response(envelope.request)),
                },
              },
            ],
          }),
        );
      } finally {
        resolveHandled();
      }
    });

    const gateway = createPioneerTextGateway({
      workflowMode: "test",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl: (_fixedEndpoint, init) => fetch(endpoint, init),
      resolveFalText: () => rawFalText,
    });

    const result = await gateway.validateExercise(input);
    await handled;

    expect(result.kind).toBe("live");
    expect(callCount).toBe(1);
    if (result.kind === "live") {
      expect(result.response.judgment).toBe("PASS");
      expect(result.response.bindingEcho.bindingId).toBe(result.receipt.bindingId);
      expect(result.response).not.toHaveProperty("tool");
    }
    expect(gateway.getTransportRecord("request:p1:test")).toMatchObject({
      status: "live_complete",
      receipt: {
        textParts: 1,
        multimodalParts: 0,
        toolCount: 0,
      },
    });
  });

  it("fails P1 closed after one HTTP call when Pioneer breaks the binding", async () => {
    const { input, rawFalText } = makeValidateFixture();
    let callCount = 0;

    const endpoint = await listen(async (request, response) => {
      callCount += 1;
      const envelope = parseOneTextOnlyMessage(await readBody(request)) as {
        job: string;
        request: ValidateExerciseRequest;
      };
      expect(envelope.job).toBe("validate_rep");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  makeP1Response(envelope.request, "bind:wrong"),
                ),
              },
            },
          ],
        }),
      );
    });

    const gateway = createPioneerTextGateway({
      workflowMode: "test",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl: (_fixedEndpoint, init) => fetch(endpoint, init),
      resolveFalText: () => rawFalText,
    });

    const result = await gateway.validateExercise(input);

    expect(callCount).toBe(1);
    expect(result).toMatchObject({
      kind: "fallback",
      fallback: {
        judgment: "ABSTAIN",
        action: "use_prevalidated_fixture_or_block",
        reason: "binding_mismatch",
      },
    });
    const record = gateway.getTransportRecord("request:p1:test");
    expect(record).toMatchObject({
      status: "invalid_response",
      fallbackReason: "binding_mismatch",
      receipt: { textParts: 1, multimodalParts: 0, toolCount: 0 },
    });
    expect(record?.exactResponseText).toContain('"bindingId":"bind:wrong"');
  });

  it("uses real fetch and HTTP while keeping P2 text-only and curriculum-bounded", async () => {
    let callCount = 0;
    let resolveHandled!: () => void;
    const handled = new Promise<void>((resolve) => {
      resolveHandled = resolve;
    });

    const endpoint = await listen(async (request, response) => {
      callCount += 1;
      try {
        expect(request.method).toBe("POST");
        expect(request.headers["x-api-key"]).toBe("TEST_ONLY");

        const envelope = parseOneTextOnlyMessage(await readBody(request)) as {
          job: string;
          request: RecommendNextRequest;
        };
        expect(envelope.job).toBe("recommend_next");
        expect(envelope.request.eligibleChallenges).toHaveLength(1);

        const requestBody = envelope.request;
        const content = {
          recommendationId: "recommendation:p2:e2e",
          requestId: requestBody.requestId,
          bindingEcho: {
            bindingId: requestBody.binding.bindingId,
            requestProjectionSha256:
              requestBody.binding.requestProjectionSha256,
          },
          recommendedSubskill: "visual hierarchy",
          recommendedActionMode: "layer_order",
          recommendedChallengeTemplateId: "challenge:retry:e2e",
          episodeRole: "retry",
          challengeProfile: {
            preserve: ["Keep the target subskill fixed."],
            vary: ["Use a new stimulus."],
            removeShortcuts: [],
            targetDifficulty: "easier",
          },
          rationale:
            "This certified retry offers the greatest expected learning gain at the current edge.",
          evidenceIds: ["evidence:e2e"],
          uncertaintyToResolve:
            "Whether the learner can construct hierarchy in a fresh stimulus.",
          confidence: "medium",
          modelVersion: "pioneer-test",
          createdAt: NOW,
        };

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(content) } }],
          }),
        );
      } finally {
        resolveHandled();
      }
    });

    const gateway = createPioneerTextGateway({
      workflowMode: "test",
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl: (_fixedEndpoint, init) => fetch(endpoint, init),
      resolveFalText: () => null,
    });

    const result = await gateway.recommendNext(makeRecommendInput());
    await handled;

    expect(result.kind).toBe("live");
    expect(callCount).toBe(1);
    if (result.kind === "live") {
      expect(result.response.recommendedChallengeTemplateId).toBe(
        "challenge:retry:e2e",
      );
      expect(result.response).not.toHaveProperty("componentName");
      expect(result.response).not.toHaveProperty("tool");
    }

    expect(gateway.getTransportRecord("request:p2:e2e")).toMatchObject({
      status: "live_complete",
      receipt: {
        textParts: 1,
        multimodalParts: 0,
        toolCount: 0,
      },
    });
  });
});
