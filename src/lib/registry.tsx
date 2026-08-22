import { LessonPlayer } from "@/components/LessonPlayer";
import { NextChoices } from "@/components/NextChoices";
import { PromptComposer } from "@/components/PromptComposer";
import { TasteFeedback } from "@/components/TasteFeedback";
import {
  LessonPlayerSchema,
  NextChoicesSchema,
  PromptComposerSchema,
  TasteFeedbackSchema,
} from "@/lib/schemas";
import { TamboRegistryProvider, type TamboComponent } from "@tambo-ai/react";
import type { ReactNode } from "react";

// Registry + renderer only. Codex (this app's backend) owns the event loop.
// We do not mount Tambo Cloud: no agent provider, no cloud API key, no thread
// input hook, no public Tambo env vars.

export const lessonComponents: TamboComponent[] = [
  {
    name: "PromptComposer",
    description:
      "Show when the learner should type a topic. Use after boot and after taste feedback.",
    component: PromptComposer,
    propsSchema: PromptComposerSchema,
  },
  {
    name: "LessonPlayer",
    description:
      "Show after start_run returns a run_id. Polls the run until artifacts exist, then plays the lesson. Props are run_id or runBase, never a video URL.",
    component: LessonPlayer,
    propsSchema: LessonPlayerSchema,
  },
  {
    name: "NextChoices",
    description:
      "Show after playback ends. Renders A/B/C (deeper/wider/applied) from the lesson script for this run_id.",
    component: NextChoices,
    propsSchema: NextChoicesSchema,
  },
  {
    name: "TasteFeedback",
    description:
      "Show after the learner picks a next-topic direction. Reaction chips from the taste-profile enum; props are the run_id.",
    component: TasteFeedback,
    propsSchema: TasteFeedbackSchema,
  },
];

export function LessonRuntime({ children }: { children: ReactNode }) {
  return (
    <TamboRegistryProvider
      components={lessonComponents}
      tools={[]}
      mcpServers={[]}
    >
      {children}
    </TamboRegistryProvider>
  );
}
