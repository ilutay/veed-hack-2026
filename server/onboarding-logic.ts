import type {
  LearnerLevel,
  QuizQuestionPublic,
  QuizScore,
  RecommendedTopic,
} from "../src/lib/onboarding";
import type { QuizChoiceId } from "../src/lib/profiles";

export type QuizQuestionFull = QuizQuestionPublic & {
  correct_id: QuizChoiceId;
  source_id?: string;
  rationale?: string;
};

export type OnboardingPack = {
  slug: string;
  interests: string[];
  goal?: string;
  quiz: { questions: QuizQuestionFull[] };
  recommendations: RecommendedTopic[];
  level?: LearnerLevel;
  quiz_score?: QuizScore;
  sources?: Array<{
    id: string;
    title: string;
    url: string;
    publisher?: string;
    accessed_at?: string;
  }>;
  research: {
    provider: string;
    mode: "dry-run" | "test" | "live";
    credits: number;
    calls: number;
    queries?: Array<{
      pass: "interests" | "level_quiz" | "extract" | "recommend";
      query: string;
      credits?: number;
    }>;
  };
  style_notes?: string[];
};

export type TasteProfile = {
  version: 1;
  updated_at: string;
  axes: { pace: number; depth: number; concreteness: number };
  strategy_weights: Record<string, number>;
  history: unknown[];
  notes?: string[];
};

export type OnboardingJobStatus = {
  status: "pending" | "ready" | "failed";
  stage: "quiz" | "recommend";
  error?: string;
};

export const SUGGESTED_INTERESTS = [
  "the dot-com bubble",
  "compound interest",
  "how the internet works",
  "probability",
  "climate science",
] as const;

const FIXTURE_QUESTIONS: QuizQuestionFull[] = [
  {
    id: "q-01",
    prompt: "When did the NASDAQ Composite peak during the dot-com bubble?",
    choices: [
      { id: "a", text: "10 March 1999" },
      { id: "b", text: "10 March 2000" },
      { id: "c", text: "9 October 2002" },
      { id: "d", text: "November 2001" },
    ],
    correct_id: "b",
    topic: "the dot-com bubble",
    source_id: "src-wikipedia-dotcom",
    rationale: "The NASDAQ Composite peaked at 5,048.62 on 10 March 2000.",
  },
  {
    id: "q-02",
    prompt:
      "Between 1995 and its March 2000 peak, roughly how much did the NASDAQ Composite rise?",
    choices: [
      { id: "a", text: "About 100%" },
      { id: "b", text: "About 250%" },
      { id: "c", text: "About 600%" },
      { id: "d", text: "About 1,200%" },
    ],
    correct_id: "c",
    topic: "the dot-com bubble",
    source_id: "src-wikipedia-dotcom",
    rationale:
      "The commonly misquoted figure is ~400%; the grounded figure is 600%.",
  },
  {
    id: "q-03",
    prompt:
      "If you earn 10% a year, about how long does it take for money to double (rule of 72)?",
    choices: [
      { id: "a", text: "About 5 years" },
      { id: "b", text: "About 7 years" },
      { id: "c", text: "About 10 years" },
      { id: "d", text: "About 12 years" },
    ],
    correct_id: "b",
    topic: "compound interest",
    source_id: "src-fixture-compound",
    rationale: "Rule of 72: 72 / 10 ≈ 7.2 years.",
  },
  {
    id: "q-04",
    prompt: "What is the main misconception the fixture brief warns against?",
    choices: [
      { id: "a", text: "That the internet itself disappeared after 2000" },
      { id: "b", text: "That the NASDAQ never recovered" },
      { id: "c", text: "That only banks lost money" },
      { id: "d", text: "That the bubble peaked in 1995" },
    ],
    correct_id: "a",
    topic: "the dot-com bubble",
    source_id: "src-wikipedia-dotcom",
    rationale: "The speculation died; the technology did not.",
  },
  {
    id: "q-05",
    prompt: "Compound interest grows fastest when which of these is true?",
    choices: [
      { id: "a", text: "Returns are withdrawn every year" },
      { id: "b", text: "The rate is applied to a shrinking principal" },
      {
        id: "c",
        text: "Earnings stay invested so later interest is earned on earlier interest",
      },
      { id: "d", text: "The time horizon is a single day" },
    ],
    correct_id: "c",
    topic: "compound interest",
    source_id: "src-fixture-compound",
    rationale: "Compounding requires leaving earnings in the principal.",
  },
];

export function fixtureOnboardingPack(opts: {
  slug: string;
  interests: string[];
  goal?: string;
}): OnboardingPack {
  const interests = (
    opts.interests.length
      ? opts.interests
      : ["the dot-com bubble", "compound interest"]
  ).slice(0, 5);
  return {
    slug: opts.slug,
    interests,
    ...(opts.goal ? { goal: opts.goal } : {}),
    quiz: { questions: FIXTURE_QUESTIONS },
    recommendations: [],
    sources: [
      {
        id: "src-wikipedia-dotcom",
        title: "Dot-com bubble",
        url: "https://en.wikipedia.org/wiki/Dot-com_bubble",
        publisher: "Wikipedia",
      },
      {
        id: "src-fixture-compound",
        title: "Compound interest (fixture)",
        url: "https://en.wikipedia.org/wiki/Compound_interest",
        publisher: "Wikipedia",
      },
    ],
    research: {
      provider: "fixture",
      mode: "dry-run",
      credits: 0,
      calls: 0,
      queries: [
        {
          pass: "interests",
          query: "the dot-com bubble beginner key facts misconceptions",
          credits: 0,
        },
        {
          pass: "level_quiz",
          query: "compound interest rule of 72 beginner quiz",
          credits: 0,
        },
      ],
    },
    style_notes: [
      "Dry-run fixture pack. Not live-researched. Live mode would query Tavily for the learner's stated interests.",
    ],
  };
}

