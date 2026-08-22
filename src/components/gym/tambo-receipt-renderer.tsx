"use client";

import {
  Component,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ComponentRenderer,
  TamboRegistryProvider,
  type TamboComponentContent,
} from "@tambo-ai/react";

import {
  verifyCodexUiCommandIntegrity,
  type CommandIntegrityResult,
} from "@/lib/tambo/command-integrity";
import type { CodexUiCommand } from "@/lib/tambo/gym-contract";
import { gymTamboComponents } from "@/lib/tambo/gym-registry";

import { useCodexActions } from "./codex-action-context";
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
            <strong>The selected component could not render.</strong>
            <p>Codex has been notified. It may issue only a separately validated safe exercise.</p>
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
        <strong>Mounting the Codex-selected component…</strong>
        <p>The registered exercise is loading.</p>
      </div>
    </div>
  );
}

/**
 * Tambo v1.3 registers provider components in an effect. Waiting one task
 * avoids asking ComponentRenderer to resolve an intentionally empty registry
 * during SSR and the first client render. The registry hook is intentionally
 * not part of Tambo's public package exports, so readiness stays local.
 */
function RegistryReadyRenderer({
  command,
  content,
}: {
  command: CodexUiCommand;
  content: TamboComponentContent;
}) {
  const [registryReady, setRegistryReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setRegistryReady(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!registryReady) {
    return <RendererSkeleton />;
  }

  return (
    <ComponentRenderer
      content={content}
      fallback={<RendererSkeleton />}
      messageId={command.commandId}
      threadId={command.sessionId}
    />
  );
}

export function TamboReceiptRenderer({ command }: { command: CodexUiCommand }) {
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
              : "The Codex render receipt did not match the exercise."}
          </strong>
          <p>The command was stopped before rendering. No unvalidated exercise was shown.</p>
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

  const content: TamboComponentContent = {
    ...command.component,
    props: integrity.props,
    streamingState: "done",
  };

  return (
    <TamboRegistryProvider components={gymTamboComponents}>
      <GymRenderBoundary
        onFailure={() => void reportComponentFailure("component_render_exception")}
        resetKey={command.commandId}
      >
        <RegistryReadyRenderer command={command} content={content} />
      </GymRenderBoundary>
    </TamboRegistryProvider>
  );
}
