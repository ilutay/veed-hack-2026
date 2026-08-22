import { useMemo, useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { nextDirectionsFor } from "../logic";
import type { NextChoicesProps } from "../schemas";

/** A/B/C follow-ups once a lesson has played: deeper, wider, applied. */
export function NextChoices({ jobId, topic }: NextChoicesProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const choices = useMemo(() => nextDirectionsFor(topic), [topic]);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <section className="next-sec snap" data-testid="next-choices">
      <h2 className="display misreg">What next?</h2>
      <div className="choices">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className="choice snap"
            data-direction={choice.kind}
            data-testid="next-choice"
            aria-pressed={picked === choice.label}
            disabled={picked !== null}
            onClick={() => {
              setPicked(choice.label);
              emit({
                component: "NextChoices",
                episodeId,
                turnId,
                action: "choice.selected",
                payload: { jobId, label: choice.label, kind: choice.kind, topic: choice.topic },
              });
            }}
          >
            <div className="band">
              <span className="label">OPTION {choice.label}</span>
              <span className="direction-tag">{choice.kind}</span>
            </div>
            <span className="direction">{choice.topic}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
