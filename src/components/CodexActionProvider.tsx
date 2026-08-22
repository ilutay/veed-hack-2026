import {
  blocksForProfile,
  componentBlock,
  newId,
  type CodexAction,
  type CodexActionResponse,
} from "@/lib/codex";
import type { LearnerProfile } from "@/lib/onboarding";
import { PROFILE_STORAGE_KEY } from "@/lib/onboarding";
import { getProfile } from "@/lib/profiles";
import type { TamboComponentContent } from "@tambo-ai/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  profile: LearnerProfile | null;
  setProfile: (profile: LearnerProfile | null) => void;
  dispatch: (action: CodexAction) => Promise<void>;
};

const CodexActionContext = createContext<CodexContextValue | null>(null);

const BOOT_EPISODE = "boot";
const BOOT_TURN = "boot-0";

function demoBootBlocks(): TamboComponentContent[] {
  return [componentBlock("PromptComposer", {}, "boot-composer")];
}

function gateBootBlocks(): TamboComponentContent[] {
  return [componentBlock("ProfileGate", {}, "boot-gate")];
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
  const [blocks, setBlocks] = useState<TamboComponentContent[]>(() =>
    mode === "demo" ? demoBootBlocks() : [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [booting, setBooting] = useState(mode !== "demo");

  useEffect(() => {
    if (mode === "demo") return;
    let cancelled = false;
    const slug =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PROFILE_STORAGE_KEY)
        : null;
    if (!slug) {
      setBlocks(gateBootBlocks());
      setBooting(false);
      return;
    }
    void (async () => {
      try {
        const next = await getProfile(slug);
        if (cancelled) return;
        if (!next) {
          window.localStorage.removeItem(PROFILE_STORAGE_KEY);
          setBlocks(gateBootBlocks());
          return;
        }
        setProfile(next);
        setBlocks(blocksForProfile(next));
      } catch {
        if (!cancelled) setBlocks(gateBootBlocks());
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

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
        if (body.profile) setProfile(body.profile);
      } catch (e) {
        setError(e instanceof Error ? e.message : "action failed");
      } finally {
        setPending(false);
      }
    },
    [episodeId, mode],
  );

  const value = useMemo(
    () => ({
      mode,
      episodeId,
      turnId,
      blocks,
      pending: pending || booting,
      error,
      profile,
      setProfile,
      dispatch,
    }),
    [mode, episodeId, turnId, blocks, pending, booting, error, profile, dispatch],
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
