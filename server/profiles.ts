import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatTurn, LearnerProfile } from "../src/lib/onboarding";
import { slugFromName } from "../src/lib/onboarding";
import { repoRoot } from "../src/lib/pipeline";
import type { QuizChoiceId } from "../src/lib/profiles";
import {
  applyChatNudge,
  fixtureOnboardingPack,
  levelFromScore,
  publicPack,
  publicQuestions,
  recommendationsFor,
  scoreAnswers,
  type OnboardingJobStatus,
  type OnboardingPack,
  type TasteProfile,
} from "./onboarding-logic";

export function isProfileSlug(raw: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw);
}

export function parseProfileSlug(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const slug = slugFromName(decoded);
  if (!slug || slug !== decoded) return null;
  if (!isProfileSlug(slug)) return null;
  return slug;
}

function profilesRoot(): string {
  return path.join(repoRoot(), "artifacts/profiles");
}

export function profileDir(slug: string): string {
  return path.join(profilesRoot(), slug);
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(file: string, body: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2) + "\n", "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function zeroTaste(updated_at: string): TasteProfile {
  return {
    version: 1,
    updated_at,
    axes: { pace: 0, depth: 0, concreteness: 0 },
    strategy_weights: {},
    history: [],
  };
}

export async function readLearnerProfile(
  slug: string,
): Promise<LearnerProfile | null> {
  if (!isProfileSlug(slug)) return null;
  const profile = await readJsonFile<LearnerProfile>(
    path.join(profileDir(slug), "learner-profile.json"),
  );
  if (!profile) return null;
  return hydrateProfile(profile);
}

export async function writeLearnerProfile(
  profile: LearnerProfile,
): Promise<LearnerProfile> {
  const next: LearnerProfile = { ...profile, updated_at: nowIso() };
  await writeJsonFile(
    path.join(profileDir(profile.slug), "learner-profile.json"),
    next,
  );
  return next;
}

async function readPack(slug: string): Promise<OnboardingPack | null> {
  return readJsonFile<OnboardingPack>(
    path.join(profileDir(slug), "onboarding-pack.json"),
  );
}

async function writePack(slug: string, pack: OnboardingPack): Promise<void> {
  await writeJsonFile(path.join(profileDir(slug), "onboarding-pack.json"), pack);
}

async function readJobStatus(slug: string): Promise<OnboardingJobStatus | null> {
  return readJsonFile<OnboardingJobStatus>(
    path.join(profileDir(slug), "onboarding/status.json"),
  );
}

async function writeJobStatus(
  slug: string,
  status: OnboardingJobStatus,
): Promise<void> {
  await writeJsonFile(
    path.join(profileDir(slug), "onboarding/status.json"),
    status,
  );
}

async function readTaste(slug: string): Promise<TasteProfile> {
  const existing = await readJsonFile<TasteProfile>(
    path.join(profileDir(slug), "taste-profile.json"),
  );
  if (existing?.axes) return existing;
  return zeroTaste(nowIso());
}

async function writeTaste(slug: string, taste: TasteProfile): Promise<void> {
  await writeJsonFile(path.join(profileDir(slug), "taste-profile.json"), taste);
}

async function readChat(slug: string): Promise<ChatTurn[]> {
  const body = await readJsonFile<{ turns?: ChatTurn[] }>(
    path.join(profileDir(slug), "chat.json"),
  );
  return body?.turns ?? [];
}

async function writeChat(slug: string, turns: ChatTurn[]): Promise<void> {
  await writeJsonFile(path.join(profileDir(slug), "chat.json"), { turns });
}

/** If the Python tool wrote a pack but not the profile, fold it in on read. */
async function hydrateProfile(profile: LearnerProfile): Promise<LearnerProfile> {
  const slug = profile.slug;
  const job = await readJobStatus(slug);
  const pack = await readPack(slug);
  let next = profile;

  if (
    profile.onboarding.status === "researching" ||
    profile.onboarding.status === "interests"
  ) {
    if (job?.status === "failed") {
      return next;
    }
    const ready =
      job?.status === "ready" || (pack?.quiz.questions.length ?? 0) >= 3;
    if (ready && pack) {
      next = await writeLearnerProfile({
        ...profile,
        onboarding: {
          ...profile.onboarding,
          status: "quiz",
          interests:
            profile.onboarding.interests?.length
              ? profile.onboarding.interests
              : pack.interests,
        },
      });
    }
  }

  if (next.onboarding.status === "scoring" && pack) {
    const ready =
      job?.status === "ready" ||
      (pack.recommendations?.length ?? 0) > 0 ||
      Boolean(pack.level);
    if (ready) {
      next = await writeLearnerProfile({
        ...next,
        onboarding: {
          ...next.onboarding,
          status: "complete",
          level: pack.level ?? next.onboarding.level,
          quiz_score: pack.quiz_score ?? next.onboarding.quiz_score,
          recommended_topics:
            pack.recommendations?.length
              ? pack.recommendations
              : next.onboarding.recommended_topics,
        },
      });
    }
  }

  return next;
}

