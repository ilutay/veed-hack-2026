import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function repoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "codex/tools/run_workflow.py"))) return cwd;
  throw new Error("codex/tools/run_workflow.py not found from process.cwd()");
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
