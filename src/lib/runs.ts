import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { newId } from "./codex";

export const FIXTURE_RUN_ID = "fixture-dotcom";

const FIXTURE_DIR = path.join(process.cwd(), "codex/examples/fixture-run");
const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts/educational-video");

export type RunStatus = "pending" | "ready" | "failed";

export type RunSnapshot = {
  status: RunStatus;
  run_id: string;
  paths: {
    lesson_script: string;
    asset_manifest: string;
    timings: string;
  };
  script: unknown | null;
  manifest: unknown | null;
  timings: unknown | null;
};

function workflowMode(): string {
  return process.env.WORKFLOW_MODE || "dry-run";
}

export function resolveRunDir(runId: string): string {
  if (runId === FIXTURE_RUN_ID || runId === "fixture") return FIXTURE_DIR;
  return path.join(ARTIFACTS_DIR, runId);
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Create a run without blocking on fal/Tavily. Dry-run copies the fixture. */
export async function startRun(): Promise<{
  run_id: string;
  status: "submitted";
}> {
  const mode = workflowMode();
  if (mode !== "dry-run" && mode !== "") {
    // UI routes never call fal or Tavily, even in live — they only mint a receipt.
    // Live generation stays in the Python pipeline.
  }

  const run_id = newId("run");
  const dest = path.join(ARTIFACTS_DIR, run_id);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  try {
    await cp(FIXTURE_DIR, dest, { recursive: true });
  } catch {
    // Copy failed (readonly fs, missing fixture) — point at the tracked fixture.
    return { run_id: FIXTURE_RUN_ID, status: "submitted" };
  }
  return { run_id, status: "submitted" };
}

export async function readRun(runId: string): Promise<RunSnapshot | null> {
  const dir = resolveRunDir(runId);
  if (!(await dirExists(dir))) return null;

  const paths = {
    lesson_script: "lesson-script.json",
    asset_manifest: "asset-manifest.json",
    timings: "02-content-generation/narration-timings.json",
  };
  const script = await readJson(path.join(dir, paths.lesson_script));
  const manifest = await readJson(path.join(dir, paths.asset_manifest));
  const timings = await readJson(path.join(dir, paths.timings));
  const ready = script !== null && manifest !== null;
  return {
    status: ready ? "ready" : "pending",
    run_id: runId,
    paths,
    script,
    manifest,
    timings,
  };
}

/** Resolve a file inside a run dir. Returns null on traversal or missing. */
export async function resolveRunFile(
  runId: string,
  relPath: string,
): Promise<string | null> {
  const dir = path.resolve(resolveRunDir(runId));
  if (!(await dirExists(dir))) return null;
  const resolved = path.resolve(dir, relPath);
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (resolved !== dir && !resolved.startsWith(prefix)) return null;
  if (!(await fileExists(resolved))) return null;
  return resolved;
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
    }[ext] || "application/octet-stream"
  );
}
