import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GymRuntime } from "./GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./GymBlock";
import type { CodexGymEvent } from "../codex/CodexActionProvider";
import { gymComponents } from "./registry";

afterEach(cleanup);

const probeCommand: CodexComponentCommand = {
  componentId: "cmp-1",
  componentName: "ProbeArena",
  episodeId: "ep-1",
  turnId: "turn-1",
  props: {
    probeId: "probe-1",
    skill: "attention-routing",
    prompt: "Which layer attends first?",
    choices: [
      { id: "a", label: "Embedding" },
      { id: "b", label: "Self-attention" },
    ],
  },
};

function renderBlock(
  command: CodexComponentCommand,
  onEvent: (e: CodexGymEvent) => void = () => {},
) {
  return render(
    <GymRuntime>
      <GymBlock command={command} onEvent={onEvent} />
    </GymRuntime>,
  );
}

/**
 * Sample props per registered name. Keyed by name rather than listed, so a
 * component added to the registry without a sample fails the coverage check
 * below instead of quietly going untested.
 */
const sampleProps: Record<string, Record<string, unknown>> = {
  ProbeArena: probeCommand.props,
  CreditAssignmentReplay: {
    probeId: "p1",
    responseText: "abcdef",
    spans: [],
    score: 0.5,
  },
  TargetedRetryGym: { probeId: "p1", skill: "s", hint: "try again", attemptsRemaining: 2 },
  LayerOrderTransferGym: {
    taskId: "t1",
    instruction: "Order these",
    layers: [
      { id: "l1", label: "One" },
      { id: "l2", label: "Two" },
    ],
  },
  LessonVideo: { jobId: "job-1", title: "Masking basics" },
};

describe("registry wiring", () => {
  it("registers every gym component with a name, description and schema", () => {
    expect(gymComponents.map((c) => c.name)).toEqual(Object.keys(sampleProps));
    for (const c of gymComponents) {
      expect(c.name).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.component).toBeTypeOf("function");
      expect(c.propsSchema).toBeDefined();
    }
  });

  it("resolves a registered component block and renders it", () => {
    renderBlock(probeCommand);
    expect(screen.getByTestId("probe-arena")).toHaveProperty(
      "dataset.probeId",
      "probe-1",
    );
    expect(screen.getByText("Which layer attends first?")).toBeDefined();
  });

  it("renders the fallback for an unregistered component name", () => {
    renderBlock({ ...probeCommand, componentName: "NotARealGym" });
    expect(screen.getByTestId("gym-render-error")).toBeDefined();
  });

  it("renders every registered component without throwing", () => {
    // LessonVideo polls the bridge on mount; keep the poll answered and local.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "running" }), { status: 200 })),
    );

    for (const { name } of gymComponents) {
      const props = sampleProps[name];
      expect(props, `no sample props for ${name}`).toBeDefined();
      const { unmount } = renderBlock({
        ...probeCommand,
        componentName: name,
        props,
      });
      expect(screen.queryByTestId("gym-render-error")).toBeNull();
      unmount();
    }

    vi.unstubAllGlobals();
  });
});

describe("props validation", () => {
  it("passes schema-valid props through to the component", () => {
    renderBlock(probeCommand);
    expect(screen.getByTestId("probe-skill").textContent).toBe(
      "attention-routing",
    );
  });

  it("warns on schema-invalid props but still renders (documented behaviour)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderBlock({
      ...probeCommand,
      // `choices` needs >= 2 entries; `skill` is required.
      props: { probeId: "probe-1", prompt: "Q?", choices: [{ id: "a", label: "A" }] },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Props validation failed for component ProbeArena"),
      expect.anything(),
    );
    // Not the fallback: ComponentRenderer renders raw props on validation failure.
    expect(screen.queryByTestId("gym-render-error")).toBeNull();
    expect(screen.getByTestId("probe-arena")).toBeDefined();
    warn.mockRestore();
  });

  it("tolerates partial props mid-stream instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderBlock({ ...probeCommand, props: { probeId: "probe-1" } });
    expect(screen.getByTestId("probe-arena-pending")).toBeDefined();
    warn.mockRestore();
  });
});

describe("codex action channel", () => {
  it("emits a structured event to Codex, not to a Tambo thread", () => {
    const onEvent = vi.fn();
    renderBlock(probeCommand, onEvent);

    fireEvent.click(screen.getByText("Self-attention"));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({
      component: "ProbeArena",
      episodeId: "ep-1",
      turnId: "turn-1",
      action: "probe.answered",
      payload: { probeId: "probe-1", choiceId: "b", skill: "attention-routing" },
    });
  });

  it("carries the episode and turn ids from the command", () => {
    const onEvent = vi.fn();
    renderBlock(
      { ...probeCommand, episodeId: "ep-9", turnId: "turn-42" },
      onEvent,
    );
    fireEvent.click(screen.getByText("Embedding"));
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      episodeId: "ep-9",
      turnId: "turn-42",
    });
  });
});

describe("no agent stack", () => {
  it("renders with no Tambo API key and no network access", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("network call attempted");
      });

    renderBlock(probeCommand);

    expect(screen.getByTestId("probe-arena")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.TAMBO_API_KEY).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe("registry hydration", () => {
  it("does not flash the fallback before the registry is populated", () => {
    // TamboRegistryProvider registers in an effect, so an ungated
    // ComponentRenderer resolves against an empty registry on first paint.
    // GymBlock defers one tick; nothing should be logged as unresolvable.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBlock(probeCommand);

    const notFound = error.mock.calls.filter((c) =>
      String(c[0]).includes("Failed to render component"),
    );
    expect(notFound).toHaveLength(0);
    expect(screen.getByTestId("probe-arena")).toBeDefined();
    error.mockRestore();
  });

  it("still shows the fallback when Codex names an unregistered component", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBlock({ ...probeCommand, componentName: "NotARealGym" });
    expect(screen.getByTestId("gym-render-error")).toBeDefined();
    error.mockRestore();
  });
});
