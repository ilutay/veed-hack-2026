import { useCallback, useRef, useState } from "react";
import { GymRuntime } from "./gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./gym/GymBlock";
import type { CodexGymEvent } from "./codex/CodexActionProvider";
import { requestNextBlock, describeEvent } from "./codex/client";
import { startLessonRender } from "./codex/lesson";
import { MessageThreadFull } from "./thread/MessageThreadFull";
import type { ThreadMessage } from "./thread/types";

const EPISODE_ID = "ep-local";

/** Escape hatch to the gym loop, so /api/turn stays reachable from the chat. */
const GYM_PREFIX = "/gym";

/**
 * The product: a chat where a topic becomes a rendered lesson video.
 *
 * A submitted topic starts a bridge render job and the reply carries a
 * LessonVideo block, which polls the job until the mp4 is playable. Blocks go
 * through GymBlock, so they resolve against the Tambo registry exactly as a
 * Codex-authored block does, and their interactions come back through
 * CodexActionProvider — never a Tambo thread.
 *
 * The original gym loop is still here behind a `/gym` prefix: that path asks
 * Codex (via /api/turn) which exercise to show, and any interaction with the
 * resulting surface asks it for the next one. Lesson events stay local because
 * a video finishing is not a signal Codex needs to spend a turn on.
 */
export function App() {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [events, setEvents] = useState<CodexGymEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const turn = useRef(0);
  /** jobId -> the topic that produced it, so a retry can restart the render. */
  const topics = useRef(new Map<string, string>());

  const nextTurnId = () => `turn-${(turn.current += 1)}`;

  const append = useCallback((message: ThreadMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const startLesson = useCallback(
    async (topic: string) => {
      setBusy(true);
      setError(null);
      const turnId = nextTurnId();
      try {
        const job = await startLessonRender({ topic, episodeId: EPISODE_ID, turnId });
        topics.current.set(job.jobId, topic);
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Rendering a lesson on "${topic}". It plays here as soon as the video lands.`,
          block: {
            // Ids are ours. The model never names its own render target, and
            // the job id is the bridge's, so nothing here is model-authored.
            componentId: crypto.randomUUID(),
            componentName: "LessonVideo",
            props: { jobId: job.jobId, title: job.title ?? topic },
            episodeId: EPISODE_ID,
            turnId,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const advanceGym = useCallback(
    async (state: string) => {
      setBusy(true);
      setError(null);
      const turnId = nextTurnId();
      try {
        const command = await requestNextBlock({
          episodeId: EPISODE_ID,
          turnId,
          state,
        });
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          block: { ...command, episodeId: EPISODE_ID, turnId },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const onSubmit = useCallback(
    (text: string) => {
      append({ id: crypto.randomUUID(), role: "user", text });
      // Require a delimiter: a bare startsWith turns "/gymnastics for beginners"
      // into a gym turn on the mangled state "nastics for beginners".
      if (text === GYM_PREFIX || text.startsWith(`${GYM_PREFIX} `)) {
        const state = text.slice(GYM_PREFIX.length).trim();
        void advanceGym(state || "New learner, nothing measured yet.");
        return;
      }
      void startLesson(text);
    },
    [append, advanceGym, startLesson],
  );

  const onEvent = useCallback(
    (event: CodexGymEvent) => {
      setEvents((prev) => [...prev, event]);

      if (event.action === "lesson.ready") {
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          text: "The lesson video is ready. Ask for another topic whenever you like.",
        });
        return;
      }

      if (event.action === "lesson.retry") {
        const jobId = event.payload.jobId;
        const topic = typeof jobId === "string" ? topics.current.get(jobId) : undefined;
        if (!topic) {
          setError("That render cannot be retried — ask for the topic again.");
          return;
        }
        append({ id: crypto.randomUUID(), role: "user", text: topic });
        void startLesson(topic);
        return;
      }

      void advanceGym(describeEvent(event));
    },
    [append, advanceGym, startLesson],
  );

  const renderBlock = useCallback(
    (block: CodexComponentCommand) => (
      <GymBlock
        key={block.componentId}
        command={block}
        onEvent={onEvent}
        pending={<p>Preparing…</p>}
      />
    ),
    [onEvent],
  );

  return (
    <GymRuntime>
      <main
        style={{
          fontFamily: "system-ui",
          maxWidth: 760,
          margin: "0 auto",
          padding: "1.5rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          height: "100vh",
          boxSizing: "border-box",
        }}
      >
        <header>
          <h1 style={{ margin: 0 }}>Lesson studio</h1>
          <p data-testid="status" style={{ margin: "0.25rem 0 0", opacity: 0.7 }}>
            {busy ? "Working…" : `turn ${turn.current}`}
          </p>
        </header>

        {error && (
          <p data-testid="bridge-error" role="alert" style={{ color: "crimson" }}>
            Bridge error: {error}
          </p>
        )}

        <div style={{ flex: 1, minHeight: 0, display: "grid" }}>
          <MessageThreadFull
            messages={messages}
            onSubmit={onSubmit}
            busy={busy}
            renderBlock={renderBlock}
          />
        </div>

        <details>
          <summary>Emitted to Codex</summary>
          <pre data-testid="event-log">{JSON.stringify(events, null, 2)}</pre>
        </details>
      </main>
    </GymRuntime>
  );
}
