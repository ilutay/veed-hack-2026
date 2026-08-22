import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import type { PromptComposerProps } from "../schemas";
import { WidthFollowTitle } from "./WidthFollowTitle";

export function PromptComposer({ seed_topic }: PromptComposerProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const [topic, setTopic] = useState(seed_topic ?? "");
  const [done, setDone] = useState(false);

  return (
    <form
      className="composer snap"
      data-testid="prompt-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const value = topic.trim();
        if (!value || done) return;
        setDone(true);
        emit({
          component: "PromptComposer",
          episodeId,
          turnId,
          action: "topic.submitted",
          payload: { topic: value },
        });
      }}
    >
      <WidthFollowTitle>What do you want to learn?</WidthFollowTitle>
      <p className="objective">
        Type any topic. Codex writes the script, then slides and a voiceover are rendered into a video.
      </p>
      <div className="composer-row">
        <input
          type="text"
          name="topic"
          data-testid="composer-topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="e.g. the dot-com bubble, quantum entanglement..."
          autoComplete="off"
          disabled={done}
        />
        <button className="btn btn-primary" type="submit" data-testid="composer-submit" disabled={done || !topic.trim()}>
          {done ? "Started" : "Start lesson →"}
        </button>
      </div>
    </form>
  );
}
