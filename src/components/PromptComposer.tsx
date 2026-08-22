"use client";

import { useCodexAction } from "@/components/CodexActionProvider";
import { WidthFollowTitle } from "@/components/WidthFollowTitle";
import type { PromptComposerProps } from "@/lib/schemas";
import { useState } from "react";

export function PromptComposer({ seed_topic }: PromptComposerProps) {
  const { dispatch, pending } = useCodexAction();
  const [topic, setTopic] = useState(seed_topic ?? "");

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
      <WidthFollowTitle>What do you want to learn?</WidthFollowTitle>
      <p className="objective">
        Type a topic. Codex starts a pipeline run and this page mounts a player
        against the receipt — it does not wait for a render.
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
