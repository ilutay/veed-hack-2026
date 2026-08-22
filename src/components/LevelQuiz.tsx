import { useCodexAction } from "@/components/CodexActionProvider";
import type { QuizQuestionPublic } from "@/lib/onboarding";
import {
  getQuiz,
  postQuiz,
  PROFILE_POLL_INTERVAL_MS,
  PROFILE_POLL_TIMEOUT_MS,
  type QuizChoiceId,
} from "@/lib/profiles";
import type { LevelQuizProps } from "@/lib/schemas";
import { useEffect, useState } from "react";

export function LevelQuiz({ slug }: LevelQuizProps) {
  const { dispatch, pending, profile, setProfile } = useCodexAction();
  const resolvedSlug = slug || profile?.slug || "";
  const [questions, setQuestions] = useState<QuizQuestionPublic[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, QuizChoiceId>>({});
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    if (!resolvedSlug) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const poll = async () => {
      try {
        const result = await getQuiz(resolvedSlug);
        if (cancelled) return;
        if (result.ok) {
          setQuestions(result.questions);
          setWaiting(false);
          setError(null);
          return;
        }
        if (result.status === 404) {
          setError("Unknown profile");
          setWaiting(false);
          return;
        }
        if (result.status !== 202 && result.status !== 409) {
          setError(`HTTP ${result.status}`);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "poll failed");
      }
      if (Date.now() - started > PROFILE_POLL_TIMEOUT_MS) {
        if (!cancelled) {
          setError("Timed out waiting for the quiz");
          setWaiting(false);
        }
        return;
      }
      timer = setTimeout(poll, PROFILE_POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [resolvedSlug]);

  const allAnswered =
    questions !== null &&
    questions.length > 0 &&
    questions.every((q) => answers[q.id]);

  if (!resolvedSlug) {
    return (
      <section>
        <h1 className="display">Level check</h1>
        <p className="dim">No profile slug.</p>
      </section>
    );
  }

  if (error && !questions) {
    return (
      <section>
        <h1 className="display">Level check</h1>
        <p className="dim">{error}</p>
      </section>
    );
  }

  if (waiting || !questions) {
    return (
      <section className="snap">
        <h1 className="display">Level check</h1>
        <p className="receipt">Researching your interests…</p>
        <div className="stage stage-short">
          <div className="missing">
            <strong className="display">Researching</strong>
            <span>
              Receipt is in. The quiz mounts when the onboarding pack is on
              disk.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form
      className="quiz snap"
      onSubmit={(e) => {
        e.preventDefault();
        if (!allAnswered || pending) return;
        void (async () => {
          try {
            const body = await postQuiz(resolvedSlug, answers);
            setProfile(body.profile);
            await dispatch({
              type: "quiz_submitted",
              payload: { slug: resolvedSlug, answers },
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not submit");
          }
        })();
      }}
    >
      <h1 className="display">Level check</h1>
      <p className="objective">
        A short quiz so we can pitch topics at the right height. Submit when
        every question has an answer.
      </p>
      {questions.map((q, i) => (
        <fieldset key={q.id} className="quiz-q">
          <legend>
            {i + 1}. {q.prompt}
          </legend>
          <div className="quiz-choices">
            {q.choices.map((c) => {
              const on = answers[q.id] === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="btn"
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() =>
                    setAnswers((cur) => ({ ...cur, [q.id]: c.id }))
                  }
                >
                  <span className="quiz-id">{c.id}</span>
                  {c.text}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="composer-row">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || !allAnswered}
        >
          {pending ? "Scoring…" : "Submit answers"}
        </button>
      </div>
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
