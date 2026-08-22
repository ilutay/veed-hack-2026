import {
  CodexActionProvider,
  useCodexAction,
  type AppMode,
} from "@/components/CodexActionProvider";
import { AgentChat } from "@/components/AgentChat";
import { AssetLibrary } from "@/components/AssetLibrary";
import { LessonRenderError } from "@/components/LessonRenderError";
import { LessonRuntime } from "@/lib/registry";
import { ComponentRenderer } from "@tambo-ai/react";
import { Link } from "react-router-dom";

function onboardingComplete(
  mode: AppMode,
  profile: { onboarding?: { status?: string } } | null,
): boolean {
  return mode === "demo" || profile?.onboarding?.status === "complete";
}

function BlockStage() {
  const { episodeId, turnId, blocks, pending, error } = useCodexAction();

  return (
    <main>
      {pending && blocks.length === 0 ? (
        <p className="receipt">Loading profile…</p>
      ) : pending ? (
        <p className="receipt">Codex is responding…</p>
      ) : null}
      {error ? <p className="receipt">Action failed: {error}</p> : null}
      {blocks.map((block) => (
        <div className="block" key={block.id}>
          <ComponentRenderer
            content={block}
            threadId={episodeId}
            messageId={turnId}
            fallback={<LessonRenderError name={block.name} />}
          />
        </div>
      ))}
    </main>
  );
}

function AppShell({ mode }: { mode: AppMode }) {
  const { profile } = useCodexAction();
  const ready = onboardingComplete(mode, profile);

  return (
    <div className="app-shell">
      <div className="wrap">
        <header className="app-header">
          <div className="app-brand">
            <span className="app-brand-dot" />
            <span>Taste Labs // Ed-01</span>
          </div>
          <div className="receipt">
            {mode === "demo" ? (
              <Link to="/">← Workflow Mode</Link>
            ) : (
              <Link to="/demo">Fixture Demo →</Link>
            )}
          </div>
        </header>
        {ready ? <AssetLibrary /> : null}
        <BlockStage />
      </div>
      {ready ? <AgentChat /> : null}
    </div>
  );
}

export function LessonApp({ mode = "workflow" }: { mode?: AppMode }) {
  return (
    <LessonRuntime>
      <CodexActionProvider mode={mode}>
        <AppShell mode={mode} />
      </CodexActionProvider>
    </LessonRuntime>
  );
}
