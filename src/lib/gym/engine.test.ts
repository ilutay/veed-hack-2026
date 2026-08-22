import { describe, expect, it, vi } from "vitest";

import type { ExerciseUiCommand, GymApiResponse } from "../tambo/gym-contract";

import { GymEngine, createGymEngine } from "./engine";
import {
  actionProps,
  getGymFixture,
  gymDigest,
  gymFixtureCandidateHash,
  immutableActionProps,
} from "./fixture-inventory";
import {
  DeterministicSkillCodexClient,
  DeterministicSkillPioneerClient,
  type BindPioneerChoiceInput,
  type ChooseNextInput,
  type CodexBoundCurriculumChoice,
  type InterpretGoalInput,
  type PioneerCurriculumChoice,
  type ProviderCallContext,
  type ValidateTeachingSignalInput,
} from "./providers";

function idFactory() {
  let sequence = 0;
  return (prefix: string) => `${prefix}_${++sequence}`;
}

function startRequest(sessionId: string, eventId = `event_start_${sessionId}`) {
  return {
    sessionId,
    event: {
      eventId,
      idempotencyKey: eventId,
      sessionId,
      sourceComponentId: `bootstrap_${sessionId}`,
      clientCreatedAt: "2026-08-22T12:00:00.000Z",
      type: "start" as const,
      payload: { rawPrompt: "I want to make intentional product videos" },
    },
  };
}

function exerciseCommand(response: GymApiResponse): ExerciseUiCommand {
  if (response.command.commandKind !== "exercise") {
    throw new Error("test expected an exercise command");
  }
  return response.command;
}

function responseContract(command: ExerciseUiCommand) {
  const props = command.component.props as {
    responseContract: {
      schemaId: string;
      schemaVersion: string;
      schemaSha256: string;
    };
  };
  return props.responseContract;
}

function submitRequest(
  response: GymApiResponse,
  value: unknown,
  eventId: string,
  confidence: "low" | "medium" | "high" = "medium",
) {
  const command = exerciseCommand(response);
  return {
    sessionId: response.sessionId,
    event: {
      eventId,
      idempotencyKey: eventId,
      sessionId: response.sessionId,
      sourceComponentId: command.component.id,
      clientCreatedAt: "2026-08-22T12:00:01.000Z",
      commandId: command.commandId,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
      type: "exercise.submitted" as const,
      payload: {
        responseId: `response_${eventId}`,
        action: { ...responseContract(command), value },
        reasoningText: "The promise should lead before proof and action.",
        reasoningTagIds: ["focal-order"],
        statedConfidence: confidence,
        submittedAt: "2026-08-22T12:00:01.000Z",
      },
    },
  };
}

function acknowledgeRequest(response: GymApiResponse, eventId: string) {
  const command = exerciseCommand(response);
  const props = command.component.props as { evidenceId: string };
  return {
    sessionId: response.sessionId,
    event: {
      eventId,
      idempotencyKey: eventId,
      sessionId: response.sessionId,
      sourceComponentId: command.component.id,
      clientCreatedAt: "2026-08-22T12:00:02.000Z",
      commandId: command.commandId,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
      type: "feedback.acknowledged" as const,
      payload: { evidenceId: props.evidenceId },
    },
  };
}

async function completeDirectJourney(engine: GymEngine, sessionId: string) {
  const baseline = await engine.handle(startRequest(sessionId));
  const baselineFeedback = await engine.handle(
    submitRequest(
      baseline,
      { choiceId: "frame-b" },
      `event_${sessionId}_baseline`,
    ),
  );
  const transfer = await engine.handle(
    acknowledgeRequest(baselineFeedback, `event_${sessionId}_next`),
  );
  const transferFeedback = await engine.handle(
    submitRequest(
      transfer,
      { layerOrder: ["promise", "context", "proof", "support", "action"] },
      `event_${sessionId}_transfer`,
    ),
  );
  await engine.handle(
    acknowledgeRequest(transferFeedback, `event_${sessionId}_complete`),
  );
  return baseline;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const rejectWithReason = () => reject(signal.reason);
    if (signal.aborted) {
      rejectWithReason();
      return;
    }
    signal.addEventListener("abort", rejectWithReason, { once: true });
  });
}

