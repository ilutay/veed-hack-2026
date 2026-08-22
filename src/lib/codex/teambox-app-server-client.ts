import "./server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { CODEX_ACTION_OUTPUT_SCHEMAS } from "./schemas";
import type { CodexClientLike } from "./runner";
import type { CodexAction } from "./types";

export const TEAMBOX_CODEX_PROXY_BINARY = "/usr/local/bin/codex" as const;
export const TEAMBOX_CODEX_PROTOCOL_VERSION = "0.149.0" as const;
export const TEAMBOX_CODEX_MODEL = "gpt-5.6-luna" as const;
export const TEAMBOX_CODEX_REASONING_EFFORT = "low" as const;
export const TEAMBOX_CODEX_SERVICE_TIER = "fast" as const;
export const TEAMBOX_CODEX_APP_SERVER_SOCKET =
  "/run/teambox-codex/app-server.sock" as const;
export const TEAMBOX_FIXED_REPO_ROOT =
  "/srv/codex-workspaces/pioneer-gym/veed-hack-2026" as const;

const APP_SERVER_PROTOCOL_MAX_LINE_BYTES = 512 * 1024;

type JsonRecord = Record<string, unknown>;

interface AppServerCollector {
  finalResponse: string;
  items: Array<{ type: string }>;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  } | null;
  completed: boolean;
  turnError: string | null;
}

interface PendingRead {
  resolve: (value: JsonRecord) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class JsonLineInbox {
  private bufferedText = "";
  private readonly queued: JsonRecord[] = [];
  private readonly pending: PendingRead[] = [];
  private terminalError: Error | null = null;

  push(chunk: Buffer): void {
    if (this.terminalError) return;
    this.bufferedText += chunk.toString("utf8");
    if (Buffer.byteLength(this.bufferedText, "utf8") > APP_SERVER_PROTOCOL_MAX_LINE_BYTES) {
      this.fail(new Error("Codex app-server protocol line is too large"));
      return;
    }
    for (;;) {
      const newline = this.bufferedText.indexOf("\n");
      if (newline < 0) break;
      const line = this.bufferedText.slice(0, newline).trim();
      this.bufferedText = this.bufferedText.slice(newline + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.fail(new Error("Codex app-server emitted invalid JSON"));
        return;
      }
      if (!isRecord(parsed)) {
        this.fail(new Error("Codex app-server emitted a non-object message"));
        return;
      }
      this.deliver(parsed);
    }
  }

  fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    for (const read of this.pending.splice(0)) {
      read.signal?.removeEventListener("abort", read.onAbort!);
      read.reject(error);
    }
  }

  next(signal?: AbortSignal): Promise<JsonRecord> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    if (this.terminalError) return Promise.reject(this.terminalError);
    return new Promise((resolve, reject) => {
      const read: PendingRead = { resolve, reject, signal };
      const onAbort = () => {
        const index = this.pending.indexOf(read);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error("Codex app-server request was cancelled"));
      };
      read.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.pending.push(read);
    });
  }

  private deliver(message: JsonRecord): void {
    const read = this.pending.shift();
    if (!read) {
      this.queued.push(message);
      return;
    }
    read.signal?.removeEventListener("abort", read.onAbort!);
    read.resolve(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqualJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function actionFromTrustedPrompt(prompt: string): CodexAction {
  const matches = [...prompt.matchAll(/<action>([^<]+)<\/action>/g)];
  if (matches.length !== 1) {
    throw new Error("Trusted Codex action prompt has an invalid action binding");
  }
  const action = matches[0]?.[1];
  if (
    action !== "interpret_goal" &&
    action !== "author_rep" &&
    action !== "assess_response" &&
    action !== "decide_next"
  ) {
    throw new Error("Trusted Codex action prompt has an unknown action");
  }
  return action;
}

function safeProxyEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/var/empty",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
  };
}

function writeMessage(
  child: ChildProcessWithoutNullStreams,
  message: JsonRecord,
): void {
  const line = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(line, "utf8") > APP_SERVER_PROTOCOL_MAX_LINE_BYTES) {
    throw new Error("Codex app-server request line is too large");
  }
  child.stdin.write(line);
}

