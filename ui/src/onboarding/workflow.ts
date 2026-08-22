import type { CodexGymEvent } from "../codex/CodexActionProvider";
import type { LearnerProfile } from "./types";

/**
 * The deterministic learner workflow.
 *
 *   ProfileGate → InterestSurvey → LevelQuiz → RecommendedTopics
 *     → lesson render (LessonVideo) → NextChoices + TasteFeedback → next lesson …
 *
 * Given where the learner is and what they just did, this decides what the
 * thread shows next. It is a pure function: no fetches, no React, no ids —
 * the host mints ids and does the rendering. These are the steps that follow
 * deterministically from a click; free-text chat messages go to Codex
 * instead (the tutor turn), which picks from the same registry.
 */

export interface PlannedBlock {
  componentName: string;
  props: Record<string, unknown>;
}

export interface PlannedMessage {
  role: "user" | "assistant";
  text?: string;
  block?: PlannedBlock;
}

export interface Plan {
  messages: PlannedMessage[];
  /** Start a lesson render on this topic after appending the messages. */
  startLesson?: string;
  /** Feed this learner state to Codex via /api/turn. */
  gymState?: string;
}

const none: Plan = { messages: [] };

/** What to show when the app opens, from whatever profile is on disk. */
export function bootPlan(profile: LearnerProfile | null): Plan {
  if (!profile) {
    return {
      messages: [
        {
          role: "assistant",
          text: "Welcome to the lesson studio. Tell me your name to get started.",
          block: { componentName: "ProfileGate", props: {} },
        },
      ],
    };
  }
  return { messages: [stepFor(profile, `Welcome back, ${profile.name}.`)] };
}

/** The next onboarding surface for a profile's status. */
function stepFor(profile: LearnerProfile, lead: string): PlannedMessage {
  const slug = profile.slug;
  switch (profile.onboarding.status) {
    case "new":
    case "interests":
      return {
        role: "assistant",
        text: `${lead} Let's find out what you are into.`,
        block: { componentName: "InterestSurvey", props: { slug } },
      };
    case "researching":
    case "quiz":
      return {
        role: "assistant",
        text: `${lead} A quick level check so the lessons land at the right height.`,
        block: { componentName: "LevelQuiz", props: { slug } },
      };
    case "scoring":
    case "complete":
      return {
        role: "assistant",
        text: `${lead} Here is where to start.`,
        block: { componentName: "RecommendedTopics", props: { slug } },
      };
  }
}

/** Decide what a learner event leads to. Returns an empty plan for events the host handles itself. */
export function planFor(event: CodexGymEvent, profile: LearnerProfile | null): Plan {
  const p = event.payload;
  switch (event.action) {
    case "profile.entered": {
      if (!profile) return none;
      const created = p.created === true;
      return {
        messages: [
          { role: "user", text: String(p.name ?? profile.name) },
          stepFor(profile, created ? `Nice to meet you, ${profile.name}.` : `Welcome back, ${profile.name}.`),
        ],
      };
    }
    case "interests.submitted": {
      if (!profile) return none;
      const interests = Array.isArray(p.interests) ? p.interests.map(String) : [];
      return {
        messages: [
          { role: "user", text: interests.length ? `I'm into ${interests.join(", ")}.` : "Submitted my interests." },
          stepFor(profile, "Got it."),
        ],
      };
    }
    case "quiz.submitted": {
      if (!profile) return none;
      const score = p.score as { correct: number; total: number } | null;
      return {
        messages: [
          { role: "user", text: "Submitted my answers." },
          stepFor(profile, score ? `${score.correct} of ${score.total} — you placed ${String(p.level)}.` : "Scored."),
        ],
      };
    }
    case "recommendation.selected":
    case "topic.submitted": {
      const topic = String(p.topic ?? "").trim();
      if (!topic) return none;
      return { messages: [{ role: "user", text: topic }], startLesson: topic };
    }
    case "choice.selected": {
      const topic = String(p.topic ?? "").trim();
      if (!topic) return none;
      return {
        messages: [{ role: "user", text: `Option ${String(p.label)}: ${topic}` }],
        startLesson: topic,
      };
    }
    case "taste.reaction":
      return {
        messages: [
          {
            role: "assistant",
            text: `Noted — "${String(p.reaction).replace(/-/g, " ")}". The next lesson will take that into account.`,
          },
        ],
      };
    default:
      return none;
  }
}

/** What follows a lesson that finished rendering. */
export function afterLessonPlan(jobId: string, topic: string): Plan {
  return {
    messages: [
      {
        role: "assistant",
        text: "The lesson video is ready. When you have watched it, pick where to go next.",
        block: { componentName: "NextChoices", props: { jobId, topic } },
      },
      { role: "assistant", block: { componentName: "TasteFeedback", props: { jobId } } },
    ],
  };
}
