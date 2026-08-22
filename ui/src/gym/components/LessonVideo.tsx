import { useEffect, useRef, useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import type { LessonVideoProps } from "../schemas";

const POLL_MS = 2_000;
const GIVE_UP_MS = 15 * 60 * 1_000;

/** What GET /api/lesson/:jobId reports. Every field is optional on purpose. */
interface LessonJob {
  status?: string;
  stage?: string;
  videoUrl?: string;
  seconds?: number;
  error?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * The bridge is authored separately, so read its payload defensively and
 * accept either duration key rather than failing the whole render on a name.
 */
function readJob(body: unknown): LessonJob {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    status: asString(raw.status),
    stage: asString(raw.stage),
    videoUrl: asString(raw.videoUrl),
    seconds: asSeconds(raw.durationSeconds) ?? asSeconds(raw.seconds),
    error: asString(raw.error),
  };
}

function formatSeconds(total: number): string {
  const whole = Math.floor(total);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Renders a lesson video that is still being assembled offline.
 *
 * Codex only ever names the job id — the URL is minted by the bridge once the
 * render lands, so there is nothing here for the model to hallucinate.
 */
export function LessonVideo({ jobId, title }: Partial<LessonVideoProps>) {
  const { emit, episodeId, turnId } = useCodexAction();
  const id = asString(jobId);

  const [job, setJob] = useState<LessonJob | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [retried, setRetried] = useState(false);
  const emitted = useRef(false);

  const status = timedOut ? "failed" : (job?.status ?? "pending");
  const settled = status === "completed" || status === "failed";
  const videoUrl = status === "completed" ? job?.videoUrl : undefined;

  useEffect(() => {
    if (!id) return;

    const url = `/api/lesson/${encodeURIComponent(id)}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch(url);
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok) {
          setJob({
            status: "failed",
            error: readJob(body).error ?? `bridge: HTTP ${res.status}`,
          });
          return;
        }

        const next = readJob(body);
        setJob(next);
        if (next.status === "completed" || next.status === "failed") return;
      } catch {
        // A dropped poll is not a dead render; keep trying until the deadline.
        if (cancelled) return;
      }

      if (Date.now() - startedAt >= GIVE_UP_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!id || settled) return;
    const startedAt = Date.now();
    const ticker = setInterval(
      () => setElapsed((Date.now() - startedAt) / 1_000),
      1_000,
    );
    return () => clearInterval(ticker);
  }, [id, settled]);

  useEffect(() => {
    if (!id || !videoUrl || emitted.current) return;
    emitted.current = true;
    emit({
      component: "LessonVideo",
      episodeId,
      turnId,
      action: "lesson.ready",
      payload: { jobId: id, videoUrl, seconds: job?.seconds ?? null },
    });
  }, [id, videoUrl, job?.seconds, emit, episodeId, turnId]);

  const heading = asString(title) ?? "Lesson";

  if (!id) {
    return (
      <section data-testid="lesson-video" data-status="pending">
        <p data-testid="lesson-video-pending">Waiting for a lesson job…</p>
      </section>
    );
  }

  if (videoUrl) {
    return (
      <section data-testid="lesson-video" data-job-id={id} data-status="completed">
        <h2>{heading}</h2>
        <video data-testid="lesson-video-player" controls playsInline src={videoUrl} />
        <p data-testid="lesson-video-duration">
          {job?.seconds === undefined ? "duration unknown" : formatSeconds(job.seconds)}
        </p>
      </section>
    );
  }

  if (status === "failed" || status === "completed") {
    const reason = timedOut
      ? "The lesson render did not finish within 15 minutes."
      : (job?.error ??
        (status === "completed"
          ? "The render finished without a video."
          : "The lesson render failed."));

    return (
      <section data-testid="lesson-video" data-job-id={id} data-status="failed">
        <h2>{heading}</h2>
        <p data-testid="lesson-video-error">{reason}</p>
        <button
          type="button"
          disabled={retried}
          onClick={() => {
            // Each retry queues a full render: a codex scripting turn plus
            // media plus assembly. Without this the button is click-repeatable
            // and one dead block can fill the bridge's render queue.
            setRetried(true);
            emit({
              component: "LessonVideo",
              episodeId,
              turnId,
              action: "lesson.retry",
              payload: { jobId: id },
            });
          }}
        >
          {retried ? "Retrying…" : "Retry render"}
        </button>
      </section>
    );
  }

  return (
    <section data-testid="lesson-video" data-job-id={id} data-status="running">
      <h2>{heading}</h2>
      <p data-testid="lesson-video-pending">
        {job?.stage ?? "Queued"} — {formatSeconds(elapsed)} elapsed
      </p>
    </section>
  );
}
