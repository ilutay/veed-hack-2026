import {
  CodexActionProvider,
  useCodexAction,
  type AppMode,
} from "@/components/CodexActionProvider";
import { LessonRenderError } from "@/components/LessonRenderError";
import { LessonRuntime } from "@/lib/registry";
import { ComponentRenderer } from "@tambo-ai/react";
import { Link } from "react-router-dom";

function BlockStage() {
  const { episodeId, turnId, blocks, pending, error } = useCodexAction();

  return (
    <main>
      {pending ? <p className="receipt">Codex is responding…</p> : null}
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
        <div className="wrap">
          <BlockStage />
          <p className="receipt" style={{ marginTop: "2rem" }}>
            {mode === "demo" ? (
              <Link to="/">← real workflow</Link>
            ) : (
              <Link to="/demo">font demo / fixture</Link>
            )}
          </p>
        </div>
      </CodexActionProvider>
    </LessonRuntime>
  );
}
