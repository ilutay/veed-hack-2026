import { describe, expect, it, vi } from "vitest";

import type {
  CodexAction,
  CodexActionRunResult,
  DecideNextOutput,
  InterpretGoalOutput,
} from "../codex/types";
import type { RecommendNextRequest } from "../pioneer/schemas";

import { getGymFixture } from "./fixture-inventory";
import {
  LiveGymCodexClient,
  LiveGymPioneerClient,
} from "./live-providers";
import type {
  BindPioneerChoiceInput,
  ChooseNextInput,
  ProviderCallContext,
} from "./providers";
import { createGymRuntime } from "./runtime";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function context(signal = new AbortController().signal): ProviderCallContext {
  return { signal, deadlineMs: 800 };
}

function liveResult<A extends CodexAction>(
  action: A,
  output: CodexActionRunResult<A>["output"],
): CodexActionRunResult<A> {
  return {
    action,
    source: "codex_sdk",
    output,
    skillReceipts: [],
    fallbackReason: null,
    usage: null,
  };
}

function interpretOutput(): InterpretGoalOutput {
  return {
    goalInstanceId: "goal_1",
    goalDefinitionId: "visual-hierarchy.short-form-v1",
    rawPrompt: "Teach me intentional product-video hierarchy.",
    domain: "short-form product video",
    targetCapability: "intentional visual hierarchy",
    intendedUse: "make faster product-video decisions",
    currentLevel: "unknown",
    sessionTimeboxSeconds: 90,
    constraints: ["bounded observable responses"],
    supportStatus: "mapped_with_explanation",
    interpretationShownToHuman: "We will practice focal ordering.",
    clarificationQuestion: null,
  };
}

function bindInput(): BindPioneerChoiceInput {
  return {
    sessionId: "session_1",
    goalInstanceId: "goal_1",
    currentSubskill: "focal ordering",
    currentPhase: "diagnosed",
    recommendation: {
      recommendationId: "recommendation_1",
      recommendedSubskill: "focal ordering",
      recommendedActionMode: "choose",
      recommendedChallengeTemplateId: "retry_focal_order_v1",
      episodeRole: "retry",
      rationale: "Resolve the observed focal-order edge.",
      evidenceIds: ["evidence_1"],
      confidence: "medium",
      provenance: "live",
    },
    eligibleChallengeTemplateIds: [
      "retry_focal_order_v1",
      "transfer_layer_order_v1",
    ],
    latestEvidenceIds: ["evidence_1"],
  };
}

function acceptedDecision(): DecideNextOutput {
  const fixture = getGymFixture("retry_focal_order_v1");
  return {
    decision: "accept",
    recommendationId: "recommendation_1",
    chosenChallengeTemplateId: fixture.challengeTemplateId,
    stimulusReceiptId: fixture.fixtureReceiptId,
    stimulusReceiptSha256: fixture.fixtureContentHash,
    episodeRole: fixture.episodeRole,
    actionMode: fixture.actionMode,
    renderContractId: "render_retry_focal_order_v1_v1",
    componentName: fixture.componentName,
    componentSchemaVersion: "targeted-retry-gym-v1",
    reasonCode: "pioneer_choice_bound",
    rationale: "Bound the exact live Pioneer choice.",
    citedEvidenceIds: ["evidence_1"],
    provenanceLabel: "live_pioneer",
  };
}

function chooseInput(): ChooseNextInput {
  return {
    sessionId: "session_1",
    goalInstanceId: "goal_1",
    goalDefinitionId: "visual-hierarchy.short-form-v1",
    currentSubskill: "focal ordering",
    latestEvidence: {
      evidenceId: "evidence_1",
      exerciseId: "exercise_baseline_hierarchy_v1",
      challengeTemplateId: "baseline_hierarchy_v1",
      episodeRole: "baseline",
      actionValue: { choiceId: "frame-a" },
      criterionOutcomes: [
        { criterionId: "focal-order", outcome: "not_met" },
      ],
      statedConfidence: "high",
      assessmentProvenance: "deterministic_rubric_policy",
    },
    eligibleChallengeTemplateIds: [
      "retry_focal_order_v1",
      "transfer_layer_order_v1",
    ],
    maxEstimatedSeconds: 35,
  };
}

