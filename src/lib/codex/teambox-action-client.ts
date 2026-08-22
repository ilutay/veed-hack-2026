import "./server-only";

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import { LIVE_TEAMBOX_CLIENT_DEADLINE_MS } from "../contracts/live-deadlines";
import {
  TEAMBOX_ACTION_PROTOCOL_VERSION,
  TEAMBOX_ACTION_SOCKET_PATH,
  TeamboxFrameDecoder,
  encodeTeamboxFrame,
  parseTeamboxActionResponseEnvelope,
  type TeamboxActionRequestEnvelope,
  type TeamboxGatewayErrorCode,
} from "./teambox-protocol";
import { loadCodexActionSkills, toSkillReceipt } from "./skill-loader";
import type {
  CodexAction,
  CodexActionRequestMap,
  CodexActionRunResult,
} from "./types";

export interface TeamboxActionRunOptions {
  signal?: AbortSignal;
}

export class TeamboxActionGatewayError extends Error {
  constructor(
    readonly code: TeamboxGatewayErrorCode | "transport_error",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Server-only client for the single fixed TeamBox action socket.
 *
 * Callers provide a typed gym action, never a model prompt, cwd, model,
 * configuration, thread id, approval policy, or downstream socket path.
 */
export class TeamboxActionGatewayClient {
  async run<const A extends CodexAction>(
    actionRequest: CodexActionRequestMap[A] & { action: A },
    options: TeamboxActionRunOptions = {},
  ): Promise<CodexActionRunResult<A>> {
    const requestId = randomUUID();
    const envelope: TeamboxActionRequestEnvelope = {
      version: TEAMBOX_ACTION_PROTOCOL_VERSION,
      requestId,
      actionRequest,
    };
    const expectedSkillReceipts = (
      await loadCodexActionSkills(actionRequest.action)
    ).map(toSkillReceipt);
    const response = await exchangeOneFrame(
      encodeTeamboxFrame(envelope),
      options.signal,
    );
    const parsed = parseTeamboxActionResponseEnvelope(
      response,
      requestId,
      actionRequest.action,
      expectedSkillReceipts,
    );
    if (!parsed.ok) {
      throw new TeamboxActionGatewayError(
        parsed.error.code,
        parsed.error.message,
      );
    }
    return parsed.result as CodexActionRunResult<A>;
  }
}

function exchangeOneFrame(
  requestFrame: Buffer,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new TeamboxFrameDecoder();
    let settled = false;
    let receivedFrame = false;
    const socket = createConnection({ path: TEAMBOX_ACTION_SOCKET_PATH });

    const finish = (error?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () =>
      finish(
        new TeamboxActionGatewayError(
          "transport_error",
          "TeamBox action request was cancelled",
        ),
      );
    const deadline = setTimeout(
      () =>
        finish(
          new TeamboxActionGatewayError(
            "transport_error",
            "TeamBox action gateway deadline exceeded",
          ),
        ),
      LIVE_TEAMBOX_CLIENT_DEADLINE_MS,
    );

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    socket.once("connect", () => socket.write(requestFrame));
    socket.on("data", (chunk: Buffer) => {
      try {
        const values = decoder.push(chunk);
        if (values.length > 1 || (receivedFrame && values.length > 0)) {
          finish(
            new TeamboxActionGatewayError(
              "transport_error",
              "TeamBox gateway returned multiple frames",
            ),
          );
          return;
        }
        if (values.length === 1) {
          receivedFrame = true;
          finish(undefined, values[0]);
        }
      } catch {
        finish(
          new TeamboxActionGatewayError(
            "transport_error",
            "TeamBox gateway returned an invalid frame",
          ),
        );
      }
    });
    socket.once("error", () =>
      finish(
        new TeamboxActionGatewayError(
          "transport_error",
          "TeamBox action gateway is unavailable",
        ),
      ),
    );
    socket.once("end", () => {
      if (!receivedFrame) {
        finish(
          new TeamboxActionGatewayError(
            "transport_error",
            "TeamBox gateway closed without a response",
          ),
        );
      }
    });
  });
}

export function createTeamboxActionGatewayClient(): TeamboxActionGatewayClient {
  return new TeamboxActionGatewayClient();
}