class CountingCodex extends DeterministicSkillCodexClient {
  interpretCalls = 0;
  bindCalls = 0;

  override async interpretGoal(
    input: InterpretGoalInput,
    context: ProviderCallContext,
  ) {
    this.interpretCalls += 1;
    return super.interpretGoal(input, context);
  }

  override async bindPioneerChoice(
    input: BindPioneerChoiceInput,
    context: ProviderCallContext,
  ) {
    this.bindCalls += 1;
    return super.bindPioneerChoice(input, context);
  }
}

class CountingPioneer extends DeterministicSkillPioneerClient {
  validationCalls = 0;
  choiceCalls = 0;

  override async validateTeachingSignal(
    input: ValidateTeachingSignalInput,
    context: ProviderCallContext,
  ) {
    this.validationCalls += 1;
    return super.validateTeachingSignal(input, context);
  }

  override async chooseNext(input: ChooseNextInput, context: ProviderCallContext) {
    this.choiceCalls += 1;
    return super.chooseNext(input, context);
  }
}

describe("GymEngine", () => {
  it("binds P1, the receipt, and Codex to one immutable candidate hash", async () => {
    class CapturingPioneer extends DeterministicSkillPioneerClient {
      candidateHash: string | undefined;

      override async validateTeachingSignal(
        input: ValidateTeachingSignalInput,
        context: ProviderCallContext,
      ) {
        this.candidateHash = input.fixtureContentHash;
        return super.validateTeachingSignal(input, context);
      }
    }

    const pioneer = new CapturingPioneer();
    const engine = createGymEngine({ pioneerClient: pioneer, makeId: idFactory() });
    const response = await engine.handle(startRequest("session_hash_binding"));
    const command = exerciseCommand(response);
    const props = command.component.props as {
      validationReceipt: { contentHash: string };
    };
    const fixture = getGymFixture("baseline_hierarchy_v1");
    const pedagogicalProps = immutableActionProps(fixture);

    expect(pioneer.candidateHash).toBe(fixture.fixtureContentHash);
    expect(props.validationReceipt.contentHash).toBe(pioneer.candidateHash);
    expect(command.gymSpecHash).toBe(pioneer.candidateHash);
    expect(command.pedagogicalPropsSha256).toBe(gymDigest(pedagogicalProps));

    const alternateReceiptProps = actionProps(fixture, {
      validationId: "validation_alternate_wrapper",
      judgment: "PASS",
      confidence: "high",
      reasonCodes: ["same_candidate"],
      provenance: "live",
      summary: "A different receipt wrapper around the same immutable rep.",
    });
    const { validationReceipt: ignoredReceipt, ...samePedagogicalProps } =
      alternateReceiptProps;
    expect(ignoredReceipt).toBeDefined();
    expect(gymFixtureCandidateHash(fixture, samePedagogicalProps)).toBe(
      fixture.fixtureContentHash,
    );

    const driftedProps = {
      ...pedagogicalProps,
      title: "A changed learner-facing title",
    };
    expect(gymFixtureCandidateHash(fixture, driftedProps)).not.toBe(
      fixture.fixtureContentHash,
    );
    expect(
      gymFixtureCandidateHash(
        { ...fixture, fixtureReceiptId: "fixture_receipt_drifted" },
        pedagogicalProps,
      ),
    ).not.toBe(fixture.fixtureContentHash);
    expect(
      gymFixtureCandidateHash(
        { ...fixture, componentName: "SafeExerciseFallback" },
        pedagogicalProps,
      ),
    ).not.toBe(fixture.fixtureContentHash);
  });

  it("runs the bounded miss -> retry -> transfer journey and replays an event once", async () => {
    const codex = new CountingCodex();
    const pioneer = new CountingPioneer();
    const engine = createGymEngine({
      codexClient: codex,
      pioneerClient: pioneer,
      makeId: idFactory(),
    });

    const baseline = await engine.handle(startRequest("session_full"));
    expect(baseline.command.component.name).toBe("CompareArena");
    expect(baseline.receipts[0]).toMatchObject({
      kind: "p1_validation",
      provenance: "prevalidated",
      status: "pass",
    });

    const baselineSubmission = submitRequest(
      baseline,
      { choiceId: "frame-a" },
      "event_submit_baseline",
      "high",
    );
    const baselineFeedback = await engine.handle(baselineSubmission);
    const replay = await engine.handle(baselineSubmission);
    expect(replay).toEqual(baselineFeedback);
    expect(baselineFeedback.command.component.name).toBe("CreditAssignmentReplay");

    const retry = await engine.handle(
      acknowledgeRequest(baselineFeedback, "event_ack_baseline"),
    );
    expect(retry.command.component.name).toBe("TargetedRetryGym");
    expect(retry.receipts.at(-2)).toMatchObject({
      kind: "p2_recommendation",
      provenance: "deterministic_skill_policy",
    });

    const retryFeedback = await engine.handle(
      submitRequest(retry, { choiceId: "retry-b" }, "event_submit_retry"),
    );
    const transfer = await engine.handle(
      acknowledgeRequest(retryFeedback, "event_ack_retry"),
    );
    expect(transfer.command.component.name).toBe("LayerOrderTransferGym");

    const transferFeedback = await engine.handle(
      submitRequest(
        transfer,
        { layerOrder: ["promise", "context", "proof", "support", "action"] },
        "event_submit_transfer",
      ),
    );
    expect(transferFeedback.progress?.learningStatus).toBe("transfer_shown");
    expect(transferFeedback.receipts.at(-1)).toMatchObject({
      kind: "transfer",
      provenance: "deterministic_rubric_policy",
    });

    const complete = await engine.handle(
      acknowledgeRequest(transferFeedback, "event_ack_transfer"),
    );
    expect(complete.command.component.name).toBe("LearningPrompt");
    expect(codex.interpretCalls + codex.bindCalls).toBe(3);
    expect(pioneer.validationCalls + pioneer.choiceCalls).toBe(3);
  });

  it("lets Pioneer skip the retry after criterion evidence is already met", async () => {
    const engine = createGymEngine({ makeId: idFactory() });
    const baseline = await engine.handle(startRequest("session_direct"));
    const feedback = await engine.handle(
      submitRequest(baseline, { choiceId: "frame-b" }, "event_direct_submit"),
    );
    const next = await engine.handle(
      acknowledgeRequest(feedback, "event_direct_ack"),
    );
    expect(next.command.component.name).toBe("LayerOrderTransferGym");
  });

  it("rejects stale bindings and conflicting reuse of an idempotency key", async () => {
    const engine = createGymEngine({ makeId: idFactory() });
    const start = startRequest("session_conflict");
    const baseline = await engine.handle(start);
    const stale = submitRequest(
      baseline,
      { choiceId: "frame-a" },
      "event_stale",
    );
    stale.event.commandId = "command_from_an_old_screen";
    await expect(engine.handle(stale)).rejects.toMatchObject({
      status: 409,
      code: "stale_command",
    });

    const changedStart = startRequest("session_conflict");
    changedStart.event.payload.rawPrompt = "A different payload under the same key";
    await expect(engine.handle(changedStart)).rejects.toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    });
  });

  it("enforces two active sessions and expires idle state after fifteen minutes", async () => {
    let nowMs = Date.parse("2026-08-22T12:00:00.000Z");
    const engine = createGymEngine({
      makeId: idFactory(),
      now: () => new Date(nowMs),
    });
    const first = await engine.handle(startRequest("session_one"));
    await engine.handle(startRequest("session_two"));
    await expect(engine.handle(startRequest("session_three"))).rejects.toMatchObject({
      status: 429,
      code: "session_capacity",
    });

    nowMs += 15 * 60 * 1_000 + 1;
    await expect(
      engine.handle(
        submitRequest(first, { choiceId: "frame-a" }, "event_after_ttl"),
      ),
    ).rejects.toMatchObject({ status: 409, code: "session_conflict" });
    await expect(engine.handle(startRequest("session_three"))).resolves.toBeDefined();
  });

  it("bounds retained TTL sessions and evicts the oldest completed session", async () => {
    const engine = createGymEngine({
      makeId: idFactory(),
      maxRetainedSessions: 2,
    });
    const oldestBaseline = await completeDirectJourney(engine, "session_oldest");
    await completeDirectJourney(engine, "session_newer");
    expect(engine.health()).toMatchObject({
      activeSessions: 0,
      retainedSessions: 2,
      limits: { retainedSessions: 2 },
    });

    await engine.handle(startRequest("session_new_active"));
    expect(engine.health()).toMatchObject({
      activeSessions: 1,
      retainedSessions: 2,
      limits: { retainedSessions: 2 },
    });
    await expect(
      engine.handle(
        submitRequest(
          oldestBaseline,
          { choiceId: "frame-b" },
          "event_oldest_after_eviction",
        ),
      ),
    ).rejects.toMatchObject({ status: 409, code: "session_conflict" });
  });

  it("enforces the per-session provider budget before a curriculum call", async () => {
    const engine = createGymEngine({
      makeId: idFactory(),
      pioneerCallsPerSession: 1,
      codexCallsPerSession: 1,
    });
    const baseline = await engine.handle(startRequest("session_budget"));
    const feedback = await engine.handle(
      submitRequest(baseline, { choiceId: "frame-a" }, "event_budget_submit"),
    );
    await expect(
      engine.handle(acknowledgeRequest(feedback, "event_budget_ack")),
    ).rejects.toMatchObject({ status: 429, code: "provider_budget" });
  });

  it("rejects a Codex attempt to replace Pioneer’s curriculum choice", async () => {
    class ReplacingCodex extends DeterministicSkillCodexClient {
      override async bindPioneerChoice(
        input: BindPioneerChoiceInput,
        context: ProviderCallContext,
      ) {
        const bound = await super.bindPioneerChoice(input, context);
        return { ...bound, chosenChallengeTemplateId: "another_template" };
      }
    }
    const engine = new GymEngine({
      codexClient: new ReplacingCodex(),
      makeId: idFactory(),
    });
    const baseline = await engine.handle(startRequest("session_authority"));
    const feedback = await engine.handle(
      submitRequest(baseline, { choiceId: "frame-a" }, "event_authority_submit"),
    );
    await expect(
      engine.handle(acknowledgeRequest(feedback, "event_authority_ack")),
    ).rejects.toMatchObject({
      status: 503,
      code: "provider_contract_violation",
    });
  });

  it.each([
    ["render contract", { renderContractId: "render_drifted_v1" }],
    ["component schema", { componentSchemaVersion: "schema-drift-v1" }],
    ["evidence citation", { citedEvidenceIds: ["unrelated_evidence"] }],
  ] as const)("rejects a Codex binding with a drifted %s", async (_label, patch) => {
    class DriftingCodex extends DeterministicSkillCodexClient {
      override async bindPioneerChoice(
        input: BindPioneerChoiceInput,
        context: ProviderCallContext,
      ) {
        const bound = await super.bindPioneerChoice(input, context);
        return {
          ...bound,
          ...patch,
        } as CodexBoundCurriculumChoice;
      }
    }
    const engine = new GymEngine({
      codexClient: new DriftingCodex(),
      makeId: idFactory(),
    });
    const baseline = await engine.handle(startRequest(`session_drift_${_label}`));
    const feedback = await engine.handle(
      submitRequest(
        baseline,
        { choiceId: "frame-a" },
        `event_drift_submit_${_label}`,
      ),
    );

    await expect(
      engine.handle(
        acknowledgeRequest(feedback, `event_drift_ack_${_label}`),
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: "provider_contract_violation",
    });
  });

  it.each([
    ["subskill", { recommendedSubskill: "surface polish" }],
    ["action mode", { recommendedActionMode: "rank" }],
    ["episode role", { episodeRole: "diagnostic_probe" }],
  ] as const)(
    "rejects Pioneer %s drift before Codex binding",
    async (label, semanticPatch) => {
      class DriftingPioneer extends DeterministicSkillPioneerClient {
        override async chooseNext(
          input: ChooseNextInput,
          context: ProviderCallContext,
        ) {
          const recommendation = await super.chooseNext(input, context);
          return {
            ...recommendation,
            ...semanticPatch,
          } as PioneerCurriculumChoice;
        }
      }

      const codex = new CountingCodex();
      const engine = createGymEngine({
        codexClient: codex,
        pioneerClient: new DriftingPioneer(),
        makeId: idFactory(),
      });
      const baseline = await engine.handle(
        startRequest(`session_pioneer_semantic_drift_${label}`),
      );
      const feedback = await engine.handle(
        submitRequest(
          baseline,
          { choiceId: "frame-a" },
          `event_pioneer_semantic_drift_submit_${label}`,
        ),
      );

      await expect(
        engine.handle(
          acknowledgeRequest(
            feedback,
            `event_pioneer_semantic_drift_ack_${label}`,
          ),
        ),
      ).rejects.toMatchObject({
        status: 503,
        code: "provider_contract_violation",
      });
      expect(codex.bindCalls).toBe(0);
    },
  );

  it("fails fast when both provider slots are occupied", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    class BlockingCodex extends DeterministicSkillCodexClient {
      override async interpretGoal(
        input: InterpretGoalInput,
        context: ProviderCallContext,
      ) {
        await blocked;
        return super.interpretGoal(input, context);
      }
    }
    class BlockingPioneer extends DeterministicSkillPioneerClient {
      override async validateTeachingSignal(
        input: ValidateTeachingSignalInput,
        context: ProviderCallContext,
      ) {
        await blocked;
        return super.validateTeachingSignal(input, context);
      }
    }
    const engine = createGymEngine({
      codexClient: new BlockingCodex(),
      pioneerClient: new BlockingPioneer(),
      makeId: idFactory(),
      providerDeadlineMs: 5_000,
    });
    const first = engine.handle(startRequest("session_blocked_one"));
    await vi.waitFor(() => {
      expect(engine.health().providerCallsInFlight).toBe(2);
    });
    await expect(
      engine.handle(startRequest("session_blocked_two")),
    ).rejects.toMatchObject({ status: 429, code: "provider_capacity" });
    release();
    await expect(first).resolves.toBeDefined();
  });

  it("propagates upstream cancellation and releases both provider slots", async () => {
    class AbortOnceCodex extends DeterministicSkillCodexClient {
      calls = 0;

      override async interpretGoal(
        input: InterpretGoalInput,
        context: ProviderCallContext,
      ) {
        this.calls += 1;
        if (this.calls === 1) await waitForAbort(context.signal);
        return super.interpretGoal(input, context);
      }
    }
    class AbortOncePioneer extends DeterministicSkillPioneerClient {
      calls = 0;

      override async validateTeachingSignal(
        input: ValidateTeachingSignalInput,
        context: ProviderCallContext,
      ) {
        this.calls += 1;
        if (this.calls === 1) await waitForAbort(context.signal);
        return super.validateTeachingSignal(input, context);
      }
    }

    const engine = createGymEngine({
      codexClient: new AbortOnceCodex(),
      pioneerClient: new AbortOncePioneer(),
      makeId: idFactory(),
      providerDeadlineMs: 5_000,
    });
    const controller = new AbortController();
    const cancelled = engine.handle(
      startRequest("session_cancelled"),
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(engine.health().providerCallsInFlight).toBe(2);
    });

    controller.abort(new Error("client disconnected"));
    await expect(cancelled).rejects.toMatchObject({
      status: 503,
      code: "provider_unavailable",
    });
    await vi.waitFor(() => {
      expect(engine.health().providerCallsInFlight).toBe(0);
    });
    await expect(
      engine.handle(startRequest("session_after_cancel")),
    ).resolves.toBeDefined();
  });
});
