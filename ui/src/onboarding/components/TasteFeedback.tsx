import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { TASTE_LABELS, TASTE_REACTIONS, type TasteReaction } from "../logic";
import { useProfile } from "../ProfileProvider";
import type { TasteFeedbackProps } from "../schemas";

export function TasteFeedback({ jobId }: TasteFeedbackProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const { react } = useProfile();
  const [picked, setPicked] = useState<TasteReaction | null>(null);

  return (
    <section className="snap" data-testid="taste-feedback">
      <h2 className="display misreg">How was that?</h2>
      <p className="objective">Tap a reaction. It shapes the pace, depth and examples of the next lesson.</p>
      <div className="taste">
        {TASTE_REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            className={`btn taste-chip${picked === reaction ? " btn-primary" : ""}`}
            data-testid="taste-chip"
            aria-pressed={picked === reaction}
            disabled={picked !== null}
            onClick={() => {
              setPicked(reaction);
              void react(reaction, jobId).catch(() => {});
              emit({
                component: "TasteFeedback",
                episodeId,
                turnId,
                action: "taste.reaction",
                payload: { jobId, reaction },
              });
            }}
          >
            {TASTE_LABELS[reaction]}
          </button>
        ))}
      </div>
    </section>
  );
}
