import type { ChatTurn, LearnerProfile, QuizChoiceId, QuizQuestion, TasteProfile } from "./types";

/**
 * The bridge's learner-profile API. Every call is a plain fetch against the
 * same origin Vite proxies to the bridge; nothing here involves Tambo.
 */

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = text || `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not json */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const base = (slug: string) => `/api/profile/${encodeURIComponent(slug)}`;

export function createProfile(name: string): Promise<{ created: boolean; profile: LearnerProfile }> {
  return post("/api/profile", { name }).then((res) => readJson(res));
}

export async function getProfile(slug: string): Promise<LearnerProfile | null> {
  const res = await fetch(base(slug));
  if (res.status === 404) return null;
  return readJson<LearnerProfile>(res);
}

export function postInterests(slug: string, interests: string[], goal?: string) {
  return post(`${base(slug)}/interests`, { interests, goal }).then((res) =>
    readJson<{ status: string; profile: LearnerProfile }>(res),
  );
}

export type QuizPoll =
  | { kind: "ok"; questions: QuizQuestion[] }
  | { kind: "researching" }
  | { kind: "failed"; error: string }
  | { kind: "missing" };

export async function getQuiz(slug: string): Promise<QuizPoll> {
  const res = await fetch(`${base(slug)}/quiz`);
  if (res.status === 202) return { kind: "researching" };
  if (res.status === 404) return { kind: "missing" };
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { kind: "failed", error: body?.error ?? "research failed" };
  }
  const body = await readJson<{ questions: QuizQuestion[] }>(res);
  return { kind: "ok", questions: body.questions };
}

export function postQuiz(slug: string, answers: Record<string, QuizChoiceId>) {
  return post(`${base(slug)}/quiz`, { answers }).then((res) =>
    readJson<{ status: string; profile: LearnerProfile }>(res),
  );
}

export function postRetry(slug: string) {
  return post(`${base(slug)}/retry`, {}).then((res) => readJson<{ status: string; profile: LearnerProfile }>(res));
}

export async function getChat(slug: string): Promise<ChatTurn[]> {
  const res = await fetch(`${base(slug)}/chat`);
  if (res.status === 404) return [];
  return (await readJson<{ turns: ChatTurn[] }>(res)).turns ?? [];
}

export function postChat(slug: string, message: string) {
  return post(`${base(slug)}/chat`, { message }).then((res) =>
    readJson<{ turns: ChatTurn[]; reply: string; profile: LearnerProfile }>(res),
  );
}

export function postReaction(slug: string, reaction: string, jobId?: string) {
  return post(`${base(slug)}/taste`, { reaction, jobId }).then((res) =>
    readJson<{ status: string; taste: TasteProfile }>(res),
  );
}

export const PROFILE_POLL_MS = 1_500;
export const PROFILE_POLL_TIMEOUT_MS = 6 * 60_000;
