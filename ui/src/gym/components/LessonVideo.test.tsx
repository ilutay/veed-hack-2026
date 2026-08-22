import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { LessonVideo } from "./LessonVideo";
import { CodexActionProvider, type CodexGymEvent } from "../../codex/CodexActionProvider";
import type { LessonVideoProps } from "../schemas";

/**
 * Fake timers plus explicit advances rather than waitFor: RTL only auto-drives
 * fake timers when a global `jest` exists, which vitest does not provide.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonOnce(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Each entry answers one poll; the last entry answers every poll after it. */
function stubFetch(responses: Array<{ body: unknown; ok?: boolean }>) {
  const fetchMock = vi.fn((_input: RequestInfo | URL) => {
    const at = Math.min(fetchMock.mock.calls.length - 1, responses.length - 1);
    const next = responses[at];
    return jsonOnce(next.body, next.ok ?? true);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderVideo(props: Partial<LessonVideoProps>) {
  const onEvent = vi.fn<(e: CodexGymEvent) => void>();
  const view = render(
    <CodexActionProvider episodeId="ep-1" turnId="turn-1" onEvent={onEvent}>
      <LessonVideo {...props} />
    </CodexActionProvider>,
  );
  return { onEvent, ...view };
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("LessonVideo pending", () => {
  it("shows the render stage and elapsed time while the job runs", async () => {
    stubFetch([{ body: { status: "running", stage: "synthesising voiceover" } }]);
    renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance();
    expect(screen.getByTestId("lesson-video-pending").textContent).toContain(
      "synthesising voiceover",
    );
    expect(screen.queryByTestId("lesson-video-player")).toBeNull();

    await advance(4_000);
    expect(screen.getByTestId("lesson-video-pending").textContent).toContain("0:04");
  });

  it("polls the bridge job endpoint every two seconds", async () => {
    const fetchMock = stubFetch([{ body: { status: "running", stage: "slides" } }]);
    renderVideo({ jobId: "job 1", title: "Masking basics" });

    await advance();
    expect(fetchMock).toHaveBeenCalledWith("/api/lesson/job%201");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("LessonVideo completion", () => {
  it("swaps the pending state for a player pointed at the rendered video", async () => {
    stubFetch([
      { body: { status: "running", stage: "assembling slideshow" } },
      {
        body: {
          status: "completed",
          videoUrl: "/api/lesson/job-1/video.mp4",
          durationSeconds: 93,
        },
      },
    ]);
    renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance();
    expect(screen.getByTestId("lesson-video-pending")).toBeDefined();

    await advance(2_000);
    const player = screen.getByTestId("lesson-video-player");
    expect(player.tagName).toBe("VIDEO");
    expect(player.getAttribute("src")).toBe("/api/lesson/job-1/video.mp4");
    expect(player).toHaveProperty("controls", true);
    expect(screen.getByTestId("lesson-video-duration").textContent).toBe("1:33");
    expect(screen.queryByTestId("lesson-video-pending")).toBeNull();
  });

  it("stops polling once the job is terminal", async () => {
    const fetchMock = stubFetch([
      { body: { status: "completed", videoUrl: "/v.mp4", durationSeconds: 10 } },
    ]);
    renderVideo({ jobId: "job-1", title: "Done" });

    await advance(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emits lesson.ready exactly once", async () => {
    const { onEvent } = (() => {
      stubFetch([
        { body: { status: "running", stage: "slides" } },
        {
          body: { status: "completed", videoUrl: "/v.mp4", durationSeconds: 42 },
        },
      ]);
      return renderVideo({ jobId: "job-1", title: "Masking basics" });
    })();

    await advance(2_000);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({
      component: "LessonVideo",
      episodeId: "ep-1",
      turnId: "turn-1",
      action: "lesson.ready",
      payload: { jobId: "job-1", videoUrl: "/v.mp4", seconds: 42 },
    });

    await advance(30_000);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

describe("LessonVideo failure", () => {
  it("renders the bridge error with a retry that emits through Codex", async () => {
    stubFetch([{ body: { status: "failed", error: "ffmpeg exited with 1" } }]);
    const { onEvent } = renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance();
    expect(screen.getByTestId("lesson-video-error").textContent).toBe(
      "ffmpeg exited with 1",
    );
    expect(screen.queryByTestId("lesson-video-player")).toBeNull();

    fireEvent.click(screen.getByText("Retry render"));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({
      component: "LessonVideo",
      episodeId: "ep-1",
      turnId: "turn-1",
      action: "lesson.retry",
      payload: { jobId: "job-1" },
    });
  });

  it("reports a non-ok bridge response as a failure", async () => {
    stubFetch([{ body: { error: "no such job" }, ok: false }]);
    renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance();
    expect(screen.getByTestId("lesson-video-error").textContent).toBe("no such job");
  });

  it("gives up after fifteen minutes with a clear message", async () => {
    stubFetch([{ body: { status: "running", stage: "rendering" } }]);
    renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance(14 * 60 * 1_000);
    expect(screen.getByTestId("lesson-video-pending")).toBeDefined();

    await advance(60 * 1_000);
    expect(screen.getByTestId("lesson-video-error").textContent).toContain(
      "15 minutes",
    );
  });
});

describe("LessonVideo bad props", () => {
  it("renders a pending state and never fetches without a job id", async () => {
    const fetchMock = stubFetch([{ body: { status: "running" } }]);
    renderVideo({});

    await advance(10_000);
    expect(screen.getByTestId("lesson-video-pending")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tolerates schema-invalid props, which the renderer passes through raw", async () => {
    stubFetch([{ body: { status: "running", stage: "slides" } }]);
    const invalid = { jobId: 7, title: null } as unknown as Partial<LessonVideoProps>;

    expect(() => renderVideo(invalid)).not.toThrow();
    await advance();
    expect(screen.getByTestId("lesson-video-pending")).toBeDefined();
  });

  it("survives a job payload with no video url and no duration", async () => {
    stubFetch([{ body: { status: "completed" } }]);
    const { onEvent } = renderVideo({ jobId: "job-1", title: "Masking basics" });

    await advance();
    expect(screen.getByTestId("lesson-video-error")).toBeDefined();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
