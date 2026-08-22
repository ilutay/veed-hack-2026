import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

describe("App smoke", () => {
  it("mounts the runtime, renders the seeded probe, and logs the emitted event", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);

    // Registry resolved the block Codex would have sent.
    expect(screen.getByTestId("probe-arena")).toBeDefined();
    expect(
      screen.getByText("Which layer first attends across sequence positions?"),
    ).toBeDefined();
    expect(screen.queryByTestId("gym-render-error")).toBeNull();

    // Interaction travels our Codex channel, not a Tambo thread.
    expect(screen.getByTestId("event-log").textContent).toBe("[]");
    fireEvent.click(screen.getByText("The first self-attention block"));

    const logged = JSON.parse(screen.getByTestId("event-log").textContent!);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      component: "ProbeArena",
      action: "probe.answered",
      episodeId: "ep-local",
      turnId: "turn-1",
      payload: { probeId: "probe-attn-01", choiceId: "b" },
    });

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
