import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TamboComponentContent } from "@tambo-ai/react";
import {
  blocksForProfile,
  completeOnboardingBlocks,
  componentBlock,
  newId,
  type CodexAction,
} from "../src/lib/codex";
import {
  appendChat,
  chatTurns,
  enterProfile,
  isQuizChoiceId,
  packForPublic,
  parseProfileSlug,
  quizQuestionsFor,
  readLearnerProfile,
  submitInterests,
  submitQuiz,
} from "./profiles";
import {
  mimeFor,
  listLibrary,
  readRun,
  resolveRunFile,
  startFixtureRun,
  startWorkflowRun,
} from "../src/lib/runs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.API_PORT || 8787);

const preexisting = new Set(Object.keys(process.env));
loadDotenv(path.join(REPO, ".env"), preexisting);
loadDotenv(path.join(REPO, ".env.local"), preexisting);

function loadDotenv(file: string, keep: Set<string>) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (keep.has(key)) continue;
    process.env[key] = val;
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function handleCodexAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: {
    episodeId?: string;
    mode?: "demo" | "workflow";
    action?: CodexAction;
  };
  try {
    body = (await readJson(req)) as typeof body;
  } catch {
    send(res, 400, { error: "invalid json" });
    return;
  }
  const action = body.action;
  if (!action?.type) {
    send(res, 400, { error: "missing action" });
    return;
  }
  const mode = body.mode === "demo" ? "demo" : "workflow";
  const episodeId = body.episodeId || newId("ep");
  const turnId = newId("turn");
  let run_id: string | undefined;
  let blocks: TamboComponentContent[] = [];
  let profile: Awaited<ReturnType<typeof readLearnerProfile>> = null;
  let keep_blocks = false;

  switch (action.type) {
    case "topic_submitted":
    case "recommendation_selected": {
      const topic = action.payload.topic;
      const receipt =
        mode === "demo" ? await startFixtureRun() : await startWorkflowRun(topic);
      run_id = receipt.run_id;
      blocks = [componentBlock("LessonPlayer", { run_id }, `player-${run_id}`)];
      break;
    }
    case "playback_ended": {
      run_id = action.payload.run_id;
      blocks = [
        componentBlock("LessonPlayer", { run_id }, `player-${run_id}`),
        componentBlock("NextChoices", { run_id }, `choices-${run_id}`),
      ];
      break;
    }
    case "choice_selected": {
      run_id = action.payload.run_id;
      blocks = [componentBlock("TasteFeedback", { run_id }, `taste-${run_id}`)];
      break;
    }
    case "taste_reaction": {
      run_id = action.payload.run_id;
      const seed =
        action.payload.reaction === "more-examples"
          ? "a concrete worked example"
          : undefined;
      blocks = [
        componentBlock(
          "PromptComposer",
          seed ? { seed_topic: seed } : {},
          `composer-${turnId}`,
        ),
      ];
      break;
    }
    case "profile_entered": {
      profile = await readLearnerProfile(action.payload.slug);
      if (!profile) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      blocks = blocksForProfile(profile, `p-${turnId}`);
      break;
    }
    case "interests_submitted": {
      profile = await readLearnerProfile(action.payload.slug);
      if (!profile) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      blocks = [
        componentBlock(
          "LevelQuiz",
          { slug: profile.slug },
          `quiz-${turnId}`,
        ),
      ];
      break;
    }
    case "quiz_submitted": {
      profile = await readLearnerProfile(action.payload.slug);
      if (!profile) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      blocks = completeOnboardingBlocks(profile, `q-${turnId}`);
      break;
    }
    case "agent_message": {
      run_id = action.payload.run_id;
      keep_blocks = true;
      break;
    }
    case "library_selected": {
      run_id = action.payload.run_id;
      blocks = [
        componentBlock("LessonPlayer", { run_id }, `player-${run_id}`),
      ];
      break;
    }
    default:
      send(res, 400, { error: "unknown action" });
      return;
  }

  send(res, 200, {
    status: "submitted",
    episodeId,
    turnId,
    run_id,
    blocks,
    keep_blocks,
    ...(profile ? { profile } : {}),
  });
}

async function handleRunCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let topic = "";
  let mode: "demo" | "workflow" = "workflow";
  try {
    const body = (await readJson(req)) as { topic?: string; mode?: string };
    topic = typeof body.topic === "string" ? body.topic : "";
    if (body.mode === "demo") mode = "demo";
  } catch {
    /* empty */
  }
  const receipt =
    mode === "demo" || !topic.trim()
      ? await startFixtureRun()
      : await startWorkflowRun(topic);
  send(res, 202, receipt);
}

const FILE_RE = /^\/api\/run\/([^/]+)\/file\/(.+)$/;
const RUN_RE = /^\/api\/run\/([^/]+)\/?$/;
const PROFILE_QUIZ_RE = /^\/api\/profile\/([^/]+)\/quiz\/?$/;
const PROFILE_INTERESTS_RE = /^\/api\/profile\/([^/]+)\/interests\/?$/;
const PROFILE_CHAT_RE = /^\/api\/profile\/([^/]+)\/chat\/?$/;
const PROFILE_PACK_RE = /^\/api\/profile\/([^/]+)\/pack\/?$/;
const PROFILE_ONE_RE = /^\/api\/profile\/([^/]+)\/?$/;

function slugParam(raw: string | undefined): string | null {
  if (!raw) return null;
  return parseProfileSlug(raw);
}

