import type {
  ChatTurn,
  LearnerProfile,
  QuizQuestionPublic,
} from "./onboarding";

export type QuizChoiceId = "a" | "b" | "c" | "d";

export const SUGGESTED_INTERESTS = [
  "the dot-com bubble",
  "compound interest",
  "how the internet works",
  "probability",
  "climate science",
] as const;

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    try {
      const body = JSON.parse(text) as { error?: string };
      throw new Error(body.error || text || `HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function createProfile(
  name: string,
): Promise<{ created: boolean; profile: LearnerProfile }> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readJson(res);
}

export async function getProfile(slug: string): Promise<LearnerProfile | null> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  return readJson<LearnerProfile>(res);
}

export async function postInterests(
  slug: string,
  interests: string[],
  goal?: string,
): Promise<{ status: string; profile: LearnerProfile }> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}/interests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interests, goal }),
  });
  return readJson(res);
}

export async function getQuiz(
  slug: string,
): Promise<
  | { ok: true; questions: QuizQuestionPublic[] }
  | { ok: false; status: number }
> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}/quiz`);
  if (res.ok) {
    const body = (await res.json()) as { questions: QuizQuestionPublic[] };
    return { ok: true, questions: body.questions };
  }
  return { ok: false, status: res.status };
}

export async function postQuiz(
  slug: string,
  answers: Record<string, QuizChoiceId>,
): Promise<{ status: string; profile: LearnerProfile }> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}/quiz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  return readJson(res);
}

export async function getChat(slug: string): Promise<ChatTurn[]> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}/chat`);
  if (res.status === 404) return [];
  const body = await readJson<{ turns: ChatTurn[] }>(res);
  return body.turns ?? [];
}

export async function postChat(
  slug: string,
  message: string,
): Promise<{ turns: ChatTurn[]; profile: LearnerProfile }> {
  const res = await fetch(`/api/profile/${encodeURIComponent(slug)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return readJson(res);
}

export const PROFILE_POLL_INTERVAL_MS = 400;
export const PROFILE_POLL_TIMEOUT_MS = 30_000;
