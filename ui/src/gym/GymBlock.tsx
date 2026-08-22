import { useEffect, useState } from "react";
import { ComponentRenderer, type TamboComponentContent } from "@tambo-ai/react";
import { CodexActionProvider, type CodexGymEvent } from "../codex/CodexActionProvider";
import { GymRenderError } from "./components/GymRenderError";
import { GymErrorBoundary } from "./GymErrorBoundary";

/** The component command Codex sends after it calls Pioneer. */
export interface CodexComponentCommand {
  componentId: string;
  componentName: string;
  props: Record<string, unknown>;
  episodeId: string;
  turnId: string;
  pioneerReceipt?: {
    requestId: string;
    mode: "live";
    phase: "diagnose" | "feedback" | "retry" | "transfer";
    focus: string;
    reason: string;
  };
}

export interface GymBlockProps {
  command: CodexComponentCommand;
  onEvent: (event: CodexGymEvent) => void;
  /** Shown while the registry hydrates. */
  pending?: React.ReactNode;
}

/**
 * Renders one Codex component command.
 *
 * The episode/turn ids double as Tambo's threadId/messageId: ComponentRenderer
 * requires both and forwards them to ComponentContentProvider, which is what
 * scopes per-component state. Reusing our own ids keeps the two consistent
 * without introducing an actual Tambo thread.
 *
 * The `ready` gate is not ceremony. TamboRegistryProvider seeds componentList
 * from useState({}) and fills it in an effect, so the very first render of any
 * block resolves against an empty registry: ComponentRenderer logs a
 * "Component not found" error and paints `fallback`. Mounting the renderer one
 * tick later means the registry is populated by the time it looks, which keeps
 * GymRenderError meaning "Codex named a component we do not have" instead of
 * flashing on every well-formed block.
 */
export function GymBlock({ command, onEvent, pending = null }: GymBlockProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const block: TamboComponentContent = {
    type: "component",
    id: command.componentId,
    name: command.componentName,
    props: command.props,
  };

  return (
    <CodexActionProvider
      episodeId={command.episodeId}
      turnId={command.turnId}
      onEvent={onEvent}
    >
      {ready ? (
        <GymErrorBoundary key={block.id} fallback={<GymRenderError />}>
          <ComponentRenderer
            content={block}
            threadId={command.episodeId}
            messageId={command.turnId}
            fallback={<GymRenderError />}
          />
        </GymErrorBoundary>
      ) : (
        pending
      )}
    </CodexActionProvider>
  );
}
