import { randomUUID } from "node:crypto";

import type { InterpretGoalOutput } from "../codex/types";
import { getGymComponentDefinition } from "../contracts/gym-components";
import { LIVE_GYM_PROVIDER_DEADLINE_MS } from "../contracts/live-deadlines";
import {
  codexUiCommandSchema,
  gymApiRequestSchema,
  gymApiResponseSchema,
  gymComponentSchemas,
  validationReceiptSchema,
  type CodexUiCommand,
  type ExerciseUiCommand,
  type GymApiRequest,
  type GymApiResponse,
  type HumanUiEvent,
  type JourneyProgress,
  type UiReceipt,
} from "../gym-ui/gym-contract";

import { GymError } from "./errors";
import {
  actionProps,
  assessFixtureResponse,
  feedbackProps,
  getGymFixture,
  gymDigest,
  gymFixtureCandidateHash,
  gymFixtureCandidateProjection,
  gymFixtureRenderContractId,
  isGymTemplateId,
  type GymFixtureTemplate,
  type GymTemplateId,
} from "./fixture-inventory";
import {
  DeterministicSkillCodexClient,
  DeterministicSkillPioneerClient,
  type CurriculumEvidence,
  type GymCodexClient,
  type GymPioneerClient,
  type PioneerCurriculumChoice,
  type PioneerTeachingSignalValidation,
  type ProviderCallContext,
} from "./providers";

const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_ACTIVE_SESSIONS = 2;
const DEFAULT_MAX_RETAINED_SESSIONS = 20;
const DEFAULT_MAX_PROVIDER_CALLS = 2;
const DEFAULT_SESSION_PROVIDER_BUDGET = 3;
const SUPPORTED_GOAL_DEFINITION_ID = "visual-hierarchy.short-form-v1";
const UNSUPPORTED_GOAL_DEFINITION_ID = "unsupported.v1";

type EnginePhase =
  | "initializing"
  | "awaiting_action"
  | "showing_feedback"
  | "complete";

interface IdempotencyReceipt {
  requestHash: string;
  response: GymApiResponse;
}

interface GymSession {
  sessionId: string;
  createdAtMs: number;
  expiresAtMs: number;
  absoluteExpiresAtMs: number;
  phase: EnginePhase;
  rawPrompt: string;
  goalInstanceId: string;
  goal: InterpretGoalOutput | null;
  currentFixture: GymFixtureTemplate | null;
  currentCommand: CodexUiCommand | null;
  latestEvidence: CurriculumEvidence | null;
  receipts: UiReceipt[];
  idempotency: Map<string, IdempotencyReceipt>;
  budget: {
    pioneerCalls: number;
    codexCalls: number;
  };
}

export interface GymEngineOptions {
  codexClient?: GymCodexClient;
  pioneerClient?: GymPioneerClient;
  now?: () => Date;
  makeId?: (prefix: string) => string;
  sessionTtlMs?: number;
  providerDeadlineMs?: number;
  maxActiveSessions?: number;
  maxRetainedSessions?: number;
  maxConcurrentProviderCalls?: number;
  pioneerCallsPerSession?: number;
  codexCallsPerSession?: number;
}

export interface GymEngineHealth {
  ready: boolean;
  activeSessions: number;
  retainedSessions: number;
  providerCallsInFlight: number;
  limits: {
    activeSessions: number;
    retainedSessions: number;
    providerCalls: number;
    pioneerCallsPerSession: number;
    codexCallsPerSession: number;
    sessionTtlSeconds: number;
  };
  providers: {
    codex: { ready: boolean; mode: GymCodexClient["mode"] };
    pioneer: { ready: boolean; mode: GymPioneerClient["mode"] };
  };
}

