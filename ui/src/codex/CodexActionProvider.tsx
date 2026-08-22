import React, { createContext, useContext, useMemo } from "react";

/**
 * Our own action channel. Registered gym components emit structured events
 * here; the host forwards them to Codex, which calls Pioneer and sends back the
 * next component block.
 *
 * This deliberately replaces Tambo's thread/input machinery. Tambo is used ONLY
 * as a component registry plus renderer — there is no Tambo API key, no thread,
 * no useTamboThreadInput().submit(), and no Pioneer-to-Tambo call. Routing
 * interactions through here is what keeps that boundary intact.
 */

/** A structured interaction emitted by a gym component. */
export interface CodexGymEvent {
  /** Which gym surface produced this. */
  component: string;
  /** Codex episode the event belongs to (mirrors the render threadId). */
  episodeId: string;
  /** Codex turn the event belongs to (mirrors the render messageId). */
  turnId: string;
  /** What the learner did. */
  action: string;
  /** Action-specific detail; must be JSON-serialisable. */
  payload: Record<string, unknown>;
}

export interface CodexActionContextValue {
  /** Emit an interaction back to Codex. */
  emit: (event: CodexGymEvent) => void;
  /** Identifies the block currently on screen. */
  episodeId: string;
  turnId: string;
}

const CodexActionContext = createContext<CodexActionContextValue | null>(null);

export interface CodexActionProviderProps {
  episodeId: string;
  turnId: string;
  /** Transport to Codex. Injected so tests can assert on emitted events. */
  onEvent: (event: CodexGymEvent) => void;
}

export function CodexActionProvider({
  episodeId,
  turnId,
  onEvent,
  children,
}: React.PropsWithChildren<CodexActionProviderProps>) {
  const value = useMemo<CodexActionContextValue>(
    () => ({ episodeId, turnId, emit: onEvent }),
    [episodeId, turnId, onEvent],
  );

  return (
    <CodexActionContext.Provider value={value}>
      {children}
    </CodexActionContext.Provider>
  );
}

/**
 * Read the Codex action channel.
 *
 * Throws outside a provider rather than no-opping: a gym component that
 * silently drops its events looks like it works and stalls the episode.
 */
export function useCodexAction(): CodexActionContextValue {
  const ctx = useContext(CodexActionContext);
  if (!ctx) {
    throw new Error(
      "useCodexAction must be used inside a CodexActionProvider. " +
        "Gym components emit interactions through the Codex action boundary.",
    );
  }
  return ctx;
}
