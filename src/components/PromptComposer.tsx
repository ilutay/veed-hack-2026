import { useCodexAction } from "@/components/CodexActionProvider";
import type { PromptComposerProps } from "@/lib/schemas";
import { useState } from "react";

export function PromptComposer({ seed_topic }: PromptComposerProps) {
  const { dispatch, pending, mode } = useCodexAction();
  const [topic, setTopic] = useState(seed_topic ?? "");
  const demo = mode === "demo";

  return (
    <form
      className="composer snap"
      onSubmit={(e) => {
        e.preventDefault();
        const value = topic.trim();
        if (!value || pending) return;
        void dispatch({ type: "topic_submitted", payload: { topic: value } });
      }}
    >
      <h1 className="display">What do you want to learn?</h1>
      <p className="objective">
        {demo
          ? "Demo mode runs the fixture lesson. No providers are called."
          : "Type any topic. The engine performs research, crafts an educational script, and synthesizes visual slides."}
      </p>
      <div className="composer-row">
        <input
          type="text"
          name="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. the dot-com bubble, quantum entanglement..."
          autoComplete="off"
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || !topic.trim()}
        >
          {pending ? "Starting…" : "Start lesson →"}
        </button>
      </div>
    </form>
  );
}
