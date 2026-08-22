import {
  CodexActionProvider,
  useCodexAction,
  type AppMode,
} from "@/components/CodexActionProvider";
import { AgentChat } from "@/components/AgentChat";
import { LessonRenderError } from "@/components/LessonRenderError";
import { LessonRuntime } from "@/lib/registry";
import { ComponentRenderer } from "@tambo-ai/react";
import { Link } from "react-router-dom";

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

export function LessonApp({ mode = "workflow" }: { mode?: AppMode }) {
  return (
    <LessonRuntime>
      <CodexActionProvider mode={mode}>
        <div className="app-shell">
          <div className="wrap">
            <header className="app-header">
              <div className="app-brand">
                <span className="app-brand-dot" />
                <span>Taste Labs // Ed-01</span>
              </div>
              <div className="receipt" style={{ margin: 0 }}>
                {mode === "demo" ? (
                  <Link to="/">← Workflow Mode</Link>
                ) : (
                  <Link to="/demo">Fixture Demo →</Link>
                )}
              </div>
            </header>
            <BlockStage />
          </div>
          {mode !== "demo" ? <AgentChat /> : null}
        </div>
      </CodexActionProvider>
    </LessonRuntime>
  );
}
