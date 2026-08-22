import { useEffect, useRef } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import type { StartLessonProps } from "../schemas";

/**
 * Codex's way of saying "render a lesson on this". It emits once on mount and
 * the host starts the render; the model never touches the bridge itself.
 */
export function StartLesson({ topic, reason }: StartLessonProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const emitted = useRef(false);
  const value = typeof topic === "string" ? topic.trim() : "";

  useEffect(() => {
    if (!value || emitted.current) return;
    emitted.current = true;
    emit({ component: "StartLesson", episodeId, turnId, action: "topic.submitted", payload: { topic: value } });
  }, [value, emit, episodeId, turnId]);

  if (!value) return <p className="receipt">Codex asked for a lesson without naming a topic.</p>;
  return (
    <p className="receipt" data-testid="start-lesson">
      {reason ? `${reason} ` : ""}Starting a lesson on “{value}”.
    </p>
  );
}
