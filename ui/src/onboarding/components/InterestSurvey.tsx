import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { MAX_INTERESTS, SUGGESTED_INTERESTS } from "../logic";
import { useProfile } from "../ProfileProvider";
import type { InterestSurveyProps } from "../schemas";
import { WidthFollowTitle } from "./WidthFollowTitle";

export function InterestSurvey({ slug }: InterestSurveyProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const { profile, submitInterests } = useProfile();
  const [selected, setSelected] = useState<string[]>(
    () => profile?.onboarding.interests?.slice(0, MAX_INTERESTS) ?? [],
  );
  const [custom, setCustom] = useState("");
  const [goal, setGoal] = useState(profile?.onboarding.goal ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = selected.length >= MAX_INTERESTS;

  const toggle = (label: string) =>
    setSelected((cur) =>
      cur.includes(label) ? cur.filter((x) => x !== label) : cur.length >= MAX_INTERESTS ? cur : [...cur, label],
    );

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    setSelected((cur) => (cur.includes(value) || cur.length >= MAX_INTERESTS ? cur : [...cur, value]));
    setCustom("");
  };

  return (
    <form
      className="composer snap"
      data-testid="interest-survey"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected.length < 1 || done || busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const next = await submitInterests(selected, goal);
            setDone(true);
            emit({
              component: "InterestSurvey",
              episodeId,
              turnId,
              action: "interests.submitted",
              payload: {
                slug: slug || next.slug,
                interests: next.onboarding.interests ?? [],
                ...(next.onboarding.goal ? { goal: next.onboarding.goal } : {}),
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
      <WidthFollowTitle>What are you into?</WidthFollowTitle>
      <p className="objective">Pick a few topics, or add your own. At least one. At most five.</p>
      <div className="taste">
        {SUGGESTED_INTERESTS.map((label) => {
          const on = selected.includes(label);
          return (
            <button
              key={label}
              type="button"
              className={`btn taste-chip${on ? " btn-primary" : ""}`}
              aria-pressed={on}
              disabled={done || busy || (!on && full)}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          );
        })}
        {selected
          .filter((s) => !(SUGGESTED_INTERESTS as readonly string[]).includes(s))
          .map((label) => (
            <button
              key={label}
              type="button"
              className="btn taste-chip btn-primary"
              aria-pressed="true"
              disabled={done}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="composer-row" style={{ marginTop: 12 }}>
        <input
          type="text"
          name="custom-interest"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="Add your own"
          autoComplete="off"
          disabled={done || full}
        />
        <button className="btn" type="button" disabled={done || !custom.trim() || full} onClick={addCustom}>
          Add
        </button>
      </div>
      <label className="field-label">
        Optional goal
        <textarea
          name="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="What do you want to be able to do?"
          rows={3}
          disabled={done}
        />
      </label>
      <div className="composer-row">
        <button
          className="btn btn-primary"
          type="submit"
          data-testid="interests-submit"
          disabled={done || busy || selected.length < 1}
        >
          {done ? "Submitted" : busy ? "Submitting…" : "Continue"}
        </button>
      </div>
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
