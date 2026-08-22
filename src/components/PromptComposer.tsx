"use client";

import { useCodexAction } from "@/components/CodexActionProvider";
import { WidthFollowTitle } from "@/components/WidthFollowTitle";
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
      {demo ? (
        <WidthFollowTitle>What do you want to learn?</WidthFollowTitle>
      ) : (
        <h1 className="display misreg">What do you want to learn?</h1>
      )}
      <p className="objective">
        {demo
          ? "Demo mode plays the fixture lesson. The title stretches under the pointer."
          : "Type a topic. Codex researches it, writes a 15-second script, then generates slides and voiceover."}
      </p>
      <div className="composer-row">
        <input
          type="text"
          name="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. the dot-com bubble"
          autoComplete="off"
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || !topic.trim()}
        >
          {pending ? "Starting…" : "Start lesson"}
        </button>
      </div>
    </form>
  );
}
