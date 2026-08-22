"use client";

import {
  TamboRegistryProvider,
  type TamboComponent,
} from "@tambo-ai/react";
import type { ReactNode } from "react";

import { LessonPlayer } from "@/components/taste-labs/lesson-player";
import { NextChoices } from "@/components/taste-labs/next-choices";
import { PromptComposer } from "@/components/taste-labs/prompt-composer";
import { TasteFeedback } from "@/components/taste-labs/taste-feedback";

import {
  LessonPlayerSchema,
  NextChoicesSchema,
  PromptComposerSchema,
  TasteFeedbackSchema,
} from "./contracts";

export const tasteLabsComponents: TamboComponent[] = [
  {
    name: "PromptComposer",
    description: "Browser-local topic prompt for the isolated fixture gallery.",
    component: PromptComposer,
    propsSchema: PromptComposerSchema,
  },
  {
    name: "LessonPlayer",
    description: "Read-only player for the exact fixture-dotcom artifact set.",
    component: LessonPlayer,
    propsSchema: LessonPlayerSchema,
  },
  {
    name: "NextChoices",
    description: "The A/B/C choices stored in fixture-dotcom's lesson script.",
    component: NextChoices,
    propsSchema: NextChoicesSchema,
  },
  {
    name: "TasteFeedback",
    description: "Ephemeral local feedback controls with no persistence.",
    component: TasteFeedback,
    propsSchema: TasteFeedbackSchema,
  },
];

/** Tambo is a registered-component renderer here, never an execution agent. */
export function TasteLabsRendererRegistry({ children }: { children: ReactNode }) {
  return (
    <TamboRegistryProvider
      components={tasteLabsComponents}
      mcpServers={[]}
      tools={[]}
    >
      {children}
    </TamboRegistryProvider>
  );
}
