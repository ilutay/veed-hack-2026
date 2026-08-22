import { InterestSurvey } from "@/components/InterestSurvey";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LevelQuiz } from "@/components/LevelQuiz";
import { NextChoices } from "@/components/NextChoices";
import { ProfileGate } from "@/components/ProfileGate";
import { PromptComposer } from "@/components/PromptComposer";
import { RecommendedTopics } from "@/components/RecommendedTopics";
import { TasteFeedback } from "@/components/TasteFeedback";
import {
  InterestSurveySchema,
  LessonPlayerSchema,
  LevelQuizSchema,
  NextChoicesSchema,
  ProfileGateSchema,
  PromptComposerSchema,
  RecommendedTopicsSchema,
  TasteFeedbackSchema,
} from "@/lib/schemas";
import { TamboRegistryProvider, type TamboComponent } from "@tambo-ai/react";
import type { ReactNode } from "react";

// Registry + renderer only. Codex (this app's backend) owns the event loop.
// We do not mount Tambo Cloud: no agent provider, no cloud API key, no thread
// input hook, no public Tambo env vars.

export const lessonComponents: TamboComponent[] = [
  {
    name: "ProfileGate",
    description:
      "Show on boot when the learner has no profile in localStorage. Name field to enter or create a profile.",
    component: ProfileGate,
    propsSchema: ProfileGateSchema,
  },
  {
    name: "InterestSurvey",
    description:
      "Show when a new profile needs an interest survey. Use after profile_entered for new or incomplete profiles.",
    component: InterestSurvey,
    propsSchema: InterestSurveySchema,
  },
  {
    name: "LevelQuiz",
    description:
      "Show after interests are submitted. Polls until the quiz pack exists, then collects answers. Props are the profile slug.",
    component: LevelQuiz,
    propsSchema: LevelQuizSchema,
  },
  {
    name: "RecommendedTopics",
    description:
      "Show when onboarding is complete. Choice cards from the profile; click dispatches recommendation_selected.",
    component: RecommendedTopics,
    propsSchema: RecommendedTopicsSchema,
  },
  {
    name: "PromptComposer",
    description:
      "Show when the learner should type a topic. Use after boot, after onboarding completes, and after taste feedback.",
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
