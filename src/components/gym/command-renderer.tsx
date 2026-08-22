"use client";

import { Component, useEffect, useState, type ReactNode } from "react";

import {
  verifyCodexUiCommandIntegrity,
  type CommandIntegrityResult,
} from "@/lib/gym-ui/command-integrity";
import {
  compareArenaPropsSchema,
  creditAssignmentReplayPropsSchema,
  layerOrderTransferGymPropsSchema,
  learningPromptPropsSchema,
  safeExerciseFallbackPropsSchema,
  targetedRetryGymPropsSchema,
  type CodexUiCommand,
  type GymComponentName,
} from "@/lib/gym-ui/gym-contract";

import { useCodexActions } from "./codex-action-context";
import {
  CompareArena,
  CreditAssignmentReplay,
  LayerOrderTransferGym,
  LearningPrompt,
  SafeExerciseFallback,
  TargetedRetryGym,
} from "./gym-components";
import styles from "./gym.module.css";

class GymRenderBoundary extends Component<
  { children: ReactNode; resetKey: string; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className={styles.rendererFailure} role="alert">
          <div>
            <strong>The selected exercise could not render.</strong>
            <p>Codex has been notified and can issue only a separately validated safe exercise.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function RendererSkeleton() {
  return (
    <div className={styles.rendererSkeleton} aria-live="polite">
      <div>
        <strong>Preparing your next exercise…</strong>
        <p>Codex is checking the component and its evidence binding.</p>
      </div>
    </div>
  );
}

function RegisteredGymComponent({
  name,
  props,
}: {
  name: GymComponentName;
  props: unknown;
}) {
  switch (name) {
    case "LearningPrompt":
      return <LearningPrompt {...learningPromptPropsSchema.parse(props)} />;
    case "CompareArena":
      return <CompareArena {...compareArenaPropsSchema.parse(props)} />;
    case "CreditAssignmentReplay":
      return (
        <CreditAssignmentReplay
          {...creditAssignmentReplayPropsSchema.parse(props)}
        />
      );
    case "TargetedRetryGym":
      return (
        <TargetedRetryGym {...targetedRetryGymPropsSchema.parse(props)} />
      );
    case "LayerOrderTransferGym":
      return (
        <LayerOrderTransferGym
          {...layerOrderTransferGymPropsSchema.parse(props)}
        />
      );
    case "SafeExerciseFallback":
      return (
        <SafeExerciseFallback {...safeExerciseFallbackPropsSchema.parse(props)} />
      );
  }
}

export function CommandRenderer({ command }: { command: CodexUiCommand }) {
  const { pending, reportComponentFailure } = useCodexActions();
  const [verified, setVerified] = useState<{
    commandId: string;
    result: CommandIntegrityResult;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void verifyCodexUiCommandIntegrity(command).then((result) => {
      if (active) setVerified({ commandId: command.commandId, result });
    });
    return () => {
      active = false;
    };
  }, [command]);

  const integrity =
    verified?.commandId === command.commandId ? verified.result : null;

  if (!integrity) return <RendererSkeleton />;

  if (!integrity.success) {
    const invalidProps = integrity.code === "props_schema_invalid";
    return (
      <div className={styles.rendererFailure} role="alert">
        <div>
          <strong>
            {invalidProps
              ? "Codex selected invalid component props."
              : "The render command did not match this exercise."}
          </strong>
          <p>The command was stopped before render. No unvalidated exercise was shown.</p>
          <button
            className={styles.primaryButton}
            disabled={pending}
            onClick={() => reportComponentFailure(integrity.code)}
            type="button"
          >
            Ask Codex for a safe path
          </button>
        </div>
      </div>
    );
  }

  return (
    <GymRenderBoundary
      onFailure={() => void reportComponentFailure("component_render_exception")}
      resetKey={command.commandId}
    >
      <RegisteredGymComponent
        name={command.component.name}
        props={integrity.props}
      />
    </GymRenderBoundary>
  );
}