class ProviderGate {
  private inFlight = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly deadlineMs: number,
  ) {}

  count() {
    return this.inFlight;
  }

  limit() {
    return this.maxConcurrent;
  }

  async run<T>(
    operation: (context: ProviderCallContext) => Promise<T>,
    upstreamSignal?: AbortSignal,
  ): Promise<T> {
    throwIfRequestAborted(upstreamSignal);
    if (this.inFlight >= this.maxConcurrent) {
      throw new GymError(
        429,
        "provider_capacity",
        "Both provider slots are busy. Retry this same event after the current calls finish.",
        { retryAfterSeconds: 2 },
      );
    }

    this.inFlight += 1;
    const controller = new AbortController();
    let deadlineHandle: ReturnType<typeof setTimeout> | undefined;
    let rejectCancellation: (reason: GymError) => void = () => undefined;

    const cancellationPromise = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const cancelFromUpstream = () => {
      const reason = requestCancelledError(upstreamSignal?.reason);
      controller.abort(reason);
      rejectCancellation(reason);
    };
    upstreamSignal?.addEventListener("abort", cancelFromUpstream, { once: true });
    if (upstreamSignal?.aborted) cancelFromUpstream();

    const providerPromise = Promise.resolve().then(() =>
      operation({ signal: controller.signal, deadlineMs: this.deadlineMs }),
    );
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadlineHandle = setTimeout(() => {
        const reason = new GymError(
          503,
          "provider_unavailable",
          "A provider exceeded the bounded deadline. Nothing was retried automatically.",
        );
        controller.abort(reason);
        reject(reason);
      }, this.deadlineMs);
    });

    providerPromise.then(
      () => {
        this.inFlight -= 1;
        if (deadlineHandle) clearTimeout(deadlineHandle);
        upstreamSignal?.removeEventListener("abort", cancelFromUpstream);
      },
      () => {
        this.inFlight -= 1;
        if (deadlineHandle) clearTimeout(deadlineHandle);
        upstreamSignal?.removeEventListener("abort", cancelFromUpstream);
      },
    );

    try {
      return await Promise.race([
        providerPromise,
        deadlinePromise,
        cancellationPromise,
      ]);
    } catch (error) {
      if (error instanceof GymError) throw error;
      throw new GymError(
        503,
        "provider_unavailable",
        "A provider could not complete this event. Nothing was retried automatically.",
        { cause: error },
      );
    }
  }
}

function requestCancelledError(cause?: unknown): GymError {
  return new GymError(
    503,
    "provider_unavailable",
    "The request was cancelled before the provider call completed.",
    { cause },
  );
}

function throwIfRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw requestCancelledError(signal.reason);
}

function learningProgress(
  active: "prompt" | "validate" | "practice" | "adapt" | "transfer",
  learningStatus: JourneyProgress["learningStatus"],
): JourneyProgress {
  const steps = ["prompt", "validate", "practice", "adapt", "transfer"] as const;
  const labels = {
    prompt: "Goal",
    validate: "Certify",
    practice: "Practice",
    adapt: "Adapt",
    transfer: "Transfer",
  };
  const activeIndex = steps.indexOf(active);
  return {
    steps: steps.map((id, index) => ({
      id,
      label: labels[id],
      state:
        index < activeIndex ? "complete" : index === activeIndex ? "active" : "upcoming",
    })),
    learningStatus,
  };
}

function completedProgress(): JourneyProgress {
  return {
    steps: [
      { id: "prompt", label: "Goal", state: "complete" },
      { id: "validate", label: "Certify", state: "complete" },
      { id: "practice", label: "Practice", state: "complete" },
      { id: "adapt", label: "Adapt", state: "complete" },
      { id: "transfer", label: "Transfer", state: "complete" },
    ],
    learningStatus: "transfer_shown",
  };
}

function eventRequestHash(request: GymApiRequest): string {
  return gymDigest(request);
}

function sameContract(
  left: { schemaId: string; schemaVersion: string; schemaSha256: string },
  right: { schemaId: string; schemaVersion: string; schemaSha256: string },
) {
  return (
    left.schemaId === right.schemaId &&
    left.schemaVersion === right.schemaVersion &&
    left.schemaSha256 === right.schemaSha256
  );
}

function strictObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export class GymEngine {
  private readonly sessions = new Map<string, GymSession>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly codexClient: GymCodexClient;
  private readonly pioneerClient: GymPioneerClient;
  private readonly now: () => Date;
  private readonly makeId: (prefix: string) => string;
  private readonly sessionTtlMs: number;
  private readonly maxActiveSessions: number;
  private readonly maxRetainedSessions: number;
  private readonly pioneerCallsPerSession: number;
  private readonly codexCallsPerSession: number;
  private readonly providerGate: ProviderGate;

  constructor(options: GymEngineOptions = {}) {
    this.codexClient = options.codexClient ?? new DeterministicSkillCodexClient();
    this.pioneerClient = options.pioneerClient ?? new DeterministicSkillPioneerClient();
    this.now = options.now ?? (() => new Date());
    this.makeId = options.makeId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxActiveSessions =
      options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
    this.maxRetainedSessions =
      options.maxRetainedSessions ?? DEFAULT_MAX_RETAINED_SESSIONS;
    this.pioneerCallsPerSession =
      options.pioneerCallsPerSession ?? DEFAULT_SESSION_PROVIDER_BUDGET;
    this.codexCallsPerSession =
      options.codexCallsPerSession ?? DEFAULT_SESSION_PROVIDER_BUDGET;
    this.providerGate = new ProviderGate(
      options.maxConcurrentProviderCalls ?? DEFAULT_MAX_PROVIDER_CALLS,
      options.providerDeadlineMs ?? LIVE_GYM_PROVIDER_DEADLINE_MS,
    );
  }

  health(): GymEngineHealth {
    this.pruneExpired();
    const codexReady = this.codexClient.isReady();
    const pioneerReady = this.pioneerClient.isReady();
    return {
      ready: codexReady && pioneerReady,
      activeSessions: this.activeSessionCount(),
      retainedSessions: this.sessions.size,
      providerCallsInFlight: this.providerGate.count(),
      limits: {
        activeSessions: this.maxActiveSessions,
        retainedSessions: this.maxRetainedSessions,
        providerCalls: this.providerGate.limit(),
        pioneerCallsPerSession: this.pioneerCallsPerSession,
        codexCallsPerSession: this.codexCallsPerSession,
        sessionTtlSeconds: Math.floor(this.sessionTtlMs / 1_000),
      },
      providers: {
        codex: { ready: codexReady, mode: this.codexClient.mode },
        pioneer: { ready: pioneerReady, mode: this.pioneerClient.mode },
      },
    };
  }

  async handle(
    rawRequest: unknown,
    signal?: AbortSignal,
  ): Promise<GymApiResponse> {
    throwIfRequestAborted(signal);
    const parsed = gymApiRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new GymError(
        400,
        "invalid_request",
        "The event does not match the strict gym contract.",
        { cause: parsed.error },
      );
    }
    const request = parsed.data;
    if (request.sessionId && request.sessionId !== request.event.sessionId) {
      throw new GymError(
        409,
        "session_conflict",
        "The request and event session IDs do not match.",
      );
    }

    return this.serialize(request.event.sessionId, () => {
      throwIfRequestAborted(signal);
      return this.handleLocked(request, signal);
    });
  }

  private async serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(sessionId, tail);
    try {
      return await run;
    } finally {
      if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
    }
  }

  private async handleLocked(
    request: GymApiRequest,
    signal?: AbortSignal,
  ): Promise<GymApiResponse> {
    throwIfRequestAborted(signal);
    this.pruneExpired();
    const event = request.event;
    const requestHash = eventRequestHash(request);
    let session = this.sessions.get(event.sessionId);

    const prior = session?.idempotency.get(event.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new GymError(
          409,
          "idempotency_conflict",
          "This idempotency key was already used for a different event.",
        );
      }
      return prior.response;
    }

    if (!session) {
      if (event.type !== "start") {
        throw new GymError(
          409,
          "session_conflict",
          "This session is missing or expired. Start a new 90-second session.",
        );
      }
      this.assertSessionCapacity();
      this.ensureRetainedCapacity();
      session = this.createSession(event.sessionId, event.payload.rawPrompt);
      this.sessions.set(event.sessionId, session);
    } else if (event.type === "start") {
      if (session.phase !== "complete") {
        throw new GymError(
          409,
          "session_conflict",
          "A learning journey is already active for this session.",
        );
      }
      this.assertSessionCapacity();
      this.resetSession(session, event.payload.rawPrompt);
    }

    try {
      const response =
        event.type === "start"
          ? await this.startSession(session, event, signal)
          : event.type === "exercise.submitted"
            ? await this.submitExercise(session, event)
            : event.type === "feedback.acknowledged"
              ? await this.acknowledgeFeedback(session, event, signal)
              : await this.handleComponentFailure(session, event);
      const validated = gymApiResponseSchema.parse(response);
      session.idempotency.set(event.idempotencyKey, {
        requestHash,
        response: validated,
      });
      this.touch(session);
      return validated;
    } catch (error) {
      if (event.type === "start" && session.phase === "initializing") {
        this.sessions.delete(session.sessionId);
      }
      throw error;
    }
  }

  private createSession(sessionId: string, rawPrompt: string): GymSession {
    const now = this.now().getTime();
    return {
      sessionId,
      createdAtMs: now,
      expiresAtMs: now + this.sessionTtlMs,
      absoluteExpiresAtMs: now + this.sessionTtlMs,
      phase: "initializing",
      rawPrompt,
      goalInstanceId: this.makeId("goal"),
      goal: null,
      currentFixture: null,
      currentCommand: null,
      latestEvidence: null,
      receipts: [],
      idempotency: new Map(),
      budget: { pioneerCalls: 0, codexCalls: 0 },
    };
  }

  private resetSession(session: GymSession, rawPrompt: string) {
    const now = this.now().getTime();
    session.createdAtMs = now;
    session.expiresAtMs = now + this.sessionTtlMs;
    session.absoluteExpiresAtMs = now + this.sessionTtlMs;
    session.phase = "initializing";
    session.rawPrompt = rawPrompt;
    session.goalInstanceId = this.makeId("goal");
    session.goal = null;
    session.currentFixture = null;
    session.currentCommand = null;
    session.latestEvidence = null;
    session.receipts = [];
    session.idempotency.clear();
    session.budget = { pioneerCalls: 0, codexCalls: 0 };
  }

  private async startSession(
    session: GymSession,
    event: Extract<HumanUiEvent, { type: "start" }>,
    signal?: AbortSignal,
  ): Promise<GymApiResponse> {
    const baseline = getGymFixture("baseline_hierarchy_v1");
    const [goal, validation] = await Promise.all([
      this.callCodex(
        session,
        (context) =>
          this.codexClient.interpretGoal(
            {
              sessionId: session.sessionId,
              goalInstanceId: session.goalInstanceId,
              rawPrompt: event.payload.rawPrompt,
              sessionTimeboxSeconds: 90,
            },
            context,
          ),
        signal,
      ),
      this.callPioneer(
        session,
        (context) =>
          this.pioneerClient.validateTeachingSignal(
            {
              sessionId: session.sessionId,
              goalInstanceId: session.goalInstanceId,
              goalDefinitionId: "visual-hierarchy.short-form-v1",
              challengeTemplateId: baseline.challengeTemplateId,
              exerciseId: baseline.exerciseId,
              intendedTeachingSignal: "focal ordering",
              fixtureReceiptId: baseline.fixtureReceiptId,
              fixtureContentHash: baseline.fixtureContentHash,
            },
            context,
          ),
        signal,
      ),
    ]);

    const expectedGoalDefinitionId =
      goal.supportStatus === "unsupported"
        ? UNSUPPORTED_GOAL_DEFINITION_ID
        : SUPPORTED_GOAL_DEFINITION_ID;
    if (
      goal.goalInstanceId !== session.goalInstanceId ||
      goal.rawPrompt !== event.payload.rawPrompt ||
      goal.sessionTimeboxSeconds !== 90 ||
      goal.goalDefinitionId !== expectedGoalDefinitionId
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Codex returned an interpretation whose input, support status, or goal definition was not bound to this goal event.",
      );
    }

    session.goal = goal;
    session.rawPrompt = event.payload.rawPrompt;
    if (goal.supportStatus === "unsupported") {
      const shell = this.createShellCommand(session.sessionId);
      session.currentCommand = shell;
      session.phase = "complete";
      const interpretation = goal.interpretationShownToHuman.trim();
      return {
        sessionId: session.sessionId,
        command: shell,
        receipts: session.receipts,
        progress: learningProgress("prompt", "not_started"),
        message: interpretation
          ? `${interpretation.slice(0, 360)} No exercise was issued; try a visual-hierarchy or short-form product-video goal.`
          : "Codex marked this goal unsupported, so no exercise was issued. Try a visual-hierarchy or short-form product-video goal.",
      };
    }

    const p1Receipt = this.receipt(
      "p1_validation",
      validation.judgment === "PASS" ? "Teaching signal certified" : "Teaching signal not certified",
      validation.summary,
      validation.judgment === "PASS"
        ? "pass"
        : validation.judgment === "REJECT"
          ? "reject"
          : "abstain",
      validation.provenance === "live" ? "live" : "prevalidated",
      { reference: validation.validationId },
    );
    session.receipts.push(p1Receipt);

    const fixture =
      validation.judgment === "PASS"
        ? baseline
        : getGymFixture("safe_fallback_v1");
    const command = this.createActionCommand(
      session,
      fixture,
      validation.judgment === "PASS" ? validation : undefined,
    );
    session.currentFixture = fixture;
    session.currentCommand = command;
    session.phase = "awaiting_action";

    return {
      sessionId: session.sessionId,
      command,
      receipts: session.receipts,
      progress: learningProgress("practice", "diagnosed"),
      message:
        validation.judgment === "PASS"
          ? goal.interpretationShownToHuman
          : "Pioneer did not certify the generated rep, so Codex bound a separately prevalidated fallback.",
    };
  }

  private async submitExercise(
    session: GymSession,
    event: Extract<HumanUiEvent, { type: "exercise.submitted" }>,
  ): Promise<GymApiResponse> {
    this.assertPhase(session, "awaiting_action");
    const command = this.currentExerciseCommand(session);
    const fixture = session.currentFixture!;
    this.assertExerciseContext(command, event);
    this.assertActionValue(fixture, event);

    const evidence = assessFixtureResponse({
      fixture,
      evidenceId: this.makeId("evidence"),
      actionValue: event.payload.action.value,
      statedConfidence: event.payload.statedConfidence,
    });
    session.latestEvidence = evidence;
    const criterionMet = evidence.criterionOutcomes[0]?.outcome === "met";
    session.receipts.push(
      this.receipt(
        fixture.episodeRole === "held_out_transfer" ? "transfer" : "assessment",
        fixture.episodeRole === "held_out_transfer"
          ? "Held-out transfer assessed"
          : "Response assessed",
        criterionMet
          ? "The bounded response met the focal-order criterion. Assessment provenance: deterministic_rubric_policy."
          : "The bounded response exposed a focal-order edge. Assessment provenance: deterministic_rubric_policy.",
        fixture.episodeRole === "held_out_transfer" ? "shown" : "scored",
        "deterministic_rubric_policy",
        {
          reference: "deterministic_rubric_policy",
          evidenceIds: [evidence.evidenceId],
        },
      ),
    );

    const feedback = feedbackProps({ fixture, evidence });
    const feedbackCommand = this.createFeedbackCommand(session, command, feedback);
    session.currentCommand = feedbackCommand;
    session.phase = "showing_feedback";

    return {
      sessionId: session.sessionId,
      command: feedbackCommand,
      receipts: session.receipts,
      progress:
        fixture.episodeRole === "held_out_transfer"
          ? completedProgress()
          : learningProgress(
              fixture.episodeRole === "baseline" ? "practice" : "adapt",
              "practicing",
            ),
      message:
        fixture.episodeRole === "held_out_transfer"
          ? "This receipt shows session evidence. It does not claim that learning is guaranteed."
          : "Pioneer will use this assessed evidence, not self-report alone, to maximize expected learning gain.",
    };
  }

  private async acknowledgeFeedback(
    session: GymSession,
    event: Extract<HumanUiEvent, { type: "feedback.acknowledged" }>,
    signal?: AbortSignal,
  ): Promise<GymApiResponse> {
    this.assertPhase(session, "showing_feedback");
    const command = this.currentExerciseCommand(session);
    const fixture = session.currentFixture!;
    const evidence = session.latestEvidence!;
    this.assertExerciseContext(command, event);
    if (event.payload.evidenceId !== evidence.evidenceId) {
      throw new GymError(
        409,
        "stale_command",
        "The acknowledged evidence does not belong to the visible feedback command.",
      );
    }

    if (fixture.episodeRole === "held_out_transfer") {
      session.phase = "complete";
      const shell = this.createShellCommand(session.sessionId);
      session.currentCommand = shell;
      return {
        sessionId: session.sessionId,
        command: shell,
        receipts: session.receipts,
        progress: completedProgress(),
        message: "The 90-second journey is complete. Start another prompt when ready.",
      };
    }

    const eligible: GymTemplateId[] =
      fixture.episodeRole === "baseline" || fixture.episodeRole === "diagnostic_probe"
        ? ["retry_focal_order_v1", "transfer_layer_order_v1"]
        : ["transfer_layer_order_v1"];
    const recommendation = await this.callPioneer(
      session,
      (context) =>
        this.pioneerClient.chooseNext(
          {
            sessionId: session.sessionId,
            goalInstanceId: session.goalInstanceId,
            goalDefinitionId: session.goal!.goalDefinitionId,
            currentSubskill: fixture.subskill,
            latestEvidence: evidence,
            eligibleChallengeTemplateIds: eligible,
            maxEstimatedSeconds: 35,
          },
          context,
        ),
      signal,
    );
    this.assertPioneerChoice(recommendation, eligible, evidence.evidenceId);

    const selectedId = recommendation.recommendedChallengeTemplateId;
    if (!isGymTemplateId(selectedId)) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Pioneer selected a challenge outside the registered fixture inventory.",
      );
    }
    const nextFixture = getGymFixture(selectedId);
    this.assertPioneerFixtureSemantics(recommendation, nextFixture);

    const binding = await this.callCodex(
      session,
      (context) =>
        this.codexClient.bindPioneerChoice(
          {
            sessionId: session.sessionId,
            goalInstanceId: session.goalInstanceId,
            currentSubskill: fixture.subskill,
            currentPhase:
              fixture.episodeRole === "baseline" ? "diagnosed" : "practicing",
            recommendation,
            eligibleChallengeTemplateIds: eligible,
            latestEvidenceIds: [evidence.evidenceId],
          },
          context,
        ),
      signal,
    );
    if (
      binding.decision !== "accept" ||
      binding.recommendationId !== recommendation.recommendationId ||
      binding.chosenChallengeTemplateId !==
        recommendation.recommendedChallengeTemplateId
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Codex must bind the exact Pioneer curriculum choice; it may not silently replace it.",
      );
    }

    const expectedEvidenceIds = [evidence.evidenceId];
    const expectedRenderContractId = gymFixtureRenderContractId(nextFixture);
    const expectedComponentSchemaVersion = getGymComponentDefinition(
      nextFixture.componentName,
    ).schemaVersion;
    if (
      binding.componentName !== nextFixture.componentName ||
      binding.renderContractId !== expectedRenderContractId ||
      binding.componentSchemaVersion !== expectedComponentSchemaVersion ||
      binding.citedEvidenceIds.length !== expectedEvidenceIds.length ||
      binding.citedEvidenceIds.some(
        (evidenceId, index) => evidenceId !== expectedEvidenceIds[index],
      )
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Codex did not bind the full evidence, render-contract, and component-schema tuple selected by Pioneer.",
      );
    }

    session.receipts.push(
      this.receipt(
        "p2_recommendation",
        "Pioneer selected the next learning edge",
        recommendation.rationale,
        "accepted",
        recommendation.provenance === "live"
          ? "live"
          : "deterministic_skill_policy",
        {
          reference: recommendation.recommendationId,
          evidenceIds: recommendation.evidenceIds,
        },
      ),
      this.receipt(
        "codex_decision",
        "Codex bound Pioneer’s curriculum choice",
        "Codex executed the exact recommended challenge through the approved component registry.",
        "accepted",
        binding.executionProvenance === "live"
          ? "live"
          : "deterministic_skill_policy",
        {
          reference:
            binding.executionProvenance === "live"
              ? binding.reasonCode
              : "deterministic_skill_policy",
          evidenceIds: binding.citedEvidenceIds,
        },
      ),
    );

    const nextCommand = this.createActionCommand(session, nextFixture);
    session.currentFixture = nextFixture;
    session.currentCommand = nextCommand;
    session.phase = "awaiting_action";

    return {
      sessionId: session.sessionId,
      command: nextCommand,
      receipts: session.receipts,
      progress:
        nextFixture.episodeRole === "held_out_transfer"
          ? learningProgress("transfer", "transfer_pending")
          : learningProgress("adapt", "practicing"),
      message: `Pioneer chose ${nextFixture.challengeTemplateId}; Codex bound that exact choice for practice.`,
    };
  }

  private async handleComponentFailure(
    session: GymSession,
    event: Extract<HumanUiEvent, { type: "ui.component_failed" }>,
  ): Promise<GymApiResponse> {
    const current = session.currentCommand;
    if (!current || current.commandId !== event.payload.failedCommandId) {
      throw new GymError(
        409,
        "stale_command",
        "The renderer failure does not belong to the current Codex command.",
      );
    }
    if (event.sourceComponentId !== current.component.id) {
      throw new GymError(
        409,
        "stale_command",
        "The renderer failure came from a stale component instance.",
      );
    }
    if (
      session.phase === "complete" ||
      current.commandKind !== "exercise"
    ) {
      throw new GymError(
        409,
        "stale_command",
        "A completed or non-exercise command cannot be replaced with a fallback exercise.",
      );
    }

    const fallback = getGymFixture("safe_fallback_v1");
    const fallbackCommand = this.createActionCommand(session, fallback);
    session.currentFixture = fallback;
    session.currentCommand = fallbackCommand;
    session.phase = "awaiting_action";
    session.receipts.push(
      this.receipt(
        "codex_decision",
        "Renderer failure disclosed",
        `Codex replaced failed command ${event.payload.failedCommandId} with a separately prevalidated fallback.`,
        "overridden",
        "fallback",
        { reference: event.payload.errorCode },
      ),
    );

    return {
      sessionId: session.sessionId,
      command: fallbackCommand,
      receipts: session.receipts,
      progress: learningProgress("practice", "diagnosed"),
      message: "The failed component was not reused. A separately validated fallback is visible.",
    };
  }

  private createActionCommand(
    session: GymSession,
    fixture: GymFixtureTemplate,
    validation?: PioneerTeachingSignalValidation,
  ): ExerciseUiCommand {
    const props = actionProps(fixture, validation);
    gymComponentSchemas[fixture.componentName].parse(props);
    const {
      validationReceipt: rawValidationReceipt,
      ...pedagogicalProps
    } = props;
    const candidateHash = gymFixtureCandidateHash(fixture, pedagogicalProps);
    const gymSpecProjection = gymFixtureCandidateProjection(
      fixture,
      pedagogicalProps,
    );
    const validationReceipt = validationReceiptSchema.parse(rawValidationReceipt);
    if (
      candidateHash !== fixture.fixtureContentHash ||
      validationReceipt.contentHash !== candidateHash
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "The P1 candidate, validation receipt, and Codex command hashes do not bind the same immutable exercise.",
      );
    }
    const command = codexUiCommandSchema.parse({
      commandKind: "exercise",
      commandPurpose: "exercise",
      commandId: this.makeId("command"),
      sessionId: session.sessionId,
      goalInstanceId: session.goalInstanceId,
      episodeId: this.makeId("episode"),
      exerciseId: fixture.exerciseId,
      exerciseRevision: 1,
      issuedBy: "codex",
      renderContractId: gymFixtureRenderContractId(fixture),
      component: {
        type: "component",
        id: this.makeId("component"),
        name: fixture.componentName,
        props,
        streamingState: "done",
      },
      componentSchemaVersion: getGymComponentDefinition(fixture.componentName)
        .schemaVersion,
      pedagogicalPropsSha256: gymDigest(pedagogicalProps),
      gymSpecHash: candidateHash,
      gymSpecProjection,
      validationId: validationReceipt.validationId,
      fixtureImportReceiptId: fixture.fixtureReceiptId,
      issuedAt: this.now().toISOString(),
    });
    if (command.commandKind !== "exercise") {
      throw new GymError(503, "service_unavailable", "The action command failed its server contract.");
    }
    return command;
  }

  private createFeedbackCommand(
    session: GymSession,
    source: ExerciseUiCommand,
    props: Record<string, unknown>,
  ): ExerciseUiCommand {
    gymComponentSchemas.CreditAssignmentReplay.parse(props);
    const command = codexUiCommandSchema.parse({
      ...source,
      commandId: this.makeId("command"),
      commandPurpose: "feedback",
      renderContractId: `${source.renderContractId}.feedback`,
      component: {
        type: "component",
        id: this.makeId("component"),
        name: "CreditAssignmentReplay",
        props,
        streamingState: "done",
      },
      componentSchemaVersion: getGymComponentDefinition(
        "CreditAssignmentReplay",
      ).schemaVersion,
      pedagogicalPropsSha256: gymDigest(props),
      issuedAt: this.now().toISOString(),
    });
    if (command.commandKind !== "exercise") {
      throw new GymError(503, "service_unavailable", "The feedback command failed its server contract.");
    }
    return command;
  }

  private createShellCommand(sessionId: string): CodexUiCommand {
    const props = {
      eyebrow: "PIONEER GYM / HUMAN RL SESSION",
      title: "What do you want to learn next?",
      description:
        "Codex operates each registered component. Pioneer chooses the curriculum branch that maximizes expected learning gain.",
      placeholder: "I want to make short-form product videos feel intentional.",
      submitLabel: "Build my first rep",
      examples: [
        "Improve visual hierarchy in social ads",
        "Know what to cut from a crowded frame",
      ],
      supportedEnvelope:
        "Hackathon slice: prompts are mapped honestly to visual hierarchy in short-form product video.",
      sessionTimeboxSeconds: 90,
    };
    gymComponentSchemas.LearningPrompt.parse(props);
    return codexUiCommandSchema.parse({
      commandKind: "shell",
      commandId: this.makeId("command"),
      sessionId,
      issuedBy: "codex",
      component: {
        type: "component",
        id: this.makeId("component"),
        name: "LearningPrompt",
        props,
        streamingState: "done",
      },
      componentSchemaVersion: getGymComponentDefinition("LearningPrompt")
        .schemaVersion,
      issuedAt: this.now().toISOString(),
    });
  }

  private receipt(
    kind: UiReceipt["kind"],
    title: string,
    summary: string,
    status: UiReceipt["status"],
    provenance: UiReceipt["provenance"],
    extra: Pick<UiReceipt, "reference" | "evidenceIds"> = {},
  ): UiReceipt {
    return {
      id: this.makeId("receipt"),
      kind,
      title,
      summary,
      status,
      provenance,
      ...extra,
    };
  }

  private assertExerciseContext(
    command: ExerciseUiCommand,
    event: Extract<
      HumanUiEvent,
      { type: "exercise.submitted" | "feedback.acknowledged" }
    >,
  ) {
    if (
      event.commandId !== command.commandId ||
      event.sourceComponentId !== command.component.id ||
      event.goalInstanceId !== command.goalInstanceId ||
      event.episodeId !== command.episodeId ||
      event.exerciseId !== command.exerciseId ||
      event.exerciseRevision !== command.exerciseRevision ||
      event.validationId !== command.validationId ||
      event.renderContractId !== command.renderContractId
    ) {
      throw new GymError(
        409,
        "stale_command",
        "This event is not bound to the currently visible Codex command.",
      );
    }
  }

  private assertActionValue(
    fixture: GymFixtureTemplate,
    event: Extract<HumanUiEvent, { type: "exercise.submitted" }>,
  ) {
    if (!sameContract(event.payload.action, fixture.responseContract)) {
      throw new GymError(
        409,
        "stale_command",
        "The submitted response contract does not match the visible exercise.",
      );
    }
    const value = strictObject(event.payload.action.value);
    if (!value) {
      throw new GymError(400, "invalid_request", "The response value must be an object.");
    }
    if (fixture.actionMode === "layer_order") {
      if (Object.keys(value).length !== 1 || !Array.isArray(value.layerOrder)) {
        throw new GymError(400, "invalid_request", "The transfer response requires one layerOrder field.");
      }
      const order = value.layerOrder;
      const expected = ["promise", "context", "proof", "support", "action"];
      if (
        order.length !== expected.length ||
        !order.every((item) => typeof item === "string") ||
        new Set(order).size !== expected.length ||
        expected.some((item) => !order.includes(item))
      ) {
        throw new GymError(400, "invalid_request", "layerOrder must be an exact permutation of the five visible layers.");
      }
      if (!event.payload.reasoningText) {
        throw new GymError(400, "invalid_request", "The transfer response requires observable reasoning text.");
      }
      return;
    }

    if (Object.keys(value).length !== 1 || typeof value.choiceId !== "string") {
      throw new GymError(400, "invalid_request", "The exercise response requires one choiceId field.");
    }
    const props = actionProps(fixture) as {
      variants?: Array<{ id: string }>;
      options?: Array<{ id: string }>;
    };
    const allowed = (props.variants ?? props.options ?? []).map((item) => item.id);
    if (!allowed.includes(value.choiceId)) {
      throw new GymError(400, "invalid_request", "choiceId must name one visible option.");
    }
    if (!event.payload.reasoningText && event.payload.reasoningTagIds.length === 0) {
      throw new GymError(400, "invalid_request", "The response requires an observable reason or reasoning tag.");
    }
  }

  private assertPioneerChoice(
    recommendation: PioneerCurriculumChoice,
    eligible: GymTemplateId[],
    evidenceId: string,
  ) {
    if (
      !eligible.includes(
        recommendation.recommendedChallengeTemplateId as GymTemplateId,
      ) ||
      recommendation.evidenceIds.length !== 1 ||
      recommendation.evidenceIds[0] !== evidenceId
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Pioneer returned a curriculum choice outside the eligible, evidence-bound set.",
      );
    }
  }

  private assertPioneerFixtureSemantics(
    recommendation: PioneerCurriculumChoice,
    fixture: GymFixtureTemplate,
  ) {
    if (
      recommendation.recommendedSubskill !== fixture.subskill ||
      recommendation.recommendedActionMode !== fixture.actionMode ||
      recommendation.episodeRole !== fixture.episodeRole
    ) {
      throw new GymError(
        503,
        "provider_contract_violation",
        "Pioneer recommendation semantics do not match the selected immutable fixture.",
      );
    }
  }

  private assertPhase(session: GymSession, expected: EnginePhase) {
    if (session.phase !== expected) {
      throw new GymError(
        409,
        "stale_command",
        "This event is not valid in the session’s current state.",
      );
    }
  }

  private currentExerciseCommand(session: GymSession): ExerciseUiCommand {
    if (!session.currentCommand || session.currentCommand.commandKind !== "exercise") {
      throw new GymError(
        409,
        "stale_command",
        "The session has no active exercise command.",
      );
    }
    return session.currentCommand;
  }

  private async callCodex<T>(
    session: GymSession,
    operation: (context: ProviderCallContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.codexClient.isReady()) {
      throw new GymError(503, "provider_unavailable", "Codex execution is not ready.");
    }
    if (session.budget.codexCalls >= this.codexCallsPerSession) {
      throw new GymError(
        429,
        "provider_budget",
        "This session has used its three Codex execution turns.",
      );
    }
    return this.providerGate.run((context) => {
      session.budget.codexCalls += 1;
      return operation(context);
    }, signal);
  }

  private async callPioneer<T>(
    session: GymSession,
    operation: (context: ProviderCallContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.pioneerClient.isReady()) {
      throw new GymError(503, "provider_unavailable", "Pioneer curriculum optimization is not ready.");
    }
    if (session.budget.pioneerCalls >= this.pioneerCallsPerSession) {
      throw new GymError(
        429,
        "provider_budget",
        "This session has used its three Pioneer curriculum calls.",
      );
    }
    return this.providerGate.run((context) => {
      session.budget.pioneerCalls += 1;
      return operation(context);
    }, signal);
  }

  private activeSessionCount() {
    let active = 0;
    for (const session of this.sessions.values()) {
      if (session.phase !== "complete") active += 1;
    }
    return active;
  }

  private assertSessionCapacity() {
    if (this.activeSessionCount() >= this.maxActiveSessions) {
      throw new GymError(
        429,
        "session_capacity",
        "The two live demo session slots are occupied. Retry shortly.",
        { retryAfterSeconds: 30 },
      );
    }
  }

  private ensureRetainedCapacity() {
    while (this.sessions.size >= this.maxRetainedSessions) {
      let oldestCompleted: GymSession | undefined;
      for (const session of this.sessions.values()) {
        if (
          session.phase === "complete" &&
          (!oldestCompleted ||
            session.createdAtMs < oldestCompleted.createdAtMs)
        ) {
          oldestCompleted = session;
        }
      }
      if (!oldestCompleted) {
        throw new GymError(
          429,
          "session_capacity",
          "The retained demo session limit is occupied. Retry after an active session expires.",
          { retryAfterSeconds: 30 },
        );
      }
      this.sessions.delete(oldestCompleted.sessionId);
    }
  }

  private touch(session: GymSession) {
    session.expiresAtMs = Math.min(
      this.now().getTime() + this.sessionTtlMs,
      session.absoluteExpiresAtMs,
    );
  }

  private pruneExpired() {
    const now = this.now().getTime();
    for (const [sessionId, session] of this.sessions) {
      if (
        session.expiresAtMs <= now ||
        session.absoluteExpiresAtMs <= now
      ) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export function createGymEngine(options: GymEngineOptions = {}) {
  return new GymEngine(options);
}
