import { useCallback, useEffect, useRef, useState } from "react";
import { GymRuntime } from "./gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./gym/GymBlock";
import type { CodexGymEvent } from "./codex/CodexActionProvider";
import { startLessonRender } from "./codex/lesson";
import { NovelGymPanel } from "./novel-backend/NovelGymPanel";
import { MessageThreadFull } from "./thread/MessageThreadFull";
import type { ThreadMessage } from "./thread/types";
import { ProfileProvider, useProfile } from "./onboarding/ProfileProvider";
import { AgentChat } from "./onboarding/components/AgentChat";
import { AssetLibrary } from "./onboarding/components/AssetLibrary";
import { afterLessonPlan, bootPlan, planFor, type Plan } from "./onboarding/workflow";

const EPISODE_ID = "ep-local";

/** Escape hatch to begin practice without rendering a lesson first. */
const GYM_PREFIX = "/gym";

export function App() {
  return (
    <ProfileProvider>
      <GymRuntime>
        <Studio />
      </GymRuntime>
    </ProfileProvider>
  );
}

/**
 * The product: a chat with a tutor agent that onboards a learner and then
 * turns topics into rendered lesson videos.
 *
 * Onboarding and lesson playback remain deterministic host UI. Once a lesson
 * is ready, the learner enters the receipted practice loop served by the
 * hardened TeamBox backend. The browser retains each complete command and
 * echoes its exact evidence bindings; it never turns free-form UI events into
 * model prompts. The `/gym` prefix starts that loop directly.
 */
