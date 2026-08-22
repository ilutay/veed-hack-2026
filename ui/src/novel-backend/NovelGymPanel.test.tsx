import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CodexUiCommand,
  CompareArenaProps,
  CreditAssignmentReplayProps,
  GymApiRequest,
  JourneyProgress,
  LayerOrderTransferGymProps,
  SafeExerciseFallbackProps,
  TargetedRetryGymProps,
  UiReceipt,
} from "../../../src/lib/tambo/gym-contract";
import type { VerifiedGymApiResponse } from "./client";

const backend = vi.hoisted(() => ({
  checkAccess: vi.fn(),
  unlockAccess: vi.fn(),
  postGym: vi.fn(),
  buildStartEvent: vi.fn(),
  buildExerciseSubmittedEvent: vi.fn(),
  buildFeedbackAcknowledgedEvent: vi.fn(),
}));

vi.mock("./client", () => ({
  ...backend,
  createBrowserSessionId: () => "session_browser",
  isUnauthorizedError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "status" in error && error.status === 401),
}));

import { NovelGymPanel } from "./NovelGymPanel";

const digest = "a".repeat(64);
const responseContract = {
  schemaId: "response-contract",
  schemaVersion: "1.0.0",
  schemaSha256: digest,
};
const validationReceipt = {
  validationId: "validation_1",
  exerciseId: "exercise_1",
  exerciseRevision: 1,
  judgment: "PASS" as const,
  provenance: "prevalidated" as const,
  contentHash: digest,
  contentHashVersion: "gym-jcs-v1" as const,
  sourceLabel: "CERTIFIED REP",
};
const variants = [
  {
    id: "frame-a",
    label: "Frame A",
    headline: "Everything first",
    supportingCopy: "Three competing signals",
    cta: "Choose A",
    composition: "competing" as const,
    accent: "coral" as const,
  },
  {
    id: "frame-b",
    label: "Frame B",
    headline: "Promise first",
    supportingCopy: "One clear path",
    cta: "Choose B",
    composition: "clear" as const,
    accent: "lime" as const,
  },
] as const;

const compareProps: CompareArenaProps = {
  phaseLabel: "REP 01",
  title: "Choose the clearer frame",
  instruction: "Choose and explain the signal.",
  brief: "Make the first beat unmistakable.",
  responseContract,
  validationReceipt,
  variants: [...variants],
  reasoningPrompt: "What created the focal order?",
  reasoningTags: [{ id: "promise-first", label: "Promise first" }],
  timeLimitSeconds: 30,
  submitLabel: "Commit response",
};

const retryProps: TargetedRetryGymProps = {
  ...compareProps,
  title: "Try a focused retry",
  targetConstraint: "Make one promise lead.",
  whyThisRep: "Your last response exposed this edge.",
  evidenceIds: ["evidence_1"],
};

const feedbackProps: CreditAssignmentReplayProps = {
  phaseLabel: "CREDIT ASSIGNMENT",
  title: "Your choice had a clear path",
  summary: "The promise led before proof and action.",
  selectedLabel: "Frame B",
  artifact: variants[1],
  anchors: [
    { id: "anchor_1", label: "Promise", note: "It owns the first beat.", x: 30, y: 30, tone: "signal" },
  ],
  criteria: [
    { criterionId: "criterion_1", label: "Focal order", outcome: "met", observation: "The focal promise leads." },
  ],
  evidenceId: "evidence_exact_42",
  confidenceCalibration: "aligned",
  nextLabel: "Find my next edge",
};

const transferProps: LayerOrderTransferGymProps = {
  phaseLabel: "HELD-OUT TRANSFER",
  title: "Order a changed format",
  instruction: "Put the layers in reading order.",
  brief: "Move from comparison to construction.",
  responseContract,
  validationReceipt,
  transferLabel: "Changed context",
  changedContext: "Wide frame to vertical story",
  changedAction: "Choose to order",
  layers: [
    { id: "promise", label: "Promise", role: "focal", copy: "Stay dry" },
    { id: "proof", label: "Proof", role: "proof", copy: "Sealed seams" },
    { id: "action", label: "Action", role: "action", copy: "Shop now" },
  ],
  targetBrief: "Promise, proof, then action.",
  submitLabel: "Submit transfer",
};

const fallbackProps: SafeExerciseFallbackProps = {
  phaseLabel: "SAFE FALLBACK",
  title: "Choose the clear path",
  instruction: "Use the accessible fixed choice.",
  brief: "Identify intentional hierarchy.",
  responseContract,
  validationReceipt,
  disclosure: "The dynamic exercise was not available.",
  prompt: "Which path is clearest?",
  options: [
    { id: "path-a", label: "Everything equally loud", description: "Signals compete." },
    { id: "path-b", label: "Promise, proof, action", description: "Each layer earns the next." },
  ],
  submitLabel: "Submit accessible response",
};

