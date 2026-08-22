import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { GymRuntime } from "./GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./GymBlock";
import { gymComponents } from "./registry";

afterEach(cleanup);

const base: CodexComponentCommand = {
  componentId: "cmp-1",
  componentName: "ProbeArena",
  episodeId: "ep-1",
  turnId: "turn-1",
  props: {},
};

function renderBlock(command: CodexComponentCommand) {
  return render(
    <GymRuntime>
      <GymBlock command={command} onEvent={() => {}} />
    </GymRuntime>,
  );
}

/**
 * Schema-invalid props reach component code unchanged - the renderer only warns.
 * These are the exact shapes that used to throw and unmount the whole React root.
 */
describe("type-confused props", () => {
  // expected testid proves the COMPONENT guarded itself. Asserting merely that
  // the tree survived would also pass via the error boundary, so this test would
  // not notice the guard being reverted.
  const hostile: Array<[string, Record<string, unknown>, string]> = [
    ["ProbeArena", { probeId: "p", prompt: "Q?", skill: "s", choices: "nope" }, "probe-arena-pending"],
    ["ProbeArena", { probeId: "p", prompt: "Q?", skill: "s", choices: 7 }, "probe-arena-pending"],
    ["LayerOrderTransferGym", { taskId: "t", instruction: "i", layers: "nope" }, "transfer-pending"],
    ["CreditAssignmentReplay", { probeId: "p", responseText: "abc", spans: "nope", score: 0.5 }, "credit-assignment-replay"],
    ["TargetedRetryGym", { probeId: "p", skill: "s", hint: "h", attemptsRemaining: "two" }, "targeted-retry-gym"],
  ];

  it.each(hostile)("%s guards %j itself", (name, props, expected) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBlock({ ...base, componentName: name, props });

    expect(screen.getByTestId(expected)).toBeDefined();
    expect(screen.queryByTestId("gym-render-error")).toBeNull();
    warn.mockRestore();
    error.mockRestore();
  });

  it("every registered component tolerates empty props", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "running" }))));

    for (const c of gymComponents) {
      const { unmount } = renderBlock({ ...base, componentName: c.name, props: {} });
      expect(document.body.textContent).not.toBe("");
      unmount();
    }
    vi.unstubAllGlobals();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("error boundary", () => {
  it("contains a throwing component instead of blanking the tree", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <GymRuntime>
        <div data-testid="sibling">still here</div>
        <GymBlock
          command={{ ...base, componentName: "ProbeArena", props: { probeId: "p", prompt: "Q?", skill: "s", choices: "nope" } }}
          onEvent={() => {}}
        />
      </GymRuntime>,
    );
    // The sibling proves the root did not unmount.
    expect(screen.getByTestId("sibling")).toBeDefined();
    error.mockRestore();
  });
});

describe("LessonVideo polling lifecycle", () => {
  it("stops polling after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jobId: "j1", status: "running", stage: "media" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderBlock({
      ...base,
      componentName: "LessonVideo",
      props: { jobId: "j1", title: "T" },
    });

    await vi.advanceTimersByTimeAsync(5000);
    const before = fetchMock.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    unmount();
    await vi.advanceTimersByTimeAsync(30000);

    expect(fetchMock.mock.calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("emits lesson.ready once even when onEvent identity changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jobId: "j1",
              status: "completed",
              videoUrl: "/media/lessons/j1/03-video/lesson-video.mp4",
              durationSeconds: 17,
            }),
          ),
      ),
    );
    const events: unknown[] = [];

    const { rerender } = render(
      <GymRuntime>
        <GymBlock
          command={{ ...base, componentName: "LessonVideo", props: { jobId: "j1", title: "T" } }}
          onEvent={(e) => events.push(e)}
        />
      </GymRuntime>,
    );
    await waitFor(() => expect(events.length).toBe(1));

    // A fresh callback each render is exactly what re-fires an unguarded effect.
    for (let i = 0; i < 4; i++) {
      rerender(
        <GymRuntime>
          <GymBlock
            command={{ ...base, componentName: "LessonVideo", props: { jobId: "j1", title: "T" } }}
            onEvent={(e) => events.push(e)}
          />
        </GymRuntime>,
      );
    }
    await waitFor(() => expect(events.length).toBe(1));
    vi.unstubAllGlobals();
  });
});