export async function enterProfile(
  name: string,
): Promise<{ created: boolean; profile: LearnerProfile }> {
  const trimmed = name.trim();
  const slug = slugFromName(trimmed);
  if (!trimmed || !slug) {
    throw new Error("name required");
  }
  const existing = await readLearnerProfile(slug);
  if (existing) return { created: false, profile: existing };

  const ts = nowIso();
  const profile: LearnerProfile = {
    version: 1,
    name: trimmed,
    slug,
    created_at: ts,
    updated_at: ts,
    onboarding: { status: "interests" },
  };
  await mkdir(profileDir(slug), { recursive: true });
  await writeJsonFile(
    path.join(profileDir(slug), "learner-profile.json"),
    profile,
  );
  await writeTaste(slug, zeroTaste(ts));
  await writeChat(slug, []);
  return { created: true, profile };
}

function workflowMode(): string {
  return process.env.WORKFLOW_MODE || "dry-run";
}

async function runInlineFallback(
  stage: "quiz" | "recommend",
  slug: string,
  opts: {
    interests?: string[];
    goal?: string;
    answers?: Record<string, string>;
  },
): Promise<LearnerProfile | null> {
  const profile = await readLearnerProfile(slug);
  if (!profile) return null;

  if (stage === "quiz") {
    const interests =
      opts.interests ?? profile.onboarding.interests ?? [];
    const pack = fixtureOnboardingPack({
      slug,
      interests,
      goal: opts.goal ?? profile.onboarding.goal,
    });
    await writePack(slug, pack);
    await writeJobStatus(slug, { status: "ready", stage: "quiz" });
    return writeLearnerProfile({
      ...profile,
      onboarding: {
        ...profile.onboarding,
        status: "quiz",
        interests,
        ...(opts.goal || profile.onboarding.goal
          ? { goal: opts.goal ?? profile.onboarding.goal }
          : {}),
      },
    });
  }

  const pack =
    (await readPack(slug)) ??
    fixtureOnboardingPack({
      slug,
      interests: profile.onboarding.interests ?? [],
      goal: profile.onboarding.goal,
    });
  const answers = opts.answers ?? {};
  const quiz_score = scoreAnswers(pack, answers);
  const level = levelFromScore(quiz_score);
  const recs = recommendationsFor(level, profile.onboarding.interests ?? []);
  const nextPack: OnboardingPack = {
    ...pack,
    quiz_score,
    level,
    recommendations: recs,
  };
  await writePack(slug, nextPack);
  await writeJobStatus(slug, { status: "ready", stage: "recommend" });
  return writeLearnerProfile({
    ...profile,
    onboarding: {
      ...profile.onboarding,
      status: "complete",
      quiz_score,
      level,
      recommended_topics: recs,
    },
  });
}