function errStatus(err: unknown): number {
  if (err && typeof err === "object" && "status" in err) {
    const n = Number((err as { status: unknown }).status);
    if (Number.isFinite(n) && n >= 400 && n < 600) return n;
  }
  return 500;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const method = req.method || "GET";
    const p = url.pathname;

    if (method === "POST" && p === "/api/codex/action") {
      await handleCodexAction(req, res);
      return;
    }
    if (method === "POST" && p === "/api/run") {
      await handleRunCreate(req, res);
      return;
    }
    if (method === "POST" && p === "/api/profile") {
      let name = "";
      try {
        const body = (await readJson(req)) as { name?: unknown };
        name = typeof body.name === "string" ? body.name : "";
      } catch {
        send(res, 400, { error: "invalid json" });
        return;
      }
      try {
        const result = await enterProfile(name);
        send(res, 200, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "profile failed";
        send(res, msg === "name required" ? 400 : 500, { error: msg });
      }
      return;
    }
    const quizMatch = p.match(PROFILE_QUIZ_RE);
    if (quizMatch) {
      const slug = slugParam(quizMatch[1]);
      if (!slug) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      if (method === "GET") {
        const q = await quizQuestionsFor(slug);
        if (q.kind === "missing") {
          send(res, 404, { error: "unknown profile" });
          return;
        }
        if (q.kind === "researching") {
          send(res, 202, { status: "researching" });
          return;
        }
        if (q.kind === "conflict") {
          send(res, 409, { error: "quiz not available", status: q.status });
          return;
        }
        send(res, 200, { questions: q.questions });
        return;
      }
      if (method === "POST") {
        let answers: Record<string, string> = {};
        try {
          const body = (await readJson(req)) as { answers?: unknown };
          if (body.answers && typeof body.answers === "object") {
            for (const [k, v] of Object.entries(
              body.answers as Record<string, unknown>,
            )) {
              if (isQuizChoiceId(v)) answers[k] = v;
            }
          }
        } catch {
          send(res, 400, { error: "invalid json" });
          return;
        }
        try {
          const profile = await submitQuiz(slug, answers);
          send(res, 200, { status: "submitted", profile });
        } catch (err) {
          send(res, errStatus(err), {
            error: err instanceof Error ? err.message : "quiz failed",
          });
        }
        return;
      }
    }
    const interestsMatch = p.match(PROFILE_INTERESTS_RE);
    if (interestsMatch && method === "POST") {
      const slug = slugParam(interestsMatch[1]);
      if (!slug) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      let interests: string[] = [];
      let goal: string | undefined;
      try {
        const body = (await readJson(req)) as {
          interests?: unknown;
          goal?: unknown;
        };
        if (Array.isArray(body.interests)) {
          interests = body.interests.filter(
            (x): x is string => typeof x === "string",
          );
        }
        if (typeof body.goal === "string") goal = body.goal;
      } catch {
        send(res, 400, { error: "invalid json" });
        return;
      }
      try {
        const profile = await submitInterests(slug, interests, goal);
        send(res, 200, { status: "submitted", profile });
      } catch (err) {
        send(res, errStatus(err), {
          error: err instanceof Error ? err.message : "interests failed",
        });
      }
      return;
    }
    const chatMatch = p.match(PROFILE_CHAT_RE);
    if (chatMatch) {
      const slug = slugParam(chatMatch[1]);
      if (!slug) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      if (method === "GET") {
        const turns = await chatTurns(slug);
        if (!turns) {
          send(res, 404, { error: "unknown profile" });
          return;
        }
        send(res, 200, { turns });
        return;
      }
      if (method === "POST") {
        let message = "";
        try {
          const body = (await readJson(req)) as { message?: unknown };
          message = typeof body.message === "string" ? body.message : "";
        } catch {
          send(res, 400, { error: "invalid json" });
          return;
        }
        try {
          const result = await appendChat(slug, message);
          if (!result) {
            send(res, 404, { error: "unknown profile" });
            return;
          }
          send(res, 200, result);
        } catch (err) {
          send(res, errStatus(err), {
            error: err instanceof Error ? err.message : "chat failed",
          });
        }
        return;
      }
    }
    const packMatch = p.match(PROFILE_PACK_RE);
    if (packMatch && method === "GET") {
      const slug = slugParam(packMatch[1]);
      if (!slug) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      const pack = await packForPublic(slug);
      if (!pack) {
        send(res, 404, { error: "pack not found" });
        return;
      }
      send(res, 200, pack);
      return;
    }
    const profileMatch = p.match(PROFILE_ONE_RE);
    if (profileMatch && method === "GET") {
      const slug = slugParam(profileMatch[1]);
      if (!slug) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      const profile = await readLearnerProfile(slug);
      if (!profile) {
        send(res, 404, { error: "unknown profile" });
        return;
      }
      send(res, 200, profile);
      return;
    }
    if (method === "GET" && (p === "/api/runs" || p === "/api/runs/")) {
      const runs = await listLibrary();
      send(res, 200, { runs });
      return;
    }
    const fileMatch = p.match(FILE_RE);
    if (fileMatch && (method === "GET" || method === "HEAD")) {
      const id = decodeURIComponent(fileMatch[1]);
      const rel = decodeURIComponent(fileMatch[2]);
      const file = await resolveRunFile(id, rel);
      if (!file) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const info = await stat(file);
      const headers = {
        "Content-Type": mimeFor(file),
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=60",
      };
      if (method === "HEAD") {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      createReadStream(file).pipe(res);
      return;
    }
    const runMatch = p.match(RUN_RE);
    if (runMatch && method === "GET") {
      const snap = await readRun(decodeURIComponent(runMatch[1]));
      if (!snap) {
        send(res, 404, { error: "unknown run" });
        return;
      }
      send(res, 200, snap);
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, {
      error: err instanceof Error ? err.message : "server error",
    });
  }
});

process.chdir(REPO);

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`api http://127.0.0.1:${PORT}\n`);
});