export function fixedTeamboxThreadStartParams(fixedRepoRoot: string) {
  return {
    cwd: fixedRepoRoot,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    model: TEAMBOX_CODEX_MODEL,
    serviceTier: TEAMBOX_CODEX_SERVICE_TIER,
    serviceName: "pioneer-gym",
    config: {
      web_search: "disabled",
      allow_login_shell: false,
      apps: { _default: { enabled: false } },
      skills: { include_instructions: false },
      mcp_servers: {},
    },
  } as const;
}

export function fixedTeamboxTurnStartParams(
  fixedRepoRoot: string,
  threadId: string,
  prompt: string,
  outputSchema: Readonly<Record<string, unknown>>,
) {
  return {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    cwd: fixedRepoRoot,
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    model: TEAMBOX_CODEX_MODEL,
    effort: TEAMBOX_CODEX_REASONING_EFFORT,
    serviceTier: TEAMBOX_CODEX_SERVICE_TIER,
    outputSchema,
  } as const;
}

function handleNotification(
  message: JsonRecord,
  collector: AppServerCollector,
): void {
  if ("id" in message && typeof message.method === "string") {
    throw new Error("Codex app-server requested a forbidden client action");
  }
  if (typeof message.method !== "string") return;
  if (message.method === "error") {
    throw new Error("Codex app-server reported an error");
  }

  const params = isRecord(message.params) ? message.params : null;
  if (message.method === "item/completed" && params && isRecord(params.item)) {
    const item = params.item;
    const type = item.type;
    if (type === "agentMessage") {
      if (typeof item.text === "string") collector.finalResponse = item.text;
      collector.items.push({ type: "agent_message" });
    } else if (type === "reasoning") {
      collector.items.push({ type: "reasoning" });
    } else if (type === "plan") {
      collector.items.push({ type: "todo_list" });
    } else if (type !== "userMessage") {
      collector.items.push({ type: String(type ?? "unknown_item") });
    }
    return;
  }

  if (
    message.method === "thread/tokenUsage/updated" &&
    params &&
    isRecord(params.tokenUsage) &&
    isRecord(params.tokenUsage.last)
  ) {
    const last = params.tokenUsage.last;
    if (
      Number.isInteger(last.inputTokens) &&
      Number.isInteger(last.cachedInputTokens) &&
      Number.isInteger(last.outputTokens)
    ) {
      collector.usage = {
        input_tokens: Number(last.inputTokens),
        cached_input_tokens: Number(last.cachedInputTokens),
        output_tokens: Number(last.outputTokens),
      };
    }
    return;
  }

  if (message.method === "turn/completed" && params && isRecord(params.turn)) {
    collector.completed = true;
    if (params.turn.status !== "completed") {
      const turnError = isRecord(params.turn.error)
        ? params.turn.error.message
        : null;
      collector.turnError =
        typeof turnError === "string" ? turnError : "Codex turn failed";
    }
  }
}

async function waitForResponse(
  inbox: JsonLineInbox,
  id: number,
  collector: AppServerCollector,
  signal: AbortSignal,
): Promise<JsonRecord> {
  for (;;) {
    const message = await inbox.next(signal);
    if (message.id === id) {
      if ("error" in message) throw new Error("Codex app-server RPC failed");
      if (!isRecord(message.result)) {
        throw new Error("Codex app-server RPC response is malformed");
      }
      return message.result;
    }
    if ("id" in message && !("method" in message)) {
      throw new Error("Codex app-server response ID is out of sequence");
    }
    handleNotification(message, collector);
  }
}

