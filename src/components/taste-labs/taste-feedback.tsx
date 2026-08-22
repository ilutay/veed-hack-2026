"use client";

import {
  TASTE_REACTIONS,
  type TasteFeedbackProps,
  type TasteReaction,
} from "@/lib/taste-labs/contracts";

import { useTasteLabsDemo } from "./taste-labs-demo-provider";

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
  const { dispatch } = useTasteLabsDemo();
  return (
    <section className="tasteSnap">
      <p className="tasteEyebrow">EPHEMERAL DEMO FEEDBACK</p>
      <h1 className="tasteDisplay tasteMisreg">How was that?</h1>
      <p className="tasteObjective">
        Pick a reaction to inspect the interaction. It is acknowledged in
        browser state and then discarded—there is no profile, memory, or write.
      </p>
      <div className="tasteChips">
        {TASTE_REACTIONS.map((reaction) => (
          <button
            className="tasteButton"
            key={reaction}
            onClick={() =>
              dispatch({
                type: "taste_reaction",
                payload: { run_id, reaction },
              })
            }
            type="button"
          >
            {LABELS[reaction]}
          </button>
        ))}
      </div>
    </section>
  );
}
