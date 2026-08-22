"use client";

import {
  type CodexAction,
  type CodexActionResponse,
  componentBlock,
  newId,
} from "@/lib/codex";
import type { TamboComponentContent } from "@tambo-ai/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppMode = "demo" | "workflow";

type CodexContextValue = {
  mode: AppMode;
  episodeId: string;
  turnId: string;
  blocks: TamboComponentContent[];
  pending: boolean;
  error: string | null;
  dispatch: (action: CodexAction) => Promise<void>;
};

const CodexActionContext = createContext<CodexContextValue | null>(null);

const BOOT_EPISODE = "boot";
const BOOT_TURN = "boot-0";

function bootBlocks(): TamboComponentContent[] {
  return [componentBlock("PromptComposer", {}, "boot-composer")];
}

export function CodexActionProvider({
  children,
  mode = "workflow",
}: {
  children: ReactNode;
  mode?: AppMode;
}) {
  const [episodeId, setEpisodeId] = useState(BOOT_EPISODE);
  const [turnId, setTurnId] = useState(BOOT_TURN);
  const [blocks, setBlocks] = useState<TamboComponentContent[]>(bootBlocks);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (action: CodexAction) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/codex/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            episodeId: episodeId === BOOT_EPISODE ? newId("ep") : episodeId,
            mode,
            action,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const body = (await res.json()) as CodexActionResponse;
        setEpisodeId(body.episodeId);
        setTurnId(body.turnId);
        setBlocks(body.blocks);
      } catch (e) {
        setError(e instanceof Error ? e.message : "action failed");
      } finally {
        setPending(false);
      }
    },
    [episodeId, mode],
  );

  const value = useMemo(
    () => ({ mode, episodeId, turnId, blocks, pending, error, dispatch }),
    [mode, episodeId, turnId, blocks, pending, error, dispatch],
  );

  return (
    <CodexActionContext.Provider value={value}>
      {children}
    </CodexActionContext.Provider>
  );
}

export function useCodexAction(): CodexContextValue {
  const ctx = useContext(CodexActionContext);
  if (!ctx) {
    throw new Error("useCodexAction must be used within CodexActionProvider");
  }
  return ctx;
}
