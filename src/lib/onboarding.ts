/** Frozen onboarding contract. Mirror of
 *  codex/contracts/learner-profile.schema.json and
 *  codex/contracts/onboarding-pack.schema.json (tavily worktree).
 *  Do not drift these shapes. */

export type OnboardingStatus =
  | "new"
  | "interests"
  | "researching"
  | "quiz"
  | "scoring"
  | "complete";

export type LearnerLevel = "beginner" | "intermediate" | "advanced";

export type QuizScore = {
  correct: number;
  total: number;
};

export type RecommendedTopic = {
  topic: string;
  why: string;
  level: LearnerLevel;
  source_id?: string;
};

export type LearnerProfile = {
  version: 1;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  onboarding: {
    status: OnboardingStatus;
    interests?: string[];
    goal?: string;
    level?: LearnerLevel;
    quiz_score?: QuizScore;
    recommended_topics?: RecommendedTopic[];
  };
};

export type QuizChoice = {
  id: "a" | "b" | "c" | "d";
  text: string;
};

export type QuizQuestionPublic = {
  id: string;
  prompt: string;
  choices: QuizChoice[];
  topic: string;
};

export type ChatTurn = {
  role: "learner" | "agent";
  text: string;
  at: string;
};

export const PROFILE_STORAGE_KEY = "taste-labs-profile-slug";

export function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}
