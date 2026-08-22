"use client";

import {
  CodexActionProvider,
  useCodexAction,
} from "@/components/CodexActionProvider";
import { LessonRenderError } from "@/components/LessonRenderError";
import { LessonRuntime } from "@/lib/registry";
import { ComponentRenderer } from "@tambo-ai/react";

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

export function LessonApp() {
  return (
    <LessonRuntime>
      <CodexActionProvider>
        <div className="wrap">
          <BlockStage />
        </div>
      </CodexActionProvider>
    </LessonRuntime>
  );
}
