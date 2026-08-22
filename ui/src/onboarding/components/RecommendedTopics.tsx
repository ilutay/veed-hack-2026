import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { useProfile } from "../ProfileProvider";
import type { RecommendedTopicsProps } from "../schemas";
import type { RecommendedTopic } from "../types";

const LABELS = ["A", "B", "C", "D", "E"] as const;

function directionFor(topic: RecommendedTopic): string {
  if (topic.level === "advanced") return "applied";
  if (topic.level === "beginner") return "wider";
  return "deeper";
}

/**
 * Topic cards authored by Codex once the quiz is scored. While the bridge is
 * still scoring, ProfileProvider polls the profile and this re-renders when
 * the recommendations land.
 */
export function RecommendedTopics(_props: RecommendedTopicsProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const { profile, retryResearch } = useProfile();
  const [picked, setPicked] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const o = profile?.onboarding;
  const topics = o?.recommended_topics ?? [];

  if (!profile) {
    return (
      <section>
        <h2 className="display misreg">Start here</h2>
        <p className="dim">No profile is active.</p>
      </section>
    );
  }

  if (!topics.length) {
    const failed = profile.research?.status === "failed";
    return (
      <section className="snap" data-testid="recommended-topics" data-status={failed ? "failed" : "waiting"}>
        <h2 className="display misreg">Start here</h2>
        {failed ? (
          <>
            <p className="receipt">Research failed: {profile.research?.error ?? "unknown error"}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRetryError(null);
                void retryResearch().catch((err) =>
                  setRetryError(err instanceof Error ? err.message : "retry failed"),
                );
              }}
            >
              Retry
            </button>
            {retryError ? <p className="receipt">{retryError}</p> : null}
          </>
        ) : o?.status === "scoring" ? (
          <p className="receipt">Scoring your quiz and planning your first topics…</p>
        ) : (
          <p className="dim">Finish the level check to get recommendations.</p>
        )}
      </section>
    );
  }

  return (
    <section className="next-sec snap" data-testid="recommended-topics" data-status="ready">
      <h2 className="display misreg">Start here</h2>
      <p className="objective">
        {o?.level && o.quiz_score ? `You placed ${o.level} (${o.quiz_score.correct}/${o.quiz_score.total}). ` : null}
        Three topics pitched at your level. Pick one, or tell the agent what you want.
      </p>
      <div className="choices">
        {topics.map((topic, i) => (
          <button
            key={`${topic.topic}-${i}`}
            type="button"
            className="choice snap"
            data-direction={directionFor(topic)}
            data-testid="recommended-topic"
            aria-pressed={picked === topic.topic}
            disabled={picked !== null}
            onClick={() => {
              setPicked(topic.topic);
              emit({
                component: "RecommendedTopics",
                episodeId,
                turnId,
                action: "recommendation.selected",
                payload: { topic: topic.topic, level: topic.level },
              });
            }}
          >
            <div className="band">
              <span className="label">OPTION {LABELS[i] ?? String(i + 1)}</span>
              <span className="direction-tag">{topic.level}</span>
            </div>
            <span className="direction">{topic.topic}</span>
            <span className="choice-why">{topic.why}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
