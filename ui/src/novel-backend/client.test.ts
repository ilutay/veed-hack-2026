import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CodexUiCommand,
  ExerciseUiCommand,
  GymApiRequest,
} from "./client";
import {
  NovelBackendError,
  buildComponentFailedEvent,
  buildExerciseSubmittedEvent,
  buildFeedbackAcknowledgedEvent,
  buildStartEvent,
  checkAccess,
  isUnauthorizedError,
  postGym,
  unlockAccess,
} from "./client";

const HASH = "a".repeat(64);
const NOW = "2026-08-22T12:00:00.000Z";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function shellCommand(props: unknown = {
  eyebrow: "PIONEER GYM / HUMAN LEARNING",
  title: "What do you want to learn?",
  description: "Describe a skill or judgment you want to practice.",
  placeholder: "I want to make intentional product videos.",
  submitLabel: "Start practicing",
  examples: ["Teach me visual hierarchy."],
  supportedEnvelope: "Demo focus: visual hierarchy and creative judgment.",
  sessionTimeboxSeconds: 90,
}): CodexUiCommand {
  return {
    commandKind: "shell",
    commandId: "command_shell_1",
    sessionId: "session_1",
    issuedBy: "codex",
    component: {
      type: "component",
      id: "component_shell_1",
      name: "LearningPrompt",
      props,
      streamingState: "done",
    },
    componentSchemaVersion: "learning-prompt-v1",
    issuedAt: NOW,
  };
}

