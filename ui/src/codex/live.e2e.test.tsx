import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { GymRuntime } from "../gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "../gym/GymBlock";
import { gymComponents } from "../gym/registry";
import type { ZodType } from "zod";

/**
 * End-to-end against a live codex-cli turn through the bridge.
 *
 * Opt-in: costs tokens and needs the bridge running. Enable with
 *   CODEX_LIVE=1 npm test
 */
const BRIDGE = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787";
const live = process.env.CODEX_LIVE === "1" ? describe : describe.skip;

afterEach(cleanup);

live("codex-cli -> registry -> DOM", () => {
  it("renders a component Codex actually chose", async () => {
    const res = await fetch(`${BRIDGE}/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodeId: "ep-e2e",
        turnId: "turn-1",
        state:
          "Brand new learner. Nothing measured yet. Target skill: attention-routing in transformers.",
      }),
    });
    expect(res.ok).toBe(true);
    const command = (await res.json()) as CodexComponentCommand;

    // Codex stayed inside the registry allowlist.
    const registered = gymComponents.find((c) => c.name === command.componentName);
    expect(registered, `unregistered component: ${command.componentName}`).toBeDefined();

    // Its props satisfy the same zod schema the renderer validates against.
    const parsed = (registered!.propsSchema as ZodType).safeParse(command.props);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    render(
      <GymRuntime>
        <GymBlock command={command} onEvent={() => {}} />
      </GymRuntime>,
    );

    await waitFor(() =>
      expect(screen.queryByTestId("gym-render-error")).toBeNull(),
    );
    // The live surface rendered something real, not a pending shell.
    const el = await screen.findByTestId(
      {
        ProbeArena: "probe-arena",
        CreditAssignmentReplay: "credit-assignment-replay",
        TargetedRetryGym: "targeted-retry-gym",
        LayerOrderTransferGym: "layer-order-transfer-gym",
      }[command.componentName]!,
    );
    expect(el).toBeDefined();
    console.log(`live: rendered ${command.componentName}`);
  }, 300_000);
});