describe("LiveGymCodexClient", () => {
  it("sends only typed TeamBox actions and accepts exact codex_sdk outputs", async () => {
    const signal = new AbortController().signal;
    const run = vi.fn(async (request: { action: CodexAction }) => {
      if (request.action === "interpret_goal") {
        return liveResult("interpret_goal", interpretOutput());
      }
      return liveResult("decide_next", acceptedDecision());
    });
    const client = new LiveGymCodexClient({
      gateway: { run } as never,
      socketReady: () => true,
    });

    await expect(
      client.interpretGoal(
        {
          sessionId: "session_1",
          goalInstanceId: "goal_1",
          rawPrompt: "Teach me intentional product-video hierarchy.",
          sessionTimeboxSeconds: 90,
        },
        context(signal),
      ),
    ).resolves.toEqual(interpretOutput());
    await expect(
      client.bindPioneerChoice(bindInput(), context(signal)),
    ).resolves.toMatchObject({
      decision: "accept",
      chosenChallengeTemplateId: "retry_focal_order_v1",
      executionProvenance: "live",
    });

    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: "interpret_goal" }),
      { signal },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "decide_next",
        fallbackChallengeTemplateId: null,
        pioneerRecommendation: expect.objectContaining({
          recommendedChallengeTemplateId: "retry_focal_order_v1",
        }),
      }),
      { signal },
    );
  });

  it("rejects a Codex output that replaces Pioneer's exact choice", async () => {
    const run = vi.fn(async () =>
      liveResult("decide_next", {
        ...acceptedDecision(),
        chosenChallengeTemplateId: "transfer_layer_order_v1",
      }),
    );
    const client = new LiveGymCodexClient({
      gateway: { run } as never,
      socketReady: () => true,
    });

    await expect(
      client.bindPioneerChoice(bindInput(), context()),
    ).rejects.toThrow("exact evidence-bound Pioneer curriculum choice");
  });
});