function Studio() {
  const {
    profile,
    booting,
    latest,
    library,
    pageAction,
    consumePageAction,
    upsertLibrary,
    signOut,
  } = useProfile();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [events, setEvents] = useState<CodexGymEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | undefined>();
  const turn = useRef(0);
  /** jobId -> the topic that produced it, so a retry or a follow-up knows it. */
  const topics = useRef(new Map<string, string>());
  const booted = useRef(false);

  const nextTurnId = () => `turn-${(turn.current += 1)}`;

  const append = useCallback((message: ThreadMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const appendPlan = useCallback(
    (plan: Plan) => {
      for (const planned of plan.messages) {
        const turnId = planned.block ? nextTurnId() : undefined;
        append({
          id: crypto.randomUUID(),
          role: planned.role,
          text: planned.text,
          block:
            planned.block && turnId
              ? {
                  componentId: crypto.randomUUID(),
                  componentName: planned.block.componentName,
                  props: planned.block.props,
                  episodeId: EPISODE_ID,
                  turnId,
                }
              : undefined,
        });
      }
    },
    [append],
  );

  useEffect(() => {
    if (booting || booted.current) return;
    booted.current = true;
    appendPlan(bootPlan(profile));
    // Boot reflects the profile once the bridge has answered; later changes flow through events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting]);

  const startLesson = useCallback(
    async (topic: string) => {
      setBusy(true);
      setError(null);
      const turnId = nextTurnId();
      try {
        const job = await startLessonRender({ topic, episodeId: EPISODE_ID, turnId, slug: latest()?.slug });
        topics.current.set(job.jobId, topic);
        setCurrentJobId(job.jobId);
        upsertLibrary({
          jobId: job.jobId,
          topic,
          title: job.title,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
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
    [append, upsertLibrary, latest],
  );

  const appendNovelGym = useCallback(
    (initialPrompt: string, jobId?: string) => {
      const turnId = nextTurnId();
      append({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Turn the lesson into a decision you can practice and defend.",
        block: {
          componentId: crypto.randomUUID(),
          componentName: "NovelGymPanel",
          props: { initialPrompt, ...(jobId ? { jobId } : {}) },
          episodeId: EPISODE_ID,
          turnId,
        },
      });
    },
    [append],
  );

  const runPlan = useCallback(
    (plan: Plan) => {
      appendPlan(plan);
      if (plan.startLesson) void startLesson(plan.startLesson);
      if (plan.gymState) appendNovelGym(plan.gymState);
    },
    [appendPlan, startLesson, appendNovelGym],
  );

  useEffect(() => {
    if (!pageAction) return;
    if (pageAction.kind === "start_lesson") {
      void startLesson(pageAction.topic);
    } else if (pageAction.kind === "start_practice") {
      appendNovelGym(pageAction.prompt);
    } else if (pageAction.kind === "render_block") {
      append({
        id: crypto.randomUUID(),
        role: "assistant",
        block: pageAction.command,
      });
    } else {
      append({
        id: crypto.randomUUID(),
        role: "assistant",
        text: pageAction.summary,
      });
    }
    consumePageAction();
  }, [append, appendNovelGym, consumePageAction, pageAction, startLesson]);

  const onSubmit = useCallback(
    (text: string) => {
      append({ id: crypto.randomUUID(), role: "user", text });
      // Require a delimiter: a bare startsWith turns "/gymnastics for beginners"
      // into a gym turn on the mangled state "nastics for beginners".
      if (text === GYM_PREFIX || text.startsWith(`${GYM_PREFIX} `)) {
        const prompt = text.slice(GYM_PREFIX.length).trim();
        appendNovelGym(prompt || "Help me make creative choices I can defend.");
        return;
      }
      // A learner-authored topic deterministically starts a lesson. Curriculum
      // decisions happen later through the typed practice backend, not through
      // a second free-form turn service.
      void startLesson(text);
    },
    [append, appendNovelGym, startLesson],
  );

  const openFromLibrary = useCallback(
    (jobId: string) => {
      const entry = library.find((row) => row.jobId === jobId);
      if (!entry) return;
      topics.current.set(jobId, entry.topic);
      setCurrentJobId(jobId);
      const turnId = nextTurnId();
      append({
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Reopening "${entry.title ?? entry.topic}".`,
        block: {
          componentId: crypto.randomUUID(),
          componentName: "LessonVideo",
          props: { jobId, title: entry.title ?? entry.topic },
          episodeId: EPISODE_ID,
          turnId,
        },
      });
    },
    [append, library],
  );

  const onEvent = useCallback(
    (event: CodexGymEvent) => {
      setEvents((prev) => [...prev, event]);

      if (event.action === "lesson.ready") {
        const jobId = String(event.payload.jobId ?? "");
        const topic = topics.current.get(jobId) ?? "this lesson";
        const entry = library.find((row) => row.jobId === jobId);
        if (entry && entry.status !== "completed") {
          upsertLibrary({
            ...entry,
            status: "completed",
            videoUrl: typeof event.payload.videoUrl === "string" ? event.payload.videoUrl : undefined,
          });
        }
        // A reopened lesson already had its practice and follow-ups the first time round.
        if (!entry || entry.status !== "completed") appendNovelGym(topic, jobId);
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

      const plan = planFor(event, latest());
      if (plan.messages.length || plan.startLesson || plan.gymState) {
        runPlan(plan);
        return;
      }

      // Unknown legacy surface events are never promoted into learning
      // evidence. The typed practice panel owns the four accepted gym events.
      setError(`Unsupported learning event: ${event.action}`);
    },
    [append, appendPlan, appendNovelGym, startLesson, runPlan, library, upsertLibrary, latest],
  );

  const renderBlock = useCallback(
    (block: CodexComponentCommand) => {
      if (block.componentName === "NovelGymPanel") {
        const initialPrompt = String(block.props.initialPrompt ?? "").trim();
        const jobId = typeof block.props.jobId === "string" ? block.props.jobId : undefined;
        return (
          <NovelGymPanel
            initialPrompt={initialPrompt}
            key={block.componentId}
            onComplete={
              jobId ? () => appendPlan(afterLessonPlan(jobId, initialPrompt)) : undefined
            }
          />
        );
      }
      return <GymBlock key={block.componentId} command={block} onEvent={onEvent} pending={<p>Preparing…</p>} />;
    },
    [appendPlan, onEvent],
  );

  return (
    <div className="app-shell">
      <div className="grain" aria-hidden="true" />
      <main className="wrap studio">
        <header className="app-header">
          <div className="app-brand">
            <span className="app-brand-dot" />
            <span>Lesson studio</span>
          </div>
          <div className="receipt" style={{ margin: 0, display: "flex", gap: 12, alignItems: "center" }}>
            <span data-testid="status">{busy ? "Codex is thinking…" : booting ? "Loading profile…" : `turn ${turn.current}`}</span>
            {profile ? (
              <>
                <span data-testid="profile-badge">
                  {profile.name}
                  {profile.onboarding.level ? ` · ${profile.onboarding.level}` : ""}
                </span>
                <button
                  type="button"
                  className="btn"
                  data-testid="sign-out"
                  onClick={() => {
                    signOut();
                    setMessages([]);
                    setCurrentJobId(undefined);
                    appendPlan(bootPlan(null));
                  }}
                >
                  Switch learner
                </button>
              </>
            ) : null}
          </div>
        </header>

        {error && (
          <p data-testid="bridge-error" role="alert" className="receipt" style={{ color: "crimson" }}>
            Request error: {error}
          </p>
        )}

        <AssetLibrary onSelect={openFromLibrary} currentJobId={currentJobId} />

        <div className="studio-thread">
          <MessageThreadFull messages={messages} onSubmit={onSubmit} busy={busy} renderBlock={renderBlock} />
        </div>

        <details>
          <summary className="dim">Emitted to Codex</summary>
          <pre data-testid="event-log">{JSON.stringify(events, null, 2)}</pre>
        </details>
      </main>
      <AgentChat />
    </div>
  );
}