export function scoreAnswers(
  pack: OnboardingPack,
  answers: Record<string, string>,
): QuizScore {
  const questions = pack.quiz.questions;
  let correct = 0;
  for (const q of questions) {
    if (answers[q.id] === q.correct_id) correct += 1;
  }
  return { correct, total: questions.length };
}

export function levelFromScore(score: QuizScore): LearnerLevel {
  if (score.total <= 0) return "beginner";
  const ratio = score.correct / score.total;
  if (ratio < 0.4) return "beginner";
  if (ratio < 0.75) return "intermediate";
  return "advanced";
}

export function recommendationsFor(
  level: LearnerLevel,
  interests: string[],
): RecommendedTopic[] {
  const fallback = ["the dot-com bubble", "compound interest"];
  const source = interests.length ? interests : fallback;
  const seeds = [source[0], source[1] ?? source[0], source[2] ?? source[0]];

  const frames: Record<
    LearnerLevel,
    Array<{ topic: (s: string) => string; why: (s: string) => string }>
  > = {
    beginner: [
      {
        topic: (s) => `${s}: a first look`,
        why: (s) => `Introductory framing for ${s}, without assuming prior study.`,
      },
      {
        topic: (s) => `What you need before ${s}`,
        why: (s) => `Prerequisite ideas so ${s} is not a wall of jargon.`,
      },
      {
        topic: (s) => `${s} in plain language`,
        why: (s) => `A grounded walkthrough of ${s} at beginner pace.`,
      },
    ],
    intermediate: [
      {
        topic: (s) => `How ${s} actually works`,
        why: (s) => `The mechanism behind ${s}, not just the headline.`,
      },
      {
        topic: (s) => `${s}: cause and effect`,
        why: (s) => `What moves ${s} and what that implies.`,
      },
      {
        topic: (s) => `The moving parts of ${s}`,
        why: (s) => `An intermediate pass over how ${s} hangs together.`,
      },
    ],
    advanced: [
      {
        topic: (s) => `Applying ${s} to a real case`,
        why: (s) => `Use ${s} on a concrete decision, not a recap.`,
      },
      {
        topic: (s) => `${s} in practice`,
        why: (s) => `An applied look at ${s} for someone who already has the mechanism.`,
      },
      {
        topic: (s) => `Using ${s} to make a call`,
        why: (s) => `Stretch ${s} into a judgment, with the usual caveats.`,
      },
    ],
  };

  return frames[level].map((frame, i) => ({
    topic: frame.topic(seeds[i] ?? seeds[0]),
    why: frame.why(seeds[i] ?? seeds[0]),
    level,
  }));
}

export function publicQuestions(pack: OnboardingPack): QuizQuestionPublic[] {
  return pack.quiz.questions.map(({ id, prompt, choices, topic }) => ({
    id,
    prompt,
    choices,
    topic,
  }));
}

export function publicPack(pack: OnboardingPack): Omit<OnboardingPack, "quiz"> & {
  quiz: { questions: QuizQuestionPublic[] };
} {
  return {
    ...pack,
    quiz: { questions: publicQuestions(pack) },
  };
}

export function clampAxis(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

export function applyChatNudge(
  axes: TasteProfile["axes"],
  message: string,
): { axes: TasteProfile["axes"]; reply: string } {
  const m = message.toLowerCase();
  let pace = axes.pace;
  let depth = axes.depth;
  let concreteness = axes.concreteness;
  const parts: string[] = [];

  if (["faster", "too slow", "speed up"].some((p) => m.includes(p))) {
    pace += 0.2;
    parts.push("pick up the pace");
  }
  if (["slower", "too fast", "slow down"].some((p) => m.includes(p))) {
    pace -= 0.2;
    parts.push("slow down");
  }
  if (["simpler", "plain", "too technical", "eli5"].some((p) => m.includes(p))) {
    depth -= 0.2;
    parts.push("keep the language simpler");
  } else if (
    ["technical", "more depth", "advanced"].some((p) => m.includes(p))
  ) {
    depth += 0.2;
    parts.push("go more technical");
  }
  if (["examples", "concrete", "practical"].some((p) => m.includes(p))) {
    concreteness += 0.2;
    parts.push("lean on examples");
  }
  if (["theory", "abstract", "principles"].some((p) => m.includes(p))) {
    concreteness -= 0.2;
    parts.push("start from the principles");
  }

  const reply =
    parts.length === 0
      ? "Noted. I'll keep that in mind."
      : parts.length === 1
        ? `I'll ${parts[0]} on the next lesson.`
        : `I'll ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;

  return {
    axes: {
      pace: clampAxis(pace),
      depth: clampAxis(depth),
      concreteness: clampAxis(concreteness),
    },
    reply,
  };
}

