import { useCodexAction } from "@/components/CodexActionProvider";
import { WidthFollowTitle } from "@/components/WidthFollowTitle";
import { postInterests, SUGGESTED_INTERESTS } from "@/lib/profiles";
import type { InterestSurveyProps } from "@/lib/schemas";
import { useState } from "react";

const MAX_INTERESTS = 5;

export function InterestSurvey({ slug }: InterestSurveyProps) {
  const { dispatch, pending, profile, setProfile } = useCodexAction();
  const resolvedSlug = slug || profile?.slug || "";
  const researching = profile?.onboarding.status === "researching";
  const [selected, setSelected] = useState<string[]>(
    () => profile?.onboarding.interests?.slice(0, MAX_INTERESTS) ?? [],
  );
  const [custom, setCustom] = useState("");
  const [goal, setGoal] = useState(profile?.onboarding.goal ?? "");
  const [error, setError] = useState<string | null>(null);

  const toggle = (label: string) => {
    setSelected((cur) => {
      if (cur.includes(label)) return cur.filter((x) => x !== label);
      if (cur.length >= MAX_INTERESTS) return cur;
      return [...cur, label];
    });
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    setSelected((cur) => {
      if (cur.includes(value) || cur.length >= MAX_INTERESTS) return cur;
      return [...cur, value];
    });
    setCustom("");
  };

  const busy = pending || researching;

  return (
    <form
      className="composer snap"
      onSubmit={(e) => {
        e.preventDefault();
        if (!resolvedSlug || selected.length < 1 || busy) return;
        setError(null);
        void (async () => {
          try {
            const body = await postInterests(
              resolvedSlug,
              selected,
              goal.trim() || undefined,
            );
            setProfile(body.profile);
            await dispatch({
              type: "interests_submitted",
              payload: {
                slug: resolvedSlug,
                interests: selected,
                ...(goal.trim() ? { goal: goal.trim() } : {}),
              },
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not submit");
          }
        })();
      }}
    >
      <WidthFollowTitle>What are you into?</WidthFollowTitle>
      <p className="objective">
        Pick a few topics, or add your own. At least one. At most five.
      </p>
      <div className="taste">
        {SUGGESTED_INTERESTS.map((label) => {
          const on = selected.includes(label);
          return (
            <button
              key={label}
              type="button"
              className={`btn taste-chip${on ? " btn-primary" : ""}`}
              disabled={busy || (!on && selected.length >= MAX_INTERESTS)}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          );
        })}
        {selected
          .filter(
            (s) => !(SUGGESTED_INTERESTS as readonly string[]).includes(s),
          )
          .map((label) => (
            <button
              key={label}
              type="button"
              className="btn taste-chip btn-primary"
              disabled={busy}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="composer-row" style={{ marginTop: "12px" }}>
        <input
          type="text"
          name="custom-interest"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add your own"
          autoComplete="off"
          disabled={busy || selected.length >= MAX_INTERESTS}
        />
        <button
          className="btn"
          type="button"
          disabled={busy || !custom.trim() || selected.length >= MAX_INTERESTS}
          onClick={addCustom}
        >
          Add
        </button>
      </div>
      <label className="field-label">
        Optional goal
        <textarea
          name="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What do you want to be able to do?"
          rows={3}
          disabled={busy}
        />
      </label>
      <div className="composer-row">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || selected.length < 1 || !resolvedSlug}
        >
          {researching ? "Researching…" : pending ? "Submitting…" : "Continue"}
        </button>
      </div>
      {researching ? (
        <p className="receipt">Researching your interests…</p>
      ) : null}
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
