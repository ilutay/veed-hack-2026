import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TamboComponentContent } from "@tambo-ai/react";
import { componentBlock, newId, type CodexAction } from "../src/lib/codex";
import {
  mimeFor,
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

  switch (action.type) {
    case "topic_submitted": {
      const receipt =
        mode === "demo"
          ? await startFixtureRun()
          : await startWorkflowRun(action.payload.topic);
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
