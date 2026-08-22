import { useCodexAction } from "@/components/CodexActionProvider";
import {
  TASTE_REACTIONS,
  type TasteFeedbackProps,
  type TasteReaction,
} from "@/lib/schemas";

const LABELS: Record<TasteReaction, string> = {
  "too-fast": "Too fast",
  "too-slow": "Too slow",
  "too-basic": "Too basic",
  "too-technical": "Too technical",
  "more-examples": "More examples",
  "less-waffle": "Less waffle",
  "loved-the-visuals": "Loved the visuals",
  "confusing-visuals": "Confusing visuals",
  "nailed-it": "Nailed it",
};

export function TasteFeedback({ run_id }: TasteFeedbackProps) {
  const { dispatch, pending } = useCodexAction();

  return (
    <section className="snap">
      <h2>How was that?</h2>
      <p className="objective">
        Tap a reaction. Codex writes it onto the taste profile for the next
        topic.
      </p>
      <div className="taste">
        {TASTE_REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            className="btn taste-chip"
            disabled={pending}
            onClick={() =>
              void dispatch({
                type: "taste_reaction",
                payload: { run_id, reaction },
              })
            }
          >
            {LABELS[reaction]}
          </button>
        ))}
      </div>
    </section>
  );
}
