/**
 * Learner profile contract, mirrored from codex/contracts/learner-profile.schema.json
 * and served by the bridge's /api/profile routes. Shapes are kept identical to
 * the bridge's so nothing needs translating in the browser.
 */

export type OnboardingStatus = "new" | "interests" | "researching" | "quiz" | "scoring" | "complete";

export type LearnerLevel = "beginner" | "intermediate" | "advanced";

export type QuizScore = { correct: number; total: number };

export type RecommendedTopic = {
  topic: string;
  why: string;
  level: LearnerLevel;
  source_id?: string;
};

/** Receipt for the research stage in flight (or last run). */
export type ResearchReceipt = {
  status: "pending" | "ready" | "failed";
  stage: "quiz" | "recommend";
  error?: string;
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
  research?: ResearchReceipt;
};

export type TasteAxes = { pace: number; depth: number; concreteness: number };

export type TasteProfile = {
  version: 1;
  updated_at: string;
  axes: TasteAxes;
  notes?: string[];
  history?: Array<{ at: string; reaction: string; jobId?: string }>;
};

export type QuizChoiceId = "a" | "b" | "c" | "d";

export type QuizChoice = { id: QuizChoiceId; text: string };

export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: QuizChoice[];
  topic: string;
};

export type ChatTurn = { role: "learner" | "agent"; text: string; at: string };

/** One rendered (or rendering) lesson in the library. */
export type LibraryEntry = {
  jobId: string;
  topic: string;
  title?: string;
  status: "pending" | "completed" | "failed";
  videoUrl?: string;
  createdAt: string;
};
