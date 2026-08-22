import { useCodexAction } from "@/components/CodexActionProvider";
import type { RecommendedTopic } from "@/lib/onboarding";
import {
  getProfile,
  PROFILE_POLL_INTERVAL_MS,
  PROFILE_POLL_TIMEOUT_MS,
} from "@/lib/profiles";
import type { RecommendedTopicsProps } from "@/lib/schemas";
import { useEffect, useState } from "react";

const LABELS = ["A", "B", "C", "D", "E"] as const;

function directionFor(topic: RecommendedTopic): string {
  if (topic.level === "advanced") return "applied";
  if (topic.level === "beginner") return "wider";
  return "deeper";
}

export function RecommendedTopics({ slug }: RecommendedTopicsProps) {
  const { dispatch, pending, profile, setProfile } = useCodexAction();
  const resolvedSlug = slug || profile?.slug || "";
  const [topics, setTopics] = useState<RecommendedTopic[] | null>(
    profile?.onboarding.recommended_topics ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedSlug) return;
    if (topics && topics.length > 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const poll = async () => {
      try {
        const next = await getProfile(resolvedSlug);
        if (cancelled) return;
        if (!next) {
          setError("Unknown profile");
          return;
        }
        const recs = next.onboarding.recommended_topics;
        if (next.onboarding.status === "complete" && recs?.length) {
          setProfile(next);
          setTopics(recs);
          return;
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "poll failed");
      }
      if (Date.now() - started > PROFILE_POLL_TIMEOUT_MS) {
        if (!cancelled) setError("Timed out waiting for recommendations");
        return;
      }
      timer = setTimeout(poll, PROFILE_POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [resolvedSlug, setProfile, topics]);

  if (error && !topics?.length) {
    return (
      <section>
        <h2 className="display misreg">Start here</h2>
        <p className="dim">{error}</p>
      </section>
    );
  }

  if (!topics?.length) {
    return (
      <section>
        <h2 className="display misreg">Start here</h2>
        <p className="receipt">Scoring your quiz…</p>
      </section>
    );
  }

  return (
    <section className="next-sec snap">
      <h2 className="display misreg">Start here</h2>
      <p className="objective">
        Three topics pitched at your level. Pick one, or type your own below.
      </p>
      <div className="choices">
        {topics.map((topic, i) => (
          <button
            key={`${topic.topic}-${i}`}
            type="button"
            className="choice snap"
            data-direction={directionFor(topic)}
            disabled={pending}
            onClick={() =>
              void dispatch({
                type: "recommendation_selected",
                payload: { topic: topic.topic },
              })
            }
          >
            <div className="band">
              <span className="label">
                OPTION {LABELS[i] ?? String(i + 1)}
              </span>
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
