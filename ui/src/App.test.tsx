import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { App } from "./App";

const JOB_ID = "6f0a2c1e-0000-4000-8000-000000000001";

const RUNNING_JOB = { jobId: JOB_ID, status: "running", stage: "media" };
const COMPLETED_JOB = {
  jobId: JOB_ID,
  status: "completed",
  stage: "completed",
  videoUrl: `/media/lessons/${JOB_ID}/03-video/lesson-video.mp4`,
  durationSeconds: 35.69,
  title: "Why Is the Sky Blue?",
};

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

/**
 * One fake bridge for the whole app: it has to answer three different routes,
 * because the lesson flow is a POST plus the block's own polling GETs.
 */
function stubBridge(overrides: {
  start?: () => Response;
  job?: () => Response;
  turn?: () => Response;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/lesson" && init?.method === "POST") {
      return overrides.start?.() ?? new Response(JSON.stringify(RUNNING_JOB), { status: 202 });
    }
    if (url.startsWith("/api/lesson/")) {
      return overrides.job?.() ?? new Response(JSON.stringify(RUNNING_JOB), { status: 200 });
    }
    if (url === "/api/turn") {
      return overrides.turn?.() ?? new Response(JSON.stringify(PROBE), { status: 200 });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ask(text: string) {
  fireEvent.change(screen.getByTestId("thread-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("thread-submit"));
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const callsTo = (mock: ReturnType<typeof vi.fn>, prefix: string) =>
  mock.mock.calls.filter((c) => String(c[0]).startsWith(prefix));

// Returning the mock would make vitest treat it as a teardown hook.
beforeEach(() => {
  stubBridge();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("lesson flow", () => {
  it("starts a render for the submitted topic and shows the video block", async () => {
    const fetchMock = stubBridge();
    render(<App />);

    // Nothing is requested until the user asks for something.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("thread-empty")).toBeDefined();

    ask("Why is the sky blue?");

    await waitFor(() => expect(screen.getByTestId("lesson-video")).toBeDefined());
    expect(screen.queryByTestId("gym-render-error")).toBeNull();
    expect(screen.queryByTestId("bridge-error")).toBeNull();

    const started = callsTo(fetchMock, "/api/lesson")[0];
    expect((started[1] as RequestInit).method).toBe("POST");
    expect(bodyOf(started)).toMatchObject({ topic: "Why is the sky blue?", episodeId: "ep-local" });

    // The block polls the job the bridge named, not a URL anyone invented.
    await waitFor(() => expect(callsTo(fetchMock, `/api/lesson/${JOB_ID}`).length).toBeGreaterThan(0));
    expect(screen.getByTestId("lesson-video").dataset.jobId).toBe(JOB_ID);
    expect(screen.getByTestId("lesson-video-pending").textContent).toContain("media");
  });

  it("plays the video and records the ready event once the job completes", async () => {
    const fetchMock = stubBridge({ job: () => new Response(JSON.stringify(COMPLETED_JOB), { status: 200 }) });
    render(<App />);
    ask("Why is the sky blue?");

    await waitFor(() => expect(screen.getByTestId("lesson-video-player")).toBeDefined());
    expect(screen.getByTestId("lesson-video-player").getAttribute("src")).toBe(COMPLETED_JOB.videoUrl);

    await screen.findByText(/lesson video is ready/i);
    const logged = JSON.parse(screen.getByTestId("event-log").textContent!);
    expect(logged[0]).toMatchObject({
      component: "LessonVideo",
      action: "lesson.ready",
      payload: { jobId: JOB_ID, videoUrl: COMPLETED_JOB.videoUrl },
    });
    // The block emits once, and a finished video is not a Codex turn.
    expect(logged).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/turn")).toHaveLength(0);
  });

  it("restarts the render when the block asks for a retry", async () => {
    const fetchMock = stubBridge({
      job: () => new Response(JSON.stringify({ jobId: JOB_ID, status: "failed", error: "espeak-ng exited 1" }), { status: 200 }),
    });
    render(<App />);
    ask("Why is the sky blue?");

    await waitFor(() => expect(screen.getByTestId("lesson-video-error")).toBeDefined());
    fireEvent.click(screen.getByText("Retry render"));

    await waitFor(() => expect(callsTo(fetchMock, "/api/lesson").filter((c) => String(c[0]) === "/api/lesson")).toHaveLength(2));
    expect(bodyOf(callsTo(fetchMock, "/api/lesson").filter((c) => String(c[0]) === "/api/lesson")[1])).toMatchObject({
      topic: "Why is the sky blue?",
    });
  });

  it("gives each block a fresh id the model never sees", async () => {
    render(<App />);
    ask("Why is the sky blue?");
    await waitFor(() => expect(screen.getByTestId("lesson-video")).toBeDefined());
    ask("How do rainbows form?");

    await waitFor(() => expect(screen.getAllByTestId("lesson-video")).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("thread-message").filter(
      (node) => node.dataset.role === "assistant",
    );
    expect(first).not.toBe(second);
  });

  it("surfaces a bridge failure instead of a silent dead chat", async () => {
    stubBridge({
      start: () => new Response(JSON.stringify({ error: "render queue is full" }), { status: 429 }),
    });
    render(<App />);
    ask("Why is the sky blue?");

    await waitFor(() => expect(screen.getByTestId("bridge-error")).toBeDefined());
    expect(screen.getByTestId("bridge-error").textContent).toContain("render queue is full");
    expect(screen.queryByTestId("lesson-video")).toBeNull();
  });
});

describe("gym flow", () => {
  it("keeps /api/turn reachable behind /gym and feeds interactions back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubBridge();
    render(<App />);

    ask("/gym Brand new learner, nothing measured yet.");

    await waitFor(() => expect(screen.getByTestId("probe-arena")).toBeDefined());
    expect(screen.queryByTestId("gym-render-error")).toBeNull();
    expect(bodyOf(callsTo(fetchMock, "/api/turn")[0])).toMatchObject({
      state: "Brand new learner, nothing measured yet.",
      turnId: "turn-1",
    });

    fireEvent.click(screen.getByText("The first self-attention block"));

    const logged = JSON.parse(screen.getByTestId("event-log").textContent!);
    expect(logged[0]).toMatchObject({
      component: "ProbeArena",
      action: "probe.answered",
      payload: { probeId: "probe-attn-01", choiceId: "b" },
    });

    await waitFor(() => expect(callsTo(fetchMock, "/api/turn")).toHaveLength(2));
    const second = bodyOf(callsTo(fetchMock, "/api/turn")[1]);
    expect(second.state).toContain("probe.answered");
    expect(second.turnId).toBe("turn-2");

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