describe("LiveGymPioneerClient", () => {
  it("labels immutable P1 fixture validation as prevalidated, never live", async () => {
    const fixture = getGymFixture("baseline_hierarchy_v1");
    const client = new LiveGymPioneerClient({
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl: vi.fn(),
    });

    await expect(
      client.validateTeachingSignal(
        {
          sessionId: "session_1",
          goalInstanceId: "goal_1",
          goalDefinitionId: "visual-hierarchy.short-form-v1",
          challengeTemplateId: fixture.challengeTemplateId,
          exerciseId: fixture.exerciseId,
          intendedTeachingSignal: fixture.subskill,
          fixtureReceiptId: fixture.fixtureReceiptId,
          fixtureContentHash: fixture.fixtureContentHash,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      judgment: "PASS",
      provenance: "prevalidated",
      reasonCodes: ["prevalidated_fixture_exact_hash"],
    });
  });

  it("runs live P2 as one text-only, curriculum-bounded Pioneer call", async () => {
    let transportSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn(
      async (_resource: RequestInfo | URL, init?: RequestInit) => {
        transportSignal = init?.signal ?? null;
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
          tools?: unknown;
        };
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].role).toBe("user");
        expect(body.tools).toBeUndefined();
        expect(body.messages[0].content).not.toMatch(
          /https?:\/\/|data:|base64|"image"|"audio"|"video"/i,
        );
        const envelope = JSON.parse(body.messages[0].content) as {
          job: string;
          request: RecommendNextRequest;
        };
        expect(envelope.job).toBe("recommend_next");
        expect(
          envelope.request.eligibleChallenges.map(
            (challenge) => challenge.challengeTemplateId,
          ),
        ).toEqual([
          "retry_focal_order_v1",
          "transfer_layer_order_v1",
        ]);
        const selected = envelope.request.eligibleChallenges[0];
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    recommendationId: "recommendation_live_1",
                    requestId: envelope.request.requestId,
                    bindingEcho: {
                      bindingId: envelope.request.binding.bindingId,
                      requestProjectionSha256:
                        envelope.request.binding.requestProjectionSha256,
                    },
                    recommendedSubskill: selected.subskill,
                    recommendedActionMode: selected.actionMode,
                    recommendedChallengeTemplateId:
                      selected.challengeTemplateId,
                    episodeRole: selected.allowedEpisodeRoles[0],
                    challengeProfile: {
                      preserve: selected.preserve.map((item) => item.text),
                      vary: selected.vary.map((item) => item.text),
                      removeShortcuts: selected.removeShortcuts.map(
                        (item) => item.text,
                      ),
                      targetDifficulty: selected.difficulty,
                    },
                    rationale:
                      "This retry maximizes expected learning gain at the observed edge.",
                    evidenceIds: ["evidence_1"],
                    uncertaintyToResolve:
                      "Whether focal order survives a fresh product context.",
                    confidence: "medium",
                    modelVersion: "pioneer-test",
                    createdAt: NOW.toISOString(),
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const client = new LiveGymPioneerClient({
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      now: () => NOW,
      makeId: () => "p2_request_1",
    });

    const liveCodex = new LiveGymCodexClient({
      gateway: {
        run: vi.fn(async () =>
          liveResult("interpret_goal", interpretOutput()),
        ),
      } as never,
      socketReady: () => true,
    });
    const liveGoal = await liveCodex.interpretGoal(
      {
        sessionId: "session_1",
        goalInstanceId: "goal_1",
        rawPrompt: "Teach me intentional product-video hierarchy.",
        sessionTimeboxSeconds: 90,
      },
      context(),
    );
    const liveP2Input = {
      ...chooseInput(),
      goalInstanceId: liveGoal.goalInstanceId,
      goalDefinitionId: liveGoal.goalDefinitionId,
    };
    await expect(client.chooseNext(liveP2Input, context())).resolves.toEqual({
      recommendationId: "recommendation_live_1",
      recommendedSubskill: "focal ordering",
      recommendedActionMode: "choose",
      recommendedChallengeTemplateId: "retry_focal_order_v1",
      episodeRole: "retry",
      rationale:
        "This retry maximizes expected learning gain at the observed edge.",
      evidenceIds: ["evidence_1"],
      confidence: "medium",
      provenance: "live",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(transportSignal).toBeInstanceOf(AbortSignal);
  });

  it("propagates the engine abort signal into the Pioneer transport", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let transportSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_resource: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal ?? undefined;
          transportSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
          entered();
        }),
    );
    const controller = new AbortController();
    const client = new LiveGymPioneerClient({
      apiKey: "TEST_ONLY",
      model: "pioneer-test",
      fetchImpl,
      now: () => NOW,
      makeId: () => "p2_request_abort",
    });

    const pending = client.chooseNext(chooseInput(), context(controller.signal));
    await started;
    controller.abort(new Error("stop live P2"));

    await expect(pending).rejects.toThrow("stop live P2");
    expect(transportSignal?.aborted).toBe(true);
  });
});

describe("createGymRuntime", () => {
  it("selects live adapters only for WORKFLOW_MODE=live", () => {
    const dry = createGymRuntime({ WORKFLOW_MODE: "dry-run" });
    const test = createGymRuntime({ WORKFLOW_MODE: "test" });
    const live = createGymRuntime({
      WORKFLOW_MODE: "live",
      PIONEER_API_KEY: "TEST_ONLY",
      PIONEER_MODEL: "pioneer-test",
    });

    expect(dry.engine.health().providers).toMatchObject({
      codex: { mode: "deterministic_skill_policy" },
      pioneer: { mode: "deterministic_skill_policy" },
    });
    expect(test.engine.health().providers).toMatchObject({
      codex: { mode: "deterministic_skill_policy" },
      pioneer: { mode: "deterministic_skill_policy" },
    });
    expect(live.engine.health().providers).toMatchObject({
      codex: { mode: "live" },
      pioneer: { mode: "live", ready: true },
    });
  });
});
