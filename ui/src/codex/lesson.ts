/**
 * Starts a lesson render on the bridge.
 *
 * The bridge answers 202 with a job id and renders in the background; the
 * LessonVideo component polls `GET /api/lesson/:jobId` from there. Nothing in
 * the browser knows where the mp4 lands — the bridge mints that URL once the
 * render completes, so there is no path for the model to invent.
 */
export interface LessonJobStart {
  jobId: string;
  status?: string;
  stage?: string;
  title?: string;
}

export async function startLessonRender(input: {
  topic: string;
  episodeId: string;
  turnId: string;
  /** Learner profile slug; the bridge pitches the script to that profile. */
  slug?: string;
  signal?: AbortSignal;
}): Promise<LessonJobStart> {
  const res = await fetch("/api/lesson", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: input.topic,
      episodeId: input.episodeId,
      turnId: input.turnId,
      ...(input.slug ? { slug: input.slug } : {}),
    }),
    signal: input.signal,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ?? `bridge: HTTP ${res.status}`,
    );
  }

  const jobId = (body as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string" || !jobId) {
    throw new Error("bridge accepted the lesson but returned no job id");
  }
  return { ...(body as LessonJobStart), jobId };
}
