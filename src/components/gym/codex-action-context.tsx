"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type {
  CodexUiCommand,
  ExerciseSubmissionDraft,
  HumanUiEvent,
} from "@/lib/gym-ui/gym-contract";

function createClientId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}_${suffix}`;
}

interface CodexActions {
  pending: boolean;
  start: (rawPrompt: string) => Promise<void>;
  submitExercise: (draft: ExerciseSubmissionDraft) => Promise<void>;
  acknowledgeFeedback: (evidenceId: string) => Promise<void>;
  reportComponentFailure: (errorCode: string) => Promise<void>;
}

const CodexActionContext = createContext<CodexActions | null>(null);

interface CodexActionProviderProps {
  children: ReactNode;
  command: CodexUiCommand;
  pending: boolean;
  emit: (event: HumanUiEvent) => Promise<void>;
}

export function CodexActionProvider({
  children,
  command,
  pending,
  emit,
}: CodexActionProviderProps) {
  const identity = useCallback(() => {
    const eventId = createClientId("event");

    return {
      eventId,
      idempotencyKey: eventId,
      sessionId: command.sessionId,
      sourceComponentId: command.component.id,
      clientCreatedAt: new Date().toISOString(),
    };
  }, [command.component.id, command.sessionId]);

  const exerciseContext = useCallback(() => {
    if (command.commandKind !== "exercise") {
      throw new Error("This action requires a Codex-issued exercise command.");
    }

    return {
      commandId: command.commandId,
      goalInstanceId: command.goalInstanceId,
      episodeId: command.episodeId,
      exerciseId: command.exerciseId,
      exerciseRevision: command.exerciseRevision,
      validationId: command.validationId,
      renderContractId: command.renderContractId,
    };
  }, [command]);

  const start = useCallback(
    async (rawPrompt: string) => {
      await emit({
        ...identity(),
        type: "start",
        payload: { rawPrompt },
      });
    },
    [emit, identity],
  );

  const submitExercise = useCallback(
    async (draft: ExerciseSubmissionDraft) => {
      const submittedAt = new Date().toISOString();

      await emit({
        ...identity(),
        ...exerciseContext(),
        type: "exercise.submitted",
        payload: {
          responseId: createClientId("response"),
          action: {
            ...draft.responseContract,
            value: draft.actionValue,
          },
          reasoningText: draft.reasoningText?.trim() || undefined,
          reasoningTagIds: draft.reasoningTagIds ?? [],
          statedConfidence: draft.statedConfidence,
          submittedAt,
        },
      });
    },
    [emit, exerciseContext, identity],
  );

  const acknowledgeFeedback = useCallback(
    async (evidenceId: string) => {
      await emit({
        ...identity(),
        ...exerciseContext(),
        type: "feedback.acknowledged",
        payload: { evidenceId },
      });
    },
    [emit, exerciseContext, identity],
  );

  const reportComponentFailure = useCallback(
    async (errorCode: string) => {
      const context =
        command.commandKind === "exercise" ? exerciseContext() : {};

      await emit({
        ...identity(),
        ...context,
        type: "ui.component_failed",
        payload: {
          errorCode,
          failedCommandId: command.commandId,
        },
      });
    },
    [command.commandId, command.commandKind, emit, exerciseContext, identity],
  );

  const value = useMemo<CodexActions>(
    () => ({
      pending,
      start,
      submitExercise,
      acknowledgeFeedback,
      reportComponentFailure,
    }),
    [acknowledgeFeedback, pending, reportComponentFailure, start, submitExercise],
  );

  return (
    <CodexActionContext.Provider value={value}>
      {children}
    </CodexActionContext.Provider>
  );
}

export function useCodexActions() {
  const context = useContext(CodexActionContext);

  if (!context) {
    throw new Error("Gym components must render inside CodexActionProvider.");
  }

  return context;
}
