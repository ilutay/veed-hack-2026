import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { App } from "./App";

const PROBE = {
  componentId: "cmp-1",
  componentName: "ProbeArena",
  episodeId: "ep-local",
  turnId: "turn-1",
  props: {
    probeId: "probe-attn-01",
    skill: "attention-routing",
    prompt: "Which layer first attends across sequence positions?",
    choices: [
      { id: "a", label: "The embedding layer" },
      { id: "b", label: "The first self-attention block" },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PROBE), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the block Codex returns and feeds interactions back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("probe-arena")).toBeDefined());
    expect(screen.queryByTestId("gym-render-error")).toBeNull();
    expect(screen.queryByTestId("bridge-error")).toBeNull();

    fireEvent.click(screen.getByText("The first self-attention block"));

    const logged = JSON.parse(screen.getByTestId("event-log").textContent!);
    expect(logged[0]).toMatchObject({
      component: "ProbeArena",
      action: "probe.answered",
      payload: { probeId: "probe-attn-01", choiceId: "b" },
    });

    // The interaction triggers the next Codex turn.
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2),
    );
    const secondBody = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(secondBody.state).toContain("probe.answered");
    expect(secondBody.turnId).toBe("turn-2");

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("surfaces a bridge failure instead of rendering an empty gym", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "codex exec exited 1" }), { status: 502 }),
      ),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("bridge-error")).toBeDefined());
    expect(screen.getByTestId("bridge-error").textContent).toContain("codex exec exited 1");
  });
});
