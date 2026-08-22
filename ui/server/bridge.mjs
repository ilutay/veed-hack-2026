/**
 * Codex bridge.
 *
 * The missing half of the loop: the browser posts the learner's state here,
 * this process runs a codex-cli turn constrained to the gym component schema,
 * and returns the component command the UI then renders through the Tambo
 * registry.
 *
 * Codex runs as `codex-runner`, the only account holding the auth file, via the
 * same CLI path `codex doctor` validates. Nothing about Tambo is involved on
 * this side — the browser is the only place the SDK exists.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const RUN_AS = process.env.CODEX_USER ?? "codex-runner";
const CODEX_HOME = process.env.CODEX_HOME ?? "/var/lib/codex-runner";
const SCHEMA = resolve(import.meta.dirname, "component-command.schema.json");

const SYSTEM = `You are the tutor loop for a Pioneer learning gym.
Given the learner state below, choose exactly ONE gym component to show next and
produce its props. Reply with JSON matching the provided schema and nothing else.

Guidance:
- ProbeArena: diagnose an untested skill.
- CreditAssignmentReplay: the learner just answered; explain the grade against their words.
- TargetedRetryGym: one skill failed and retries remain.
- LayerOrderTransferGym: the skill is known; test whether the ordering transfers.`;

/** Runs one codex turn and returns the parsed component command. */
function runCodexTurn(prompt) {
  return new Promise((resolvePromise, reject) => {
    // mkdtemp is 0700 and owned by whoever runs this bridge; codex-runner has to
    // cd into it and write the output file, so widen it. It holds no secrets and
    // is removed when the turn ends.
    const dir = mkdtempSync(join(tmpdir(), "codex-gym-"));
    chmodSync(dir, 0o777);
    const outFile = join(dir, "last-message.json");

    const args = [
      "-n", "-u", RUN_AS,
      "env", `HOME=${CODEX_HOME}`,
      "codex", "exec",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "-C", dir,
      "--output-schema", SCHEMA,
      "--output-last-message", outFile,
      `${SYSTEM}\n\nLearner state:\n${prompt}`,
    ];

    const child = spawn("sudo", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error(`codex exec exited ${code}: ${stderr.slice(-500)}`);
        const raw = readFileSync(outFile, "utf8").trim();
        resolvePromise(JSON.parse(raw));
      } catch (err) {
        reject(err);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    child.on("error", reject);
  });
}

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && req.url === "/api/health") {
    return json(res, 200, { ok: true, runAs: RUN_AS, schema: SCHEMA });
  }
  if (req.method !== "POST" || req.url !== "/api/turn") return json(res, 404, { error: "not found" });

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let episodeId, turnId, state;
    try {
      ({ episodeId, turnId, state } = JSON.parse(body || "{}"));
    } catch {
      return json(res, 400, { error: "invalid JSON body" });
    }
    try {
      const started = Date.now();
      const command = await runCodexTurn(state ?? "New learner, nothing measured yet.");
      // Ids are ours, not the model's — never let it name its own render target.
      json(res, 200, {
        componentId: randomUUID(),
        componentName: command.componentName,
        props: command.props,
        episodeId: episodeId ?? "ep-1",
        turnId: turnId ?? "turn-1",
        elapsedMs: Date.now() - started,
      });
    } catch (err) {
      json(res, 502, { error: String(err.message ?? err) });
    }
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`codex bridge on http://127.0.0.1:${PORT} (codex as ${RUN_AS})`);
});
