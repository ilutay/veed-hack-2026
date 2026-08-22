import type { TamboComponent } from "@tambo-ai/react";

import {
  CompareArena,
  CreditAssignmentReplay,
  LayerOrderTransferGym,
  LearningPrompt,
  SafeExerciseFallback,
  TargetedRetryGym,
} from "@/components/gym/gym-components";

import {
  compareArenaPropsSchema,
  creditAssignmentReplayPropsSchema,
  layerOrderTransferGymPropsSchema,
  learningPromptPropsSchema,
  safeExerciseFallbackPropsSchema,
  targetedRetryGymPropsSchema,
} from "./gym-contract";

/**
 * Renderer-only registry. There are deliberately no tools, MCP servers,
 * resources, agent hooks, or callbacks in these registrations.
 */
export const gymTamboComponents: TamboComponent[] = [
  {
    name: "LearningPrompt",
    description: "Collects a free-text human learning goal before the gym begins.",
    component: LearningPrompt,
    propsSchema: learningPromptPropsSchema,
  },
  {
    name: "CompareArena",
    description: "Runs a Pioneer-certified two-variant diagnostic comparison.",
    component: CompareArena,
    propsSchema: compareArenaPropsSchema,
  },
  {
    name: "CreditAssignmentReplay",
    description: "Shows criterion-level feedback anchored to the learner-visible artifact.",
    component: CreditAssignmentReplay,
    propsSchema: creditAssignmentReplayPropsSchema,
  },
  {
    name: "TargetedRetryGym",
    description: "Runs a fresh same-subskill rep chosen from the learner evidence frontier.",
    component: TargetedRetryGym,
    propsSchema: targetedRetryGymPropsSchema,
  },
  {
    name: "LayerOrderTransferGym",
    description: "Tests held-out transfer through a changed context and action mode.",
    component: LayerOrderTransferGym,
    propsSchema: layerOrderTransferGymPropsSchema,
  },
  {
    name: "SafeExerciseFallback",
    description: "Renders a separately prevalidated accessible fallback exercise.",
    component: SafeExerciseFallback,
    propsSchema: safeExerciseFallbackPropsSchema,
  },
];
