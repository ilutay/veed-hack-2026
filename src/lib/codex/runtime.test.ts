import { describe, expect, it } from "vitest";

import { sha256Hex } from "../pioneer";
import { loadCodexActionSkills } from "./skill-loader";
import {
  prepareStimulusReceipt,
  runCodexAction,
  type CodexClientLike,
  type InterpretGoalRequest,
} from ".";

const goalRequest: InterpretGoalRequest = {
  action: "interpret_goal",
  sessionId: "session-1",
  goalInstanceId: "goal-1",
  rawPrompt: "I want my short-form product videos to feel intentional.",
  sessionTimeboxSeconds: 90,
};

describe("Codex skill runtime", () => {
  it("loads a dedicated stage skill for every next-decision turn", async () => {
    const skills = await loadCodexActionSkills("decide_next");

    expect(skills.map((skill) => skill.name)).toEqual([
      "pioneer-gym",
      "pioneer-gym-next-decision",
    ]);
  });

  it("loads exact repository skills and runs without credentials in offline mode", async () => {
    const result = await runCodexAction(goalRequest, { mode: "offline" });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.fallbackReason).toBe("offline_requested");
    expect(result.output.goalDefinitionId).toBe(
      "visual-hierarchy.short-form-v1",
    );
    expect(result.skillReceipts.map((receipt) => receipt.name)).toEqual([
      "pioneer-gym",
      "pioneer-gym-goal-intake",
    ]);
    expect(result.skillReceipts.every((receipt) => receipt.sha256.length === 64)).toBe(
      true,
    );
  });

  it("enforces read-only/no-network SDK options and structured output", async () => {
    const offline = await runCodexAction(goalRequest, { mode: "offline" });
    let threadOptions: unknown;
    let sawSkillText = false;
    const client: CodexClientLike = {
      startThread(options) {
        threadOptions = options;
        return {
          async run(prompt, turnOptions) {
            sawSkillText =
              prompt.includes("# Pioneer Gym Orchestrator") &&
              prompt.includes("# Pioneer Gym Goal Intake");
            expect(turnOptions.outputSchema).toMatchObject({ type: "object" });
            return {
              finalResponse: JSON.stringify(offline.output),
              items: [{ type: "agent_message" }],
              usage: {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 3,
              },
            };
          },
        };
      },
    };

    const result = await runCodexAction(goalRequest, { mode: "sdk", client });

    expect(threadOptions).toMatchObject({
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
    });
    expect(sawSkillText).toBe(true);
    expect(result.source).toBe("codex_sdk");
    expect(result.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
    });
  });

  it("rejects a turn that emits any tool item and uses the labeled fallback", async () => {
    const client: CodexClientLike = {
      startThread() {
        return {
          async run() {
            return {
              finalResponse: "{}",
              items: [{ type: "command_execution" }],
              usage: null,
            };
          },
        };
      },
    };

    const result = await runCodexAction(goalRequest, { mode: "sdk", client });
    expect(result.source).toBe("deterministic_fallback");
    expect(result.fallbackReason).toBe("tool_policy_violation");
  });
});

describe("fal-derived stimulus receipt action", () => {
  it("reconstructs exact fal text spans and never returns the raw response", async () => {
    const rawText = "Intentional title";
    const rawTextSha256 = sha256Hex(rawText);
    const sourceAssetSha256 = "a".repeat(64);

    const result = await prepareStimulusReceipt({
      normalizerVersion: "codex-fal-text-v1",
      rawReceipts: [
        {
          providerRequestId: "fal-request-1",
          providerModelId: "perceptron/isaac-01",
          rawText,
          expectedRawTextSha256: rawTextSha256,
          sourceAssetSha256,
          receivedAt: "2026-08-22T12:00:00.000Z",
        },
      ],
      fields: [
        {
          path: "observations[0].visibleCopy[0].text",
          value: "Intentional title",
          sourceSpans: [
            {
              providerRequestId: "fal-request-1",
              startUtf8Byte: 0,
              endUtf8Byte: Buffer.byteLength(rawText, "utf8"),
              transform: "identity",
            },
          ],
        },
      ],
    });

    expect(result.evidenceBoundary).toBe("fal_text_only_not_pixel_verification");
    expect(result.fields[0]?.sourceRefs[0]?.exactSourceText).toBe(rawText);
    expect(result.skillReceipt.name).toBe("pioneer-gym-stimulus-receipt");
    expect(JSON.stringify(result)).not.toContain('"rawText"');
  });
});