const progress = (learningStatus: JourneyProgress["learningStatus"] = "practicing"): JourneyProgress => ({
  steps: [
    { id: "prompt", label: "Prompt", state: "complete" },
    { id: "validate", label: "Validate", state: "complete" },
    { id: "practice", label: "Practice", state: "active" },
    { id: "adapt", label: "Adapt", state: "upcoming" },
    { id: "transfer", label: "Transfer", state: "upcoming" },
  ],
  learningStatus,
});

const receipt: UiReceipt = {
  id: "receipt_1",
  kind: "assessment",
  title: "Response evidence",
  summary: "Choice and reasoning recorded.",
  status: "scored",
  provenance: "deterministic_rubric_policy",
};

function exerciseCommand(
  name: "CompareArena" | "TargetedRetryGym" | "LayerOrderTransferGym" | "SafeExerciseFallback",
  props: unknown,
): CodexUiCommand {
  return {
    commandKind: "exercise",
    commandPurpose: "exercise",
    commandId: `command_${name}`,
    sessionId: "session_browser",
    goalInstanceId: "goal_1",
    episodeId: "episode_1",
    exerciseId: "exercise_1",
    exerciseRevision: 1,
    issuedBy: "codex",
    renderContractId: "render_1",
    component: { type: "component", id: `component_${name}`, name, props, streamingState: "done" },
    componentSchemaVersion: "test-v1",
    pedagogicalPropsSha256: digest,
    gymSpecHash: digest,
    gymSpecProjection: {} as never,
    validationId: "validation_1",
    issuedAt: "2026-08-22T12:00:00.000Z",
  };
}

function feedbackCommand(): CodexUiCommand {
  return {
    ...exerciseCommand("CompareArena", compareProps),
    commandPurpose: "feedback",
    commandId: "command_feedback",
    component: {
      type: "component",
      id: "component_feedback",
      name: "CreditAssignmentReplay",
      props: feedbackProps,
      streamingState: "done",
    },
  } as CodexUiCommand;
}

function response(command: CodexUiCommand, verifiedProps: unknown, learningStatus: JourneyProgress["learningStatus"] = "practicing"): VerifiedGymApiResponse {
  return {
    sessionId: command.sessionId,
    command,
    verifiedProps,
    receipts: [receipt],
    progress: progress(learningStatus),
    message: "The next rep is ready.",
  };
}

function installBuilders() {
  backend.buildStartEvent.mockImplementation((command: CodexUiCommand, rawPrompt: string) => ({
    eventId: "event_start",
    idempotencyKey: "event_start",
    sessionId: command.sessionId,
    sourceComponentId: command.component.id,
    clientCreatedAt: "2026-08-22T12:00:00.000Z",
    type: "start",
    payload: { rawPrompt },
  }));
  backend.buildExerciseSubmittedEvent.mockImplementation((_command: CodexUiCommand, draft: unknown) => ({
    eventId: "event_submit",
    idempotencyKey: "event_submit",
    sessionId: "session_browser",
    sourceComponentId: "component_exercise",
    clientCreatedAt: "2026-08-22T12:00:00.000Z",
    type: "exercise.submitted",
    payload: draft,
  }));
  backend.buildFeedbackAcknowledgedEvent.mockImplementation((_command: CodexUiCommand, evidenceId: string) => ({
    eventId: "event_ack",
    idempotencyKey: "event_ack",
    sessionId: "session_browser",
    sourceComponentId: "component_feedback",
    clientCreatedAt: "2026-08-22T12:00:00.000Z",
    type: "feedback.acknowledged",
    payload: { evidenceId },
  }));
}

