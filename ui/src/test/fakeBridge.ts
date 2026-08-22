import { vi } from "vitest";

/**
 * An in-memory stand-in for server/bridge.mjs, good enough to drive the app
 * end to end in jsdom: profiles with the same state machine, a lesson job
 * store, and a tutor turn that answers the way Codex is prompted to.
 *
 * Research is instantaneous by default; `settleResearch: false` leaves the
 * profile in researching/scoring until `finishResearch()` is called, so tests
 * can assert on the waiting states.
 */

type Profile = {
  version: 1;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  onboarding: Record<string, unknown> & { status: string };
  research?: { status: string; stage: string; error?: string };
};

export const QUIZ = [
  {
    id: "q-01",
    prompt: "A fair coin lands heads three times in a row. The chance the next flip is heads is:",
    choices: [
      { id: "a", text: "Less" },
      { id: "b", text: "Exactly 50%" },
      { id: "c", text: "More" },
      { id: "d", text: "Unknown" },
    ],
    topic: "probability",
  },
  {
    id: "q-02",
    prompt: "Two independent events each have probability 0.5. The chance both happen is:",
    choices: [
      { id: "a", text: "1.0" },
      { id: "b", text: "0.5" },
      { id: "c", text: "0.25" },
      { id: "d", text: "0" },
    ],
    topic: "probability",
  },
];
const KEY: Record<string, string> = { "q-01": "b", "q-02": "c" };

export interface FakeBridgeOptions {
  settleResearch?: boolean;
  /** Job status reported by GET /api/lesson/:id. */
  job?: (jobId: string) => Record<string, unknown>;
  /** Tutor turn: what Codex answers for a given state string. */
  turn?: (state: string, slug?: string) => { componentName: string; props: Record<string, unknown> } | null;
  failResearch?: boolean;
}

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Default tutor: a named topic starts a lesson; "test" asks for the quiz; else a note. */
export function defaultTurn(state: string): { componentName: string; props: Record<string, unknown> } {
  if (state.startsWith("Gym turn")) {
    return {
      componentName: "ProbeArena",
      props: {
        probeId: "probe-1",
        skill: "attention-routing",
        prompt: "Which layer attends first?",
        choices: [
          { id: "a", label: "Embedding" },
          { id: "b", label: "Self-attention" },
        ],
      },
    };
  }
  const match = state.match(/The learner wrote in the chat: "(.*)"\. Choose/);
  const text = match ? JSON.parse(`"${match[1]}"`) : "";
  if (/\btest\b|quiz|level check/i.test(text)) return { componentName: "LevelQuiz", props: { slug: "" } };
  if (/^give me a lesson$/i.test(text)) return { componentName: "PromptComposer", props: {} };
  if (/^(teach me|explain) /i.test(text)) {
    return { componentName: "StartLesson", props: { topic: text.replace(/^(teach me|explain)\s+(about\s+)?/i, "") } };
  }
  if (text) return { componentName: "StartLesson", props: { topic: text } };
  return { componentName: "AgentNote", props: { text: "Tell me what you would like to learn." } };
}

