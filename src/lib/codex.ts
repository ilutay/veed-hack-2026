import type { TamboComponentContent } from "@tambo-ai/react";
import type { ChoiceLabel, TasteReaction } from "./schemas";

export type CodexAction =
  | { type: "topic_submitted"; payload: { topic: string } }
  | {
      type: "choice_selected";
      payload: { run_id: string; label: ChoiceLabel; direction?: string };
    }
  | {
      type: "taste_reaction";
      payload: { run_id: string; reaction: TasteReaction };
    }
  | { type: "playback_ended"; payload: { run_id: string } };

export type CodexActionResponse = {
  status: "submitted";
  episodeId: string;
  turnId: string;
  run_id?: string;
  blocks: TamboComponentContent[];
};

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function componentBlock(
  name: string,
  props: Record<string, unknown>,
  id?: string,
): TamboComponentContent {
  return {
    type: "component",
    id: id ?? newId(name.toLowerCase()),
    name,
    props,
  };
}