export async function spawnOnboardingStage(
  stage: "quiz" | "recommend",
  slug: string,
  opts: {
    interests?: string[];
    goal?: string;
    answers?: Record<string, string>;
  } = {},
): Promise<void> {
  const root = repoRoot();
  const script = path.join(root, "codex/tools/onboarding_research.py");
  const outputDir = profileDir(slug);

  if (!existsSync(script)) {
    await runInlineFallback(stage, slug, opts);
    return;
  }

  await writeJobStatus(slug, { status: "pending", stage });

  const args = [
    script,
    "--stage",
    stage,
    "--slug",
    slug,
    "--output-dir",
    outputDir,
    "--mode",
    workflowMode(),
  ];
  if (stage === "quiz") {
    for (const interest of opts.interests ?? []) {
      args.push("--interests", interest);
    }
    if (opts.goal) args.push("--goal", opts.goal);
  }
  if (stage === "recommend") {
    args.push("--answers-json", JSON.stringify(opts.answers ?? {}));
  }

  const child = spawn(process.env.PYTHON || "python3", args, {
    cwd: root,
    env: {
      ...process.env,
      PYTHONPATH: root,
      WORKFLOW_MODE: workflowMode(),
    },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

export async function submitInterests(
  slug: string,
  interests: string[],
  goal?: string,
): Promise<LearnerProfile> {
  const profile = await readLearnerProfile(slug);
  if (!profile) throw Object.assign(new Error("unknown profile"), { status: 404 });
  const cleaned = interests.map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (cleaned.length < 1 || cleaned.length > 5) {
    throw Object.assign(new Error("interests must be 1–5 strings"), {
      status: 400,
    });
  }
  const next = await writeLearnerProfile({
    ...profile,
    onboarding: {
      ...profile.onboarding,
      status: "researching",
      interests: cleaned,
      ...(goal?.trim() ? { goal: goal.trim() } : {}),
    },
  });
  await spawnOnboardingStage("quiz", slug, {
    interests: cleaned,
    goal: goal?.trim(),
  });
  return (await readLearnerProfile(slug)) ?? next;
}

export async function submitQuiz(
  slug: string,
  answers: Record<string, string>,
): Promise<LearnerProfile> {
  const profile = await readLearnerProfile(slug);
  if (!profile) throw Object.assign(new Error("unknown profile"), { status: 404 });
  const status = profile.onboarding.status;
  if (status !== "quiz" && status !== "scoring" && status !== "complete") {
    throw Object.assign(new Error("quiz not available"), { status: 409 });
  }
  const pack = await readPack(slug);
  if (!pack) {
    throw Object.assign(new Error("quiz pack missing"), { status: 409 });
  }
  const quiz_score = scoreAnswers(pack, answers);
  const next = await writeLearnerProfile({
    ...profile,
    onboarding: {
      ...profile.onboarding,
      status: "scoring",
      quiz_score,
    },
  });
  await spawnOnboardingStage("recommend", slug, { answers });
  return (await readLearnerProfile(slug)) ?? next;
}

export async function quizQuestionsFor(
  slug: string,
): Promise<
  | { kind: "ok"; questions: ReturnType<typeof publicQuestions> }
  | { kind: "researching" }
  | { kind: "conflict"; status: string }
  | { kind: "missing" }
> {
  const profile = await readLearnerProfile(slug);
  if (!profile) return { kind: "missing" };
  const st = profile.onboarding.status;
  if (st === "researching") return { kind: "researching" };
  if (st !== "quiz" && st !== "scoring" && st !== "complete") {
    return { kind: "conflict", status: st };
  }
  const pack = await readPack(slug);
  if (!pack) {
    if (st === "quiz" || st === "scoring") return { kind: "researching" };
    return { kind: "conflict", status: st };
  }
  return { kind: "ok", questions: publicQuestions(pack) };
}

export async function packForPublic(slug: string) {
  const profile = await readLearnerProfile(slug);
  if (!profile) return null;
  const pack = await readPack(slug);
  if (!pack) return null;
  return publicPack(pack);
}

export async function chatTurns(slug: string): Promise<ChatTurn[] | null> {
  const profile = await readLearnerProfile(slug);
  if (!profile) return null;
  return readChat(slug);
}

export async function appendChat(
  slug: string,
  message: string,
): Promise<{ turns: ChatTurn[]; profile: LearnerProfile } | null> {
  const profile = await readLearnerProfile(slug);
  if (!profile) return null;
  const text = message.trim();
  if (!text) {
    throw Object.assign(new Error("message required"), { status: 400 });
  }
  const ts = nowIso();
  const taste = await readTaste(slug);
  const { axes, reply } = applyChatNudge(taste.axes, text);
  const notes = [text, ...(taste.notes ?? [])].slice(0, 20);
  await writeTaste(slug, {
    ...taste,
    updated_at: ts,
    axes,
    notes,
  });
  const turns = await readChat(slug);
  turns.push({ role: "learner", text, at: ts });
  turns.push({ role: "agent", text: reply, at: nowIso() });
  await writeChat(slug, turns);
  const next = (await readLearnerProfile(slug)) ?? profile;
  return { turns, profile: next };
}

export function isQuizChoiceId(v: unknown): v is QuizChoiceId {
  return v === "a" || v === "b" || v === "c" || v === "d";
}