export function installFakeBridge(options: FakeBridgeOptions = {}) {
  const profiles = new Map<string, Profile>();
  const chats = new Map<string, Array<{ role: string; text: string; at: string }>>();
  const tastes = new Map<string, { axes: Record<string, number>; history: unknown[]; notes: string[] }>();
  const jobs = new Map<string, { topic: string; slug?: string }>();
  const pending: Array<() => void> = [];
  let minted = 0;
  let commands = 0;
  const now = () => new Date().toISOString();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const settle = (slug: string, stage: "quiz" | "recommend") => {
    const p = profiles.get(slug)!;
    if (options.failResearch) {
      p.onboarding.status = stage === "quiz" ? "researching" : "scoring";
      p.research = { status: "failed", stage, error: "TAVILY_API_KEY is required outside dry-run mode" };
      return;
    }
    if (stage === "quiz") {
      p.onboarding.status = "quiz";
    } else {
      const score = p.onboarding.quiz_score as { correct: number; total: number };
      const level = score.correct / score.total >= 0.75 ? "advanced" : score.correct / score.total >= 0.4 ? "intermediate" : "beginner";
      p.onboarding.status = "complete";
      p.onboarding.level = level;
      p.onboarding.recommended_topics = [
        { topic: `Applying ${(p.onboarding.interests as string[])[0]} to a real case`, why: "Use it.", level },
        { topic: "Bayes' rule in plain language", why: "Widen it.", level },
        { topic: "Expected value in decisions", why: "Apply it.", level },
      ];
    }
    p.research = { status: "ready", stage };
  };
  const research = (slug: string, stage: "quiz" | "recommend") => {
    const p = profiles.get(slug)!;
    p.research = { status: "pending", stage };
    if (options.settleResearch === false) pending.push(() => settle(slug, stage));
    else settle(slug, stage);
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url === "/api/profile" && method === "POST") {
      const name = String(body.name ?? "").trim();
      const slug = slugify(name);
      if (!slug) return json(400, { error: "name required" });
      const existing = profiles.get(slug);
      if (existing) return json(200, { created: false, profile: existing });
      const profile: Profile = { version: 1, name, slug, created_at: now(), updated_at: now(), onboarding: { status: "interests" } };
      profiles.set(slug, profile);
      chats.set(slug, []);
      tastes.set(slug, { axes: { pace: 0, depth: 0, concreteness: 0 }, history: [], notes: [] });
      return json(200, { created: true, profile });
    }
    const m = url.match(/^\/api\/profile\/([^/]+)(?:\/(interests|quiz|chat|taste|retry))?$/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      const p = profiles.get(slug);
      if (!p) return json(404, { error: "unknown profile" });
      const sub = m[2];
      if (!sub) return json(200, p);
      if (sub === "interests") {
        p.onboarding = { status: "researching", interests: body.interests, ...(body.goal ? { goal: body.goal } : {}) };
        research(slug, "quiz");
        return json(200, { status: "submitted", profile: p });
      }
      if (sub === "quiz" && method === "GET") {
        if (p.onboarding.status === "researching") {
          return p.research?.status === "failed" ? json(503, { error: p.research.error, status: "failed" }) : json(202, { status: "researching" });
        }
        if (p.onboarding.status === "interests") return json(409, { error: "quiz not available" });
        return json(200, { questions: QUIZ });
      }
      if (sub === "quiz" && method === "POST") {
        const answers = body.answers as Record<string, string>;
        const correct = Object.entries(KEY).filter(([id, a]) => answers[id] === a).length;
        p.onboarding.status = "scoring";
        p.onboarding.quiz_score = { correct, total: QUIZ.length };
        research(slug, "recommend");
        return json(200, { status: "submitted", profile: p });
      }
      if (sub === "retry") {
        options.failResearch = false;
        research(slug, p.research?.stage === "recommend" ? "recommend" : "quiz");
        return json(200, { status: "submitted", profile: p });
      }
      if (sub === "chat" && method === "GET") return json(200, { turns: chats.get(slug) });
      if (sub === "chat" && method === "POST") {
        const text = String(body.message);
        const t = tastes.get(slug)!;
        let reply = "Noted. I'll keep that in mind for the next lesson.";
        if (/slow/i.test(text)) {
          t.axes.pace -= 0.2;
          reply = "I'll slow down on the next lesson.";
        }
        t.notes.unshift(text);
        const turns = chats.get(slug)!;
        turns.push({ role: "learner", text, at: now() }, { role: "agent", text: reply, at: now() });
        return json(200, { turns, reply, profile: p });
      }
      if (sub === "taste" && method === "POST") {
        const t = tastes.get(slug)!;
        t.history.unshift({ reaction: body.reaction, jobId: body.jobId, at: now() });
        return json(200, { status: "recorded", taste: t });
      }
      return json(405, { error: "method not allowed" });
    }

    if (url === "/api/lesson" && method === "POST") {
      minted += 1;
      const jobId = `job-${minted}`;
      jobs.set(jobId, { topic: String(body.topic), slug: body.slug as string | undefined });
      return json(202, { jobId, status: "queued", stage: "queued", topic: body.topic });
    }
    const jobMatch = url.match(/^\/api\/lesson\/(.+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      if (!jobs.has(jobId)) return json(404, { error: "unknown job" });
      return json(200, options.job?.(jobId) ?? { jobId, status: "running", stage: "media" });
    }

    if (url === "/api/turn" && method === "POST") {
      const command = (options.turn ?? defaultTurn)(String(body.state), body.slug as string | undefined);
      if (!command) return json(502, { error: "codex exec exited 1" });
      const slug = body.slug as string | undefined;
      const props = { ...command.props };
      if ("slug" in props && slug) props.slug = slug;
      return json(200, { componentId: `cmp-${commands += 1}`, componentName: command.componentName, props, episodeId: body.episodeId, turnId: body.turnId });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    profiles,
    tastes,
    jobs,
    finishResearch() {
      for (const fn of pending.splice(0)) fn();
    },
    lessonBodies: () =>
      fetchMock.mock.calls
        .filter((c) => String(c[0]) === "/api/lesson" && (c[1] as RequestInit | undefined)?.method === "POST")
        .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { topic: string; slug?: string }),
    turnBodies: () =>
      fetchMock.mock.calls
        .filter((c) => String(c[0]) === "/api/turn")
        .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { state: string; slug?: string; turnId: string }),
  };
}
