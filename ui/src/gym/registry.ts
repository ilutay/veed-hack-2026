import type { TamboComponent } from "@tambo-ai/react";
import { ProbeArena } from "./components/ProbeArena";
import { CreditAssignmentReplay } from "./components/CreditAssignmentReplay";
import { TargetedRetryGym } from "./components/TargetedRetryGym";
import { LayerOrderTransferGym } from "./components/LayerOrderTransferGym";
import { LessonVideo } from "./components/LessonVideo";
import {
  ProbeArenaSchema,
  CreditAssignmentReplaySchema,
  TargetedRetryGymSchema,
  LayerOrderTransferGymSchema,
  LessonVideoSchema,
} from "./schemas";
import { ProfileGate } from "../onboarding/components/ProfileGate";
import { InterestSurvey } from "../onboarding/components/InterestSurvey";
import { LevelQuiz } from "../onboarding/components/LevelQuiz";
import { RecommendedTopics } from "../onboarding/components/RecommendedTopics";
import { PromptComposer } from "../onboarding/components/PromptComposer";
import { NextChoices } from "../onboarding/components/NextChoices";
import { TasteFeedback } from "../onboarding/components/TasteFeedback";
import { StartLesson } from "../onboarding/components/StartLesson";
import { AgentNote } from "../onboarding/components/AgentNote";
import {
  ProfileGateSchema,
  InterestSurveySchema,
  LevelQuizSchema,
  RecommendedTopicsSchema,
  PromptComposerSchema,
  NextChoicesSchema,
  TasteFeedbackSchema,
  StartLessonSchema,
  AgentNoteSchema,
} from "../onboarding/schemas";

/**
 * Every component Codex may name in a component block.
 *
 * A name absent from this list renders the fallback, so this array is the
 * whole allowlist. Descriptions say when to use a surface, not just what it is.
 */
export const gymComponents: TamboComponent[] = [
  {
    name: "ProbeArena",
    description: "A Pioneer-certified diagnostic exercise",
    component: ProbeArena,
    propsSchema: ProbeArenaSchema,
  },
  {
    name: "CreditAssignmentReplay",
    description: "Visual feedback grounded in response evidence",
    component: CreditAssignmentReplay,
    propsSchema: CreditAssignmentReplaySchema,
  },
  {
    name: "TargetedRetryGym",
    description: "A scaffolded retry aimed at one failed skill",
    component: TargetedRetryGym,
    propsSchema: TargetedRetryGymSchema,
  },
  {
    name: "LayerOrderTransferGym",
    description: "Tests whether a learned ordering transfers to a new surface",
    component: LayerOrderTransferGym,
    propsSchema: LayerOrderTransferGymSchema,
  },
  {
    name: "LessonVideo",
    description:
      "Plays a lesson video once the bridge finishes rendering it; show it after a lesson render is started, naming only the job id",
    component: LessonVideo,
    propsSchema: LessonVideoSchema,
  },
];

/**
 * Onboarding and lesson-loop surfaces.
 *
 * The tutor turn (Codex, via /api/turn) chooses among these for every chat
 * message, so they are in the emitted output schema too. Descriptions tell the
 * model when a surface applies; the bridge's system prompt carries the rules.
 */
export const onboardingComponents: TamboComponent[] = [
  {
    name: "ProfileGate",
    description: "Show on boot when no learner profile is active; asks for a name",
    component: ProfileGate,
    propsSchema: ProfileGateSchema,
  },
  {
    name: "InterestSurvey",
    description: "Show when a new profile needs its interest survey",
    component: InterestSurvey,
    propsSchema: InterestSurveySchema,
  },
  {
    name: "LevelQuiz",
    description: "Show after interests are submitted; a placement quiz",
    component: LevelQuiz,
    propsSchema: LevelQuizSchema,
  },
  {
    name: "RecommendedTopics",
    description: "Show when onboarding is complete; topic cards at the learner's level",
    component: RecommendedTopics,
    propsSchema: RecommendedTopicsSchema,
  },
  {
    name: "PromptComposer",
    description: "Topic input, for when the learner should type what to learn next",
    component: PromptComposer,
    propsSchema: PromptComposerSchema,
  },
  {
    name: "NextChoices",
    description: "A/B/C follow-up directions after a lesson has played",
    component: NextChoices,
    propsSchema: NextChoicesSchema,
  },
  {
    name: "TasteFeedback",
    description: "Reaction chips for a finished lesson; nudges the taste profile",
    component: TasteFeedback,
    propsSchema: TasteFeedbackSchema,
  },
  {
    name: "StartLesson",
    description: "Start a lesson render on a topic the learner named; never without a topic",
    component: StartLesson,
    propsSchema: StartLessonSchema,
  },
  {
    name: "AgentNote",
    description: "A short plain reply when no interactive surface is needed",
    component: AgentNote,
    propsSchema: AgentNoteSchema,
  },
];

/** Everything the renderer may resolve. */
export const registeredComponents: TamboComponent[] = [...gymComponents, ...onboardingComponents];
