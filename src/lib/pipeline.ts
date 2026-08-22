import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function repoRoot(): string {
  const hasAppRoot = (dir: string) =>
    existsSync(path.join(dir, "src")) && existsSync(path.join(dir, "server"));

  if (hasAppRoot(process.cwd())) return process.cwd();

  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (hasAppRoot(dir)) return dir;
  }

  throw new Error(
    "repo root not found (expected src/ and server/ under process.cwd() or a parent)",
  );
}

function hasKey(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.length > 0);
}

export function researchMode(): "dry-run" | "live" {
  if (process.env.WORKFLOW_MODE === "live" || hasKey("TAVILY_API_KEY"))
    return "live";
  return "dry-run";
}

export function mediaMode(): "dry-run" | "live" {
  if (process.env.WORKFLOW_MODE === "live" && hasKey("FAL_KEY")) return "live";
  return "dry-run";
}

export async function spawnWorkflow(
  runId: string,
  topic: string,
): Promise<void> {
  const root = repoRoot();
  const script = path.join(root, "codex/tools/run_workflow.py");
  if (!existsSync(script)) {
    throw new Error("codex/tools/run_workflow.py not found from process.cwd()");
  }
  const out = path.join(root, "artifacts/educational-video", runId);
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, "status.json"),
    JSON.stringify(
      { status: "pending", stage: "queued", run_id: runId, topic },
      null,
      2,
    ) + "\n",
  );

  const child = spawn(
    process.env.PYTHON || "python3",
    [
      "codex/tools/run_workflow.py",
      "--topic",
      topic,
      "--output-dir",
      out,
      "--run-id",
      runId,
      "--research-mode",
      researchMode(),
      "--media-mode",
      mediaMode(),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PYTHONPATH: root,
        WORKFLOW_MODE:
          researchMode() === "live" || mediaMode() === "live"
            ? "live"
            : "dry-run",
      },
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
}
