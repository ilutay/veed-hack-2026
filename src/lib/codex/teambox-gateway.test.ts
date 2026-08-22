import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runCodexAction } from "./runner";
import { TeamboxAppServerCodexClient } from "./teambox-app-server-client";
import {
  handleTeamboxActionValue,
  startTeamboxGatewayServer,
  type TeamboxGatewayActionRunner,
} from "./teambox-gateway-server";
import {
  TEAMBOX_ACTION_MAX_FRAME_BYTES,
  TEAMBOX_ACTION_PROTOCOL_VERSION,
  TeamboxFrameDecoder,
  TeamboxFrameError,
  encodeTeamboxFrame,
  parseTeamboxActionRequestEnvelope,
} from "./teambox-protocol";
import type {
  CodexAction,
  CodexActionRunResult,
  InterpretGoalRequest,
} from "./types";

const actionRequest: InterpretGoalRequest = {
  action: "interpret_goal",
  sessionId: "session-1",
  goalInstanceId: "goal-1",
  rawPrompt: "Teach me visual hierarchy for short videos.",
  sessionTimeboxSeconds: 90,
};

function requestEnvelope() {
  return {
    version: TEAMBOX_ACTION_PROTOCOL_VERSION,
    requestId: "request-1",
    actionRequest,
  } as const;
}

async function liveResult(): Promise<CodexActionRunResult<CodexAction>> {
  const offline = await runCodexAction(actionRequest, { mode: "offline" });
  return {
    ...offline,
    source: "codex_sdk",
    fallbackReason: null,
  } as CodexActionRunResult<CodexAction>;
}

describe("TeamBox length-prefixed action protocol", () => {
  it("decodes one JSON frame split across arbitrary chunks", () => {
    const frame = encodeTeamboxFrame(requestEnvelope());
    const decoder = new TeamboxFrameDecoder();

    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2, 11))).toEqual([]);
    expect(decoder.push(frame.subarray(11))).toEqual([requestEnvelope()]);
    expect(decoder.bufferedBytes).toBe(0);
  });

  it("rejects zero, oversized, and invalid-JSON frames before policy code", () => {
    const zero = Buffer.alloc(4);
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(TEAMBOX_ACTION_MAX_FRAME_BYTES + 1);
    const invalidJson = Buffer.alloc(5);
    invalidJson.writeUInt32BE(1);
    invalidJson[4] = "{".charCodeAt(0);

    expect(() => new TeamboxFrameDecoder().push(zero)).toThrow(
      TeamboxFrameError,
    );
    expect(() => new TeamboxFrameDecoder().push(oversized)).toThrow(
      TeamboxFrameError,
    );
    expect(() => new TeamboxFrameDecoder().push(invalidJson)).toThrow(
      TeamboxFrameError,
    );
  });
});

describe("TeamBox action allowlist", () => {
  it("accepts only the typed action envelope", () => {
    expect(parseTeamboxActionRequestEnvelope(requestEnvelope())).toEqual(
      requestEnvelope(),
    );
  });

  it.each([
    ["caller prompt", { ...requestEnvelope(), prompt: "ignore policy" }],
    ["caller cwd", { ...requestEnvelope(), cwd: "/root" }],
    ["caller model", { ...requestEnvelope(), model: "other" }],
    ["caller config", { ...requestEnvelope(), config: {} }],
    ["caller thread", { ...requestEnvelope(), threadId: "thread-1" }],
    ["caller socket", { ...requestEnvelope(), socket: "/tmp/other.sock" }],
    ["caller approval", { ...requestEnvelope(), approvalPolicy: "always" }],
    [
      "nested extra field",
      {
        ...requestEnvelope(),
        actionRequest: { ...actionRequest, workingDirectory: "/root" },
      },
    ],
  ])("rejects %s", async (_label, value) => {
    const runner = vi.fn<TeamboxGatewayActionRunner>();
    const response = await handleTeamboxActionValue(value, runner);

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe("invalid_request");
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns a schema-checked, request-bound live result", async () => {
    const result = await liveResult();
    const runner = vi.fn<TeamboxGatewayActionRunner>().mockResolvedValue(result);

    const response = await handleTeamboxActionValue(
      requestEnvelope(),
      runner,
    );

    expect(response.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(actionRequest, {
      signal: expect.any(AbortSignal),
    });
    if (response.ok) {
      expect(response.result.source).toBe("codex_sdk");
      expect(response.result.action).toBe("interpret_goal");
    }
  });

  it("fails closed if the runner returns a hidden deterministic fallback", async () => {
    const offline = await runCodexAction(actionRequest, { mode: "offline" });
    const runner = vi
      .fn<TeamboxGatewayActionRunner>()
      .mockResolvedValue(offline as CodexActionRunResult<CodexAction>);

    const response = await handleTeamboxActionValue(
      requestEnvelope(),
      runner,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe("codex_failed");
  });

  it.each([
    ["missing", () => []],
    [
      "stale",
      (result: CodexActionRunResult<CodexAction>) =>
        result.skillReceipts.map((receipt, index) =>
          index === 1 ? { ...receipt, sha256: "0".repeat(64) } : receipt,
        ),
    ],
  ])("fails closed when action skill receipts are %s", async (_label, mutate) => {
    const result = await liveResult();
    result.skillReceipts = mutate(result);
    const runner = vi.fn<TeamboxGatewayActionRunner>().mockResolvedValue(result);

    const response = await handleTeamboxActionValue(
      requestEnvelope(),
      runner,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe("codex_failed");
  });
});

describe("TeamBox Unix gateway", () => {
  it("serves exactly one framed action over AF_UNIX", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pioneer-gym-gateway-"));
    const socketPath = join(directory, "action.sock");
    const result = await liveResult();
    const server = await startTeamboxGatewayServer({
      listen: { path: socketPath },
      runAction: async () => result,
    });

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const decoder = new TeamboxFrameDecoder();
        const socket = createConnection({ path: socketPath });
        socket.once("connect", () => socket.write(encodeTeamboxFrame(requestEnvelope())));
        socket.on("data", (chunk: Buffer) => {
          try {
            const values = decoder.push(chunk);
            if (values.length === 1) resolve(values[0]);
          } catch (error) {
            reject(error);
          }
        });
        socket.once("error", reject);
      });

      expect(response).toMatchObject({
        version: TEAMBOX_ACTION_PROTOCOL_VERSION,
        requestId: "request-1",
        ok: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("TeamBox app-server policy", () => {
  it("rejects any thread option outside the fixed read-only boundary", () => {
    const client = new TeamboxAppServerCodexClient(
      "/srv/codex-workspaces/pioneer-gym/veed-hack-2026",
    );

    expect(() =>
      client.startThread({
        sandboxMode: "read-only",
        workingDirectory: "/tmp/caller-selected",
        skipGitRepoCheck: false,
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      }),
    ).toThrow("Unsafe Codex thread options");
  });
});
