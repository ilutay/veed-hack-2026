import { useEffect, useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { getQuiz, PROFILE_POLL_MS, PROFILE_POLL_TIMEOUT_MS } from "../api";
import { useProfile } from "../ProfileProvider";
import type { LevelQuizProps } from "../schemas";
import type { QuizChoiceId, QuizQuestion } from "../types";

/**
 * The placement quiz. It is researched on the bridge (Tavily) and authored by
 * Codex from the learner's interests, so this polls until the pack exists,
 * then collects answers. Correct ids never reach the browser.
 */
export function LevelQuiz({ slug }: LevelQuizProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const { profile, submitQuiz, retryResearch } = useProfile();
  const resolvedSlug = slug || profile?.slug || "";
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, QuizChoiceId>>({});
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!resolvedSlug) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const poll = async () => {
      try {
        const result = await getQuiz(resolvedSlug);
        if (cancelled) return;
        if (result.kind === "ok") {
          setQuestions(result.questions);
          setFailed(null);
          return;
        }
        if (result.kind === "missing") {
          setFailed("Unknown profile");
          return;
        }
        if (result.kind === "failed") {
          setFailed(result.error);
          return;
        }
      } catch (err) {
        // A dropped poll is not a dead research job; keep trying until the deadline.
        if (cancelled) return;
        if ((err as { status?: number }).status === 409) {
          setFailed("The quiz is not available for this profile yet — submit your interests first.");
          return;
        }
      }
      if (Date.now() - started > PROFILE_POLL_TIMEOUT_MS) {
        if (!cancelled) setFailed("Timed out waiting for the quiz to be researched.");
        return;
      }
      timer = setTimeout(poll, PROFILE_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [resolvedSlug, attempt]);

  const allAnswered = questions !== null && questions.length > 0 && questions.every((q) => answers[q.id]);

  if (!resolvedSlug) {
    return (
      <section>
        <h2 className="display misreg">Level check</h2>
        <p className="dim">No profile is active.</p>
      </section>
    );
  }

  if (failed && !questions) {
    return (
      <section className="snap" data-testid="level-quiz" data-status="failed">
        <h2 className="display misreg">Level check</h2>
        <p className="receipt">Research failed: {failed}</p>
        <button
          type="button"
          className="btn"
          data-testid="quiz-retry"
          onClick={() => {
            setFailed(null);
            void retryResearch()
              .then(() => setAttempt((n) => n + 1))
              .catch((err) => setFailed(err instanceof Error ? err.message : "retry failed"));
          }}
        >
          Retry research
        </button>
      </section>
    );
  }

  if (!questions) {
    return (
      <section className="snap" data-testid="level-quiz" data-status="researching">
        <h2 className="display misreg">Level check</h2>
        <p className="receipt">Researching your interests and writing your quiz…</p>
        <div className="stage" style={{ aspectRatio: "16 / 5" }}>
          <div className="missing">
            <strong className="display">Researching</strong>
            <span>Tavily is gathering sources; Codex writes the questions from them. This takes a minute.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form
      className="quiz snap"
      data-testid="level-quiz"
      data-status="ready"
      onSubmit={(event) => {
        event.preventDefault();
        if (!allAnswered || done || busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const next = await submitQuiz(answers);
            setDone(true);
            emit({
              component: "LevelQuiz",
              episodeId,
              turnId,
              action: "quiz.submitted",
              payload: {
                slug: next.slug,
                score: next.onboarding.quiz_score ?? null,
                level: next.onboarding.level ?? null,
              },
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not submit");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h2 className="display misreg">Level check</h2>
      <p className="objective">
        A short quiz so we can pitch topics at the right height. Submit when every question has an answer.
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
                  className={`btn${on ? " btn-primary" : ""}`}
                  aria-pressed={on}
                  disabled={done || busy}
                  onClick={() => setAnswers((cur) => ({ ...cur, [q.id]: c.id }))}
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
        <button className="btn btn-primary" type="submit" data-testid="quiz-submit" disabled={done || busy || !allAnswered}>
          {done ? "Submitted" : busy ? "Scoring…" : "Submit answers"}
        </button>
      </div>
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