async function runThroughFixedProxy(
  fixedRepoRoot: string,
  prompt: string,
  outputSchema: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) {
  const action = actionFromTrustedPrompt(prompt);
  if (!deepEqualJson(outputSchema, CODEX_ACTION_OUTPUT_SCHEMAS[action])) {
    throw new Error("Codex action output schema is not the fixed action schema");
  }

  const child = spawn(
    TEAMBOX_CODEX_PROXY_BINARY,
    [
      "app-server",
      "proxy",
      "--sock",
      TEAMBOX_CODEX_APP_SERVER_SOCKET,
    ],
    {
      cwd: fixedRepoRoot,
      env: safeProxyEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const inbox = new JsonLineInbox();
  const collector: AppServerCollector = {
    finalResponse: "",
    items: [],
    usage: null,
    completed: false,
    turnError: null,
  };
  child.stdout.on("data", (chunk: Buffer) => inbox.push(chunk));
  child.stderr.on("data", () => {
    // stderr can contain host paths or account details. Never return or persist it.
  });
  child.once("error", () =>
    inbox.fail(new Error("Codex app-server proxy could not start")),
  );
  child.once("exit", (code) => {
    if (!collector.completed) {
      inbox.fail(
        new Error(`Codex app-server proxy exited before completion (${code})`),
      );
    }
  });

  try {
    writeMessage(child, {
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "pioneer-gym-gateway",
          title: "Pioneer Gym Gateway",
          version: "1.0.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: null,
          extensions: null,
        },
      },
    });
    const initialized = await waitForResponse(inbox, 1, collector, signal);
    if (
      typeof initialized.userAgent !== "string" ||
      !initialized.userAgent.includes(TEAMBOX_CODEX_PROTOCOL_VERSION)
    ) {
      throw new Error("Codex app-server protocol version does not match 0.149.0");
    }
    writeMessage(child, { method: "initialized" });

    writeMessage(child, {
      method: "thread/start",
      id: 2,
      params: fixedTeamboxThreadStartParams(fixedRepoRoot),
    });
    const threadStart = await waitForResponse(inbox, 2, collector, signal);
    const thread = isRecord(threadStart.thread) ? threadStart.thread : null;
    const sandbox = isRecord(threadStart.sandbox) ? threadStart.sandbox : null;
    if (
      !thread ||
      typeof thread.id !== "string" ||
      thread.cwd !== fixedRepoRoot ||
      thread.ephemeral !== true ||
      threadStart.cwd !== fixedRepoRoot ||
      threadStart.approvalPolicy !== "never" ||
      threadStart.model !== TEAMBOX_CODEX_MODEL ||
      threadStart.serviceTier !== TEAMBOX_CODEX_SERVICE_TIER ||
      !sandbox ||
      sandbox.type !== "readOnly" ||
      sandbox.networkAccess !== false
    ) {
      throw new Error("Codex app-server did not honor the fixed thread policy");
    }

    writeMessage(child, {
      method: "turn/start",
      id: 3,
      params: fixedTeamboxTurnStartParams(
        fixedRepoRoot,
        thread.id,
        prompt,
        outputSchema,
      ),
    });
    const turnStart = await waitForResponse(inbox, 3, collector, signal);
    if (
      !isRecord(turnStart.turn) ||
      typeof turnStart.turn.id !== "string"
    ) {
      throw new Error("Codex app-server did not return a turn ID");
    }
    while (!collector.completed) {
      handleNotification(await inbox.next(signal), collector);
    }
    if (collector.turnError) throw new Error(collector.turnError);
    if (!collector.finalResponse) {
      throw new Error("Codex app-server completed without a final response");
    }
    return {
      finalResponse: collector.finalResponse,
      items: collector.items,
      usage: collector.usage,
    };
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
  }
}

export class TeamboxAppServerCodexClient implements CodexClientLike {
  constructor(private readonly fixedRepoRoot = TEAMBOX_FIXED_REPO_ROOT) {}

  startThread(options: Parameters<CodexClientLike["startThread"]>[0]) {
    const keys = Object.keys(options).sort();
    const expectedKeys = [
      "approvalPolicy",
      "networkAccessEnabled",
      "sandboxMode",
      "skipGitRepoCheck",
      "webSearchMode",
      "workingDirectory",
    ].sort();
    if (
      JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
      options.sandboxMode !== "read-only" ||
      options.workingDirectory !== this.fixedRepoRoot ||
      options.skipGitRepoCheck !== false ||
      options.networkAccessEnabled !== false ||
      options.webSearchMode !== "disabled" ||
      options.approvalPolicy !== "never"
    ) {
      throw new Error("Unsafe Codex thread options rejected by TeamBox gateway");
    }

    return {
      run: (
        prompt: string,
        turnOptions: {
          outputSchema: Readonly<Record<string, unknown>>;
          signal: AbortSignal;
        },
      ) =>
        runThroughFixedProxy(
          this.fixedRepoRoot,
          prompt,
          turnOptions.outputSchema,
          turnOptions.signal,
        ),
    };
  }
}

export function createTeamboxAppServerCodexClient(): CodexClientLike {
  return new TeamboxAppServerCodexClient(TEAMBOX_FIXED_REPO_ROOT);
}
