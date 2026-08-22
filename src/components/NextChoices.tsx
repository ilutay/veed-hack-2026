import { useCodexAction } from "@/components/CodexActionProvider";
import type { ChoiceLabel, NextChoicesProps } from "@/lib/schemas";
import { useEffect, useState } from "react";

type Choice = { label: string; direction: string };

function dirOf(label: string) {
  return (
    ({ A: "deeper", B: "wider", C: "applied" } as const)[
      label as ChoiceLabel
    ] || "wider"
  );
}

export function NextChoices({ run_id }: NextChoicesProps) {
  const { dispatch, pending } = useCodexAction();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/run/${encodeURIComponent(run_id)}`);
        if (!res.ok)
          throw new Error(
            res.status === 404 ? "Unknown run" : `HTTP ${res.status}`,
          );
        const body = await res.json();
        if (cancelled) return;
        setChoices(body.script?.next_video ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run_id]);

  if (error) {
    return (
      <section>
        <h2 className="display misreg">What next?</h2>
        <p className="dim">{error}</p>
      </section>
    );
  }

  if (!choices) {
    return (
      <section>
        <h2 className="display misreg">What next?</h2>
        <p className="receipt">Loading choices…</p>
      </section>
    );
  }

  return (
    <section className="next-sec snap">
      <h2 className="display misreg">What next?</h2>
      <div className="choices">
        {choices.map((n) => {
          const dir = dirOf(n.label);
          return (
            <button
              key={n.label}
              type="button"
              className="choice snap"
              data-direction={dir}
              disabled={pending}
              onClick={() =>
                void dispatch({
                  type: "choice_selected",
                  payload: {
                    run_id,
                    label: n.label as ChoiceLabel,
                    direction: n.direction,
                  },
                })
              }
            >
              <div className="band">
                <span className="label">OPTION {n.label}</span>
                <span className="direction-tag">{dir}</span>
              </div>
              <span className="direction">{n.direction}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
