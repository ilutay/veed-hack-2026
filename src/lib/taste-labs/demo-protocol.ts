import type { TamboComponentContent } from "@tambo-ai/react";

import {
  TASTE_LABS_FIXTURE_RUN_ID,
  TasteLabsDemoActionSchema,
  type TasteLabsDemoAction,
} from "./contracts";

export type TasteLabsDemoState = {
  turn: number;
  blocks: TamboComponentContent[];
  notice: string;
};

function componentBlock(
  name: "PromptComposer" | "LessonPlayer" | "NextChoices" | "TasteFeedback",
  props: Record<string, unknown>,
  turn: number,
): TamboComponentContent {
  return {
    type: "component",
    id: `taste-labs-${turn}-${name.toLowerCase()}`,
    name,
    props,
    streamingState: "done",
  };
}

export function initialTasteLabsDemoState(): TasteLabsDemoState {
  return {
    turn: 0,
    blocks: [componentBlock("PromptComposer", {}, 0)],
    notice:
      "Fixture gallery: your prompt stays in this browser and opens the tracked dot-com lesson.",
  };
}

export function reduceTasteLabsDemoState(
  state: TasteLabsDemoState,
  rawAction: TasteLabsDemoAction,
): TasteLabsDemoState {
  const action = TasteLabsDemoActionSchema.parse(rawAction);
  const turn = state.turn + 1;

  switch (action.type) {
    case "topic_submitted":
      return {
        turn,
        blocks: [
          componentBlock(
            "LessonPlayer",
            { run_id: TASTE_LABS_FIXTURE_RUN_ID },
            turn,
          ),
        ],
        notice: `“${action.payload.topic}” was kept browser-local. Showing fixture-dotcom; no workflow or provider was called.`,
      };
    case "playback_ended":
      return {
        turn,
        blocks: [
          componentBlock(
            "NextChoices",
            { run_id: TASTE_LABS_FIXTURE_RUN_ID },
            turn,
          ),
        ],
        notice: "Choices are read from the tracked fixture lesson script.",
      };
    case "choice_selected":
      return {
        turn,
        blocks: [
          componentBlock(
            "TasteFeedback",
            { run_id: TASTE_LABS_FIXTURE_RUN_ID },
            turn,
          ),
        ],
        notice: `Selected ${action.payload.label}: ${action.payload.direction}. This demo does not start another run.`,
      };
    case "taste_reaction":
      return {
        turn,
        blocks: [componentBlock("PromptComposer", {}, turn)],
        notice: `Reaction “${action.payload.reaction}” acknowledged locally and discarded; this fixture demo stores no profile or memory.`,
      };
  }
}