beforeEach(() => {
  backend.checkAccess.mockResolvedValue({ authenticated: true });
  backend.unlockAccess.mockResolvedValue({ ok: true, expiresAt: "2026-08-22T13:00:00.000Z" });
  installBuilders();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function startInto(command: CodexUiCommand, verifiedProps: unknown, onComplete?: () => void) {
  backend.postGym.mockResolvedValueOnce(response(command, verifiedProps));
  render(<NovelGymPanel initialPrompt="Make this lesson stick" onComplete={onComplete} />);
  const prompt = await screen.findByLabelText("Learning goal");
  expect((prompt as HTMLTextAreaElement).value).toBe("Make this lesson stick");
  fireEvent.click(screen.getByRole("button", { name: "Build my first rep" }));
  await screen.findByTestId(command.component.name);
}

describe("NovelGymPanel", () => {
  it("shows an access-code form when the protected backend reports no session", async () => {
    backend.checkAccess.mockResolvedValueOnce({ authenticated: false });
    render(<NovelGymPanel initialPrompt="Visual hierarchy" />);

    const code = await screen.findByLabelText("Access code");
    fireEvent.change(code, { target: { value: "demo-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await screen.findByTestId("LearningPrompt");
    expect(backend.unlockAccess).toHaveBeenCalledWith("demo-code");
    expect((screen.getByLabelText("Learning goal") as HTMLTextAreaElement).value).toBe("Visual hierarchy");
  });

  it("starts from the complete shell command and never reconstructs its identity", async () => {
    const command = exerciseCommand("CompareArena", compareProps);
    backend.postGym.mockResolvedValueOnce(response(command, compareProps));
    render(<NovelGymPanel initialPrompt="Defend better edits" />);

    await screen.findByTestId("LearningPrompt");
    fireEvent.click(screen.getByRole("button", { name: "Build my first rep" }));
    await screen.findByTestId("CompareArena");

    const bootstrapCommand = backend.buildStartEvent.mock.calls[0][0] as CodexUiCommand;
    expect(bootstrapCommand).toMatchObject({
      commandKind: "shell",
      sessionId: "session_browser",
      component: { name: "LearningPrompt" },
    });
    expect(backend.buildStartEvent).toHaveBeenCalledWith(bootstrapCommand, "Defend better edits");
    const request = backend.postGym.mock.calls[0][0] as GymApiRequest;
    expect(request.sessionId).toBe(bootstrapCommand.sessionId);
    expect(screen.getByText("Response evidence")).toBeDefined();
    expect(screen.getByRole("list", { name: "Practice progress" })).toBeDefined();
  });

  it("submits the exact choice, response contract, reasoning and confidence against the visible command", async () => {
    const command = exerciseCommand("CompareArena", compareProps);
    await startInto(command, compareProps);
    backend.postGym.mockResolvedValueOnce(response(feedbackCommand(), feedbackProps));

    fireEvent.click(screen.getByRole("radio", { name: /Frame B/ }));
    fireEvent.change(screen.getByLabelText("What created the focal order?"), { target: { value: "The promise leads" } });
    fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit response" }));

    await screen.findByTestId("CreditAssignmentReplay");
    expect(backend.buildExerciseSubmittedEvent.mock.calls[0][0]).toBe(command);
    expect(backend.buildExerciseSubmittedEvent.mock.calls[0][1]).toEqual({
      actionValue: { choiceId: "frame-b" },
      responseContract,
      reasoningText: "The promise leads",
      reasoningTagIds: [],
      statedConfidence: "high",
    });
  });

  it("acknowledges the exact evidence id and completes only after that acknowledgement", async () => {
    const command = feedbackCommand();
    const onComplete = vi.fn();
    await startInto(command, feedbackProps, onComplete);
    backend.postGym.mockResolvedValueOnce({
      ...response(command, feedbackProps, "transfer_shown"),
      command: {
        commandKind: "shell",
        commandId: "command_complete",
        sessionId: "session_browser",
        issuedBy: "codex",
        component: {
          type: "component",
          id: "component_complete",
          name: "LearningPrompt",
          props: {},
          streamingState: "done",
        },
        componentSchemaVersion: "learning-prompt-v1",
        issuedAt: "2026-08-22T12:01:00.000Z",
      },
      verifiedProps: {},
    } as VerifiedGymApiResponse);

    fireEvent.click(screen.getByRole("button", { name: "Find my next edge" }));
    await screen.findByTestId("gym-complete");

    expect(backend.buildFeedbackAcknowledgedEvent.mock.calls[0][0]).toBe(command);
    expect(backend.buildFeedbackAcknowledgedEvent).toHaveBeenCalledWith(command, "evidence_exact_42");
    expect(onComplete).not.toHaveBeenCalled();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("submits the learner's changed layer order with its exact contract", async () => {
    const command = exerciseCommand("LayerOrderTransferGym", transferProps);
    await startInto(command, transferProps);
    backend.postGym.mockResolvedValueOnce(response(feedbackCommand(), feedbackProps, "transfer_shown"));

    fireEvent.click(screen.getByRole("button", { name: "Move Proof up" }));
    fireEvent.change(screen.getByLabelText("Why does this order answer the brief?"), { target: { value: "Proof supports the promise" } });
    fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit transfer" }));
    await screen.findByTestId("CreditAssignmentReplay");

    expect(backend.buildExerciseSubmittedEvent.mock.calls[0][0]).toBe(command);
    expect(backend.buildExerciseSubmittedEvent.mock.calls[0][1]).toEqual({
      actionValue: { layerOrder: ["proof", "promise", "action"] },
      responseContract,
      reasoningText: "Proof supports the promise",
      reasoningTagIds: [],
      statedConfidence: "medium",
    });
  });

  it.each([
    ["TargetedRetryGym", retryProps],
    ["SafeExerciseFallback", fallbackProps],
  ] as const)("renders the canonical %s command locally", async (name, props) => {
    const command = exerciseCommand(name, props);
    await startInto(command, props);
    expect(screen.getByTestId(name)).toBeDefined();
    expect(screen.getByTestId("gym-command-name").textContent).toContain(name);
  });
});
