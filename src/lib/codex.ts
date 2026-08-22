import type { TamboComponentContent } from "@tambo-ai/react";
import type { LearnerProfile } from "./onboarding";
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
  | { type: "playback_ended"; payload: { run_id: string } }
  | {
      type: "profile_entered";
      payload: { name: string; slug: string; created: boolean };
    }
  | {
      type: "interests_submitted";
      payload: { slug: string; interests: string[]; goal?: string };
    }
  | {
      type: "quiz_submitted";
      payload: { slug: string; answers: Record<string, string> };
    }
  | { type: "recommendation_selected"; payload: { topic: string } };

export type CodexActionResponse = {
  status: "submitted";
  episodeId: string;
  turnId: string;
  run_id?: string;
  blocks: TamboComponentContent[];
  profile?: LearnerProfile;
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

export function completeOnboardingBlocks(
  profile: LearnerProfile,
  idPrefix = "boot",
): TamboComponentContent[] {
  const slug = profile.slug;
  const seed = profile.onboarding.recommended_topics?.[0]?.topic;
  return [
    componentBlock("RecommendedTopics", { slug }, `${idPrefix}-recs`),
    componentBlock(
      "PromptComposer",
      seed ? { seed_topic: seed } : {},
      `${idPrefix}-composer`,
    ),
  ];
}

/** Next Tambo blocks from onboarding status. Chat is not a block. */
export function blocksForProfile(
  profile: LearnerProfile,
  idPrefix = "boot",
): TamboComponentContent[] {
  const slug = profile.slug;
  switch (profile.onboarding.status) {
    case "new":
    case "interests":
      return [componentBlock("InterestSurvey", { slug }, `${idPrefix}-interests`)];
    case "researching":
    case "quiz":
    case "scoring":
      return [componentBlock("LevelQuiz", { slug }, `${idPrefix}-quiz`)];
    case "complete":
      return completeOnboardingBlocks(profile, idPrefix);
  }
}
