import "./server-only";

import { createServer, type Server, type Socket } from "node:net";

import { LIVE_TEAMBOX_GATEWAY_DEADLINE_MS } from "../contracts/live-deadlines";
import {
  TEAMBOX_ACTION_PROTOCOL_VERSION,
  TeamboxFrameDecoder,
  TeamboxFrameError,
  encodeTeamboxFrame,
  parseTeamboxActionRequestEnvelope,
  parseTeamboxActionResponseEnvelope,
  type TeamboxActionResponseEnvelope,
  type TeamboxGatewayErrorCode,
} from "./teambox-protocol";
import { loadCodexActionSkills, toSkillReceipt } from "./skill-loader";
import type {
  AnyCodexActionRequest,
  CodexAction,
  CodexActionRunResult,
} from "./types";

const CONNECTION_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_ACTIONS = 2;

export type TeamboxGatewayActionRunner = (
  request: AnyCodexActionRequest,
  options: { signal: AbortSignal },
) => Promise<CodexActionRunResult<CodexAction>>;

function errorEnvelope(
  requestId: string,
  code: TeamboxGatewayErrorCode,
  message: string,
): TeamboxActionResponseEnvelope {
  return {
    version: TEAMBOX_ACTION_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code, message },
  };
}

function safeRequestId(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).requestId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(
      (value as Record<string, unknown>).requestId as string,
    )
  ) {
    return (value as Record<string, unknown>).requestId as string;
  }
  return "unbound";
}

export async function handleTeamboxActionValue(
  value: unknown,
  runAction: TeamboxGatewayActionRunner,
): Promise<TeamboxActionResponseEnvelope> {
  let envelope;
  try {
    envelope = parseTeamboxActionRequestEnvelope(value);
  } catch {
    return errorEnvelope(
      safeRequestId(value),
      "invalid_request",
      "The action request is invalid",
    );
  }

  const abort = new AbortController();
  let deadlineHit = false;
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    deadlineHit = true;
    const error = new Error("TeamBox action deadline exceeded");
    abort.abort(error);
    rejectDeadline?.(error);
  }, LIVE_TEAMBOX_GATEWAY_DEADLINE_MS);
  try {
    const result = await Promise.race([
      runAction(envelope.actionRequest, { signal: abort.signal }),
      deadline,
    ]);
    const response: TeamboxActionResponseEnvelope = {
      version: TEAMBOX_ACTION_PROTOCOL_VERSION,
      requestId: envelope.requestId,
      ok: true,
      result,
    };
    const expectedSkillReceipts = (
      await loadCodexActionSkills(envelope.actionRequest.action)
    ).map(toSkillReceipt);
    // Defense in depth: the gateway validates its own output before framing it.
    parseTeamboxActionResponseEnvelope(
      response,
      envelope.requestId,
      envelope.actionRequest.action,
      expectedSkillReceipts,
    );
    return response;
  } catch {
    return errorEnvelope(
      envelope.requestId,
      deadlineHit ? "deadline_exceeded" : "codex_failed",
      deadlineHit
        ? "The live Codex action exceeded its deadline"
        : "The live Codex action failed safely",
    );
  } finally {
    clearTimeout(timer);
  }
}

function endWith(socket: Socket, value: TeamboxActionResponseEnvelope): void {
  try {
    socket.end(encodeTeamboxFrame(value));
  } catch {
    socket.destroy();
  }
}

export interface TeamboxGatewayServerOptions {
  /** Systemd socket activation uses fd 3. A path is only for offline tests. */
  listen: { fd: number } | { path: string };
  runAction: TeamboxGatewayActionRunner;
}

export async function startTeamboxGatewayServer(
  options: TeamboxGatewayServerOptions,
): Promise<Server> {
  let activeActions = 0;
  const server = createServer((socket) => {
    // TCP peers have a remoteAddress. The production service additionally has
    // RestrictAddressFamilies=AF_UNIX and receives one systemd Unix socket.
    if (socket.remoteAddress) {
      socket.destroy();
      return;
    }
    socket.setTimeout(CONNECTION_TIMEOUT_MS, () => socket.destroy());
    const decoder = new TeamboxFrameDecoder();
    let accepted = false;

    socket.on("data", async (chunk: Buffer) => {
      if (accepted) {
        socket.destroy();
        return;
      }
      let values: unknown[];
      try {
        values = decoder.push(chunk);
      } catch (error) {
        endWith(
          socket,
          errorEnvelope(
            "unbound",
            "invalid_frame",
            error instanceof TeamboxFrameError
              ? "The request frame is invalid"
              : "The request could not be decoded",
          ),
        );
        return;
      }
      if (values.length === 0) return;
      if (values.length !== 1 || decoder.bufferedBytes !== 0) {
        endWith(
          socket,
          errorEnvelope(
            "unbound",
            "invalid_frame",
            "Exactly one complete action frame is required",
          ),
        );
        return;
      }
      accepted = true;
      socket.pause();
      if (activeActions >= MAX_CONCURRENT_ACTIONS) {
        endWith(
          socket,
          errorEnvelope(
            safeRequestId(values[0]),
            "codex_failed",
            "The live Codex action gateway is at capacity",
          ),
        );
        return;
      }
      activeActions += 1;
      try {
        endWith(
          socket,
          await handleTeamboxActionValue(values[0], options.runAction),
        );
      } finally {
        activeActions -= 1;
      }
    });
    socket.once("error", () => {
      // Client disconnects and invalid writes are intentionally non-fatal.
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listen, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (typeof address !== "string") {
        reject(new Error("TeamBox gateway must listen on an AF_UNIX socket"));
        server.close();
        return;
      }
      resolve();
    });
  });
  return server;
}