function exerciseCommand(): ExerciseUiCommand {
  return {
    commandKind: "exercise",
    commandPurpose: "exercise",
    commandId: "command_exercise_1",
    sessionId: "session_1",
    goalInstanceId: "goal_1",
    episodeId: "episode_1",
    exerciseId: "exercise_1",
    exerciseRevision: 3,
    issuedBy: "codex",
    renderContractId: "render_1",
    component: {
      type: "component",
      id: "component_exercise_1",
      name: "CompareArena",
      props: {},
      streamingState: "done",
    },
    componentSchemaVersion: "compare-arena-v1",
    pedagogicalPropsSha256: HASH,
    gymSpecHash: HASH,
    gymSpecProjection: {
      schemaVersion: "gym-spec-v1",
      exerciseId: "exercise_1",
      revision: 3,
      challengeTemplateId: "challenge_1",
      episodeRole: "baseline",
      actionMode: "choose",
      subskill: "visual hierarchy",
      responseContract: {
        schemaId: "response_1",
        schemaVersion: "response-v1",
        schemaSha256: HASH,
      },
      estimatedSeconds: 60,
      fixtureImportReceiptId: "fixture_1",
      renderContract: {
        renderContractId: "render_1",
        phase: "action",
        componentName: "CompareArena",
        componentSchemaVersion: "compare-arena-v1",
        pedagogicalProps: {},
        pedagogicalPropsSha256: HASH,
      },
      contentHashVersion: "gym-jcs-v1",
    },
    validationId: "validation_1",
    fixtureImportReceiptId: "fixture_1",
    issuedAt: NOW,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("novel backend access client", () => {
  it("checks the signed-cookie session with same-origin credentials", async () => {
    const fetchImpl = fetchReturning(jsonResponse({ authenticated: true }));

    await expect(checkAccess({ fetchImpl })).resolves.toEqual({
      authenticated: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/access",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("treats a 401 access check as locked and identifies unlock failures", async () => {
    const lockedFetch = fetchReturning(
      jsonResponse(
        { error: "Access required", code: "unauthorized", retryable: false },
        401,
      ),
    );
    await expect(checkAccess({ fetchImpl: lockedFetch })).resolves.toEqual({
      authenticated: false,
    });

    const rejectedFetch = fetchReturning(
      jsonResponse(
        { error: "Invalid code", code: "unauthorized", retryable: false },
        401,
      ),
    );
    const error = await unlockAccess("wrong", {
      fetchImpl: rejectedFetch,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NovelBackendError);
    expect(isUnauthorizedError(error)).toBe(true);
  });

  it("unlocks with a trimmed code without exposing it outside the JSON body", async () => {
    const fetchImpl = fetchReturning(
      jsonResponse({ ok: true, expiresAt: "2026-08-22T12:15:00.000Z" }),
    );

    await expect(unlockAccess("  demo-code  ", { fetchImpl })).resolves.toEqual({
      ok: true,
      expiresAt: "2026-08-22T12:15:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessCode: "demo-code" }),
        credentials: "same-origin",
      }),
    );
  });
});

describe("novel backend gym client", () => {
  const startRequest = (): GymApiRequest => ({
    sessionId: "session_1",
    event: buildStartEvent(shellCommand(), "Teach me visual hierarchy", {
      eventId: "event_start_1",
      clientCreatedAt: NOW,
    }),
  });

  it("accepts only a canonical response whose command passes browser integrity", async () => {
    const command = shellCommand();
    const fetchImpl = fetchReturning(
      jsonResponse({ sessionId: "session_1", command, receipts: [] }),
    );

    const result = await postGym(startRequest(), { fetchImpl });

    expect(result.command).toEqual(command);
    expect(result.verifiedProps).toEqual(command.component.props);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/gym",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify(startRequest()),
      }),
    );
  });

  it("fails closed when a well-shaped command has invalid component props", async () => {
    const fetchImpl = fetchReturning(
      jsonResponse({
        sessionId: "session_1",
        command: shellCommand({}),
        receipts: [],
      }),
    );

    const error = await postGym(startRequest(), { fetchImpl }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(NovelBackendError);
    expect(error).toMatchObject({ code: "command_integrity_failed" });
  });

  it("rejects a non-canonical request before making a network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const invalidRequest = {
      ...startRequest(),
      sessionId: "a different session",
    } as GymApiRequest;

    await expect(postGym(invalidRequest, { fetchImpl })).rejects.toMatchObject({
      code: "invalid_gym_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("canonical event builders", () => {
  it("binds submit and feedback events to every immutable exercise field", () => {
    const command = exerciseCommand();
    const submit = buildExerciseSubmittedEvent(
      command,
      {
        actionValue: { choiceId: "frame-b" },
        responseContract: command.gymSpecProjection.responseContract,
        reasoningText: "  The promise leads before proof.  ",
        reasoningTagIds: ["focal-order"],
        statedConfidence: "medium",
      },
      {
        eventId: "event_submit_1",
        responseId: "response_1",
        clientCreatedAt: NOW,
        submittedAt: NOW,
      },
    );

    expect(submit).toMatchObject({
      eventId: "event_submit_1",
      idempotencyKey: "event_submit_1",
      sessionId: command.sessionId,
      sourceComponentId: command.component.id,
      commandId: command.commandId,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
      payload: {
        responseId: "response_1",
        reasoningText: "The promise leads before proof.",
        action: {
          ...command.gymSpecProjection.responseContract,
          value: { choiceId: "frame-b" },
        },
      },
    });

    const feedback = buildFeedbackAcknowledgedEvent(command, "evidence_1", {
      eventId: "event_feedback_1",
      clientCreatedAt: NOW,
    });
    expect(feedback).toMatchObject({
      commandId: command.commandId,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
      payload: { evidenceId: "evidence_1" },
    });
  });

  it("binds component failure to the exact failed command", () => {
    const command = exerciseCommand();
    const failure = buildComponentFailedEvent(
      command,
      "component_render_exception",
      { eventId: "event_failure_1", clientCreatedAt: NOW },
    );

    expect(failure).toMatchObject({
      commandId: command.commandId,
      sourceComponentId: command.component.id,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
      payload: {
        errorCode: "component_render_exception",
        failedCommandId: command.commandId,
      },
    });
  });
});
