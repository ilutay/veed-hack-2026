import { useCallback, useEffect, useRef, useState } from "react";
import { GymRuntime } from "./gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./gym/GymBlock";
import type { CodexGymEvent } from "./codex/CodexActionProvider";
import { describeEvent, requestNextBlock } from "./codex/client";
import { startLessonRender } from "./codex/lesson";
import { MessageThreadFull } from "./thread/MessageThreadFull";
import type { ThreadMessage } from "./thread/types";
import { ProfileProvider, useProfile } from "./onboarding/ProfileProvider";
import { AgentChat } from "./onboarding/components/AgentChat";
import { AssetLibrary } from "./onboarding/components/AssetLibrary";
import { afterLessonPlan, bootPlan, planFor, type Plan } from "./onboarding/workflow";

const EPISODE_ID = "ep-local";

/** Escape hatch to begin practice without rendering a lesson first. */
const GYM_PREFIX = "/gym";

const ADAPTIVE_GYM_ACTIONS = new Set([
  "probe.answered",
  "replay.acknowledged",
  "retry.started",
  "retry.exhausted",
  "transfer.submitted",
]);

function commandSummary(command: CodexComponentCommand): string {
  if (command.pioneerReceipt) {
    const source = command.pioneerReceipt.mode === "live" ? "Pioneer adapted" : "Curriculum preview selected";
    return `${source} the next ${command.pioneerReceipt.phase} step: ${command.pioneerReceipt.focus}`;
  }
  if (command.componentName === "AgentNote" && typeof command.props.text === "string") {
    return command.props.text;
  }
  if (command.componentName === "StartLesson" && typeof command.props.topic === "string") {
    return `Starting a lesson on “${command.props.topic}”.`;
  }
  if (command.componentName === "ProbeArena") return "Here is a practice question based on the lesson.";
  if (command.componentName === "CreditAssignmentReplay") return "Here is feedback grounded in your answer.";
  if (command.componentName === "TargetedRetryGym") return "Here is a targeted retry for the skill to strengthen.";
  if (command.componentName === "LayerOrderTransferGym") return "Here is a transfer challenge for the same idea.";
  return `Showing ${command.componentName}.`;
}

function practiceState(
  topic: string,
  context: string,
  event?: CodexGymEvent,
  visibleCommand?: CodexComponentCommand | null,
): string {
  const visible = visibleCommand
    ? JSON.stringify({ componentName: visibleCommand.componentName, props: visibleCommand.props }).slice(0, 4_000)
    : "none";
  const interaction = event ? describeEvent(event) : "Gym turn. No answer has been submitted yet.";
  return [
    "Gym turn for adaptive practice after a lesson.",
    `Lesson topic: ${JSON.stringify(topic)}.`,
    `Playback or choice context: ${context}`,
    `Visible practice surface: ${visible}`,
    interaction,
    "Choose the next gym component so it tests or strengthens this exact lesson topic. Do not start a new lesson.",
  ].join("\n");
}

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
 * is ready, Codex chooses a typed practice component using the lesson topic
 * and the learner's latest interaction. The `/gym` prefix starts that loop
 * directly without using the fixed demo fixture.
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
  const [activeBlock, setActiveBlock] = useState<CodexComponentCommand | null>(null);
  const turn = useRef(0);
  const activeSurface = useRef<HTMLElement | null>(null);
  const surfaceVersion = useRef(0);
  const pendingRequests = useRef(0);
  const practiceContext = useRef<{ jobId?: string; topic: string } | null>(null);
  /** jobId -> the topic that produced it, so a retry or a follow-up knows it. */
  const topics = useRef(new Map<string, string>());
  const booted = useRef(false);

  const nextTurnId = () => `turn-${(turn.current += 1)}`;

  const append = useCallback((message: ThreadMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const activateBlock = useCallback(
    (command: CodexComponentCommand, summary = commandSummary(command)) => {
      surfaceVersion.current += 1;
      setActiveBlock(command);
      setMessages((previous) => [
        ...previous.map((message) => (message.block ? { ...message, block: undefined } : message)),
        { id: crypto.randomUUID(), role: "assistant", text: summary },
      ]);
    },
    [],
  );

  useEffect(() => {
    if (!activeBlock) return;
    activeSurface.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [activeBlock]);

  const appendPlan = useCallback(
    (plan: Plan) => {
      if (plan.messages.some((message) => message.block)) {
        // Only the latest deterministic surface stays interactive. When a
        // model-authored active surface is being replaced, retire it too.
        surfaceVersion.current += 1;
        setActiveBlock(null);
        setMessages((previous) =>
          previous.map((message) => (message.block ? { ...message, block: undefined } : message)),
        );
      }
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
      const requestGeneration = ++surfaceVersion.current;
      setActiveBlock(null);
      setCurrentJobId(undefined);
      practiceContext.current = null;
      pendingRequests.current += 1;
      setBusy(true);
      setError(null);
      const turnId = nextTurnId();
      try {
        const job = await startLessonRender({ topic, episodeId: EPISODE_ID, turnId, slug: latest()?.slug });
        topics.current.set(job.jobId, topic);
        upsertLibrary({
          jobId: job.jobId,
          topic,
          title: job.title,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        // The lesson still belongs in the library, but a newer learner action
        // owns the active page and must not be overwritten by this response.
        if (surfaceVersion.current !== requestGeneration) return;
        setCurrentJobId(job.jobId);
        activateBlock(
          {
            // Ids are ours. The model never names its own render target, and
            // the job id is the bridge's, so nothing here is model-authored.
            componentId: crypto.randomUUID(),
            componentName: "LessonVideo",
            props: { jobId: job.jobId, title: job.title ?? topic },
            episodeId: EPISODE_ID,
            turnId,
          },
          `Rendering a lesson on "${topic}". It plays here as soon as the video lands.`,
        );
      } catch (err) {
        if (surfaceVersion.current === requestGeneration) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        pendingRequests.current = Math.max(0, pendingRequests.current - 1);
        setBusy(pendingRequests.current > 0);
      }
    },
    [activateBlock, upsertLibrary, latest],
  );

  const requestPractice = useCallback(
    async (
      topic: string,
      context: string,
      event?: CodexGymEvent,
      visibleCommand?: CodexComponentCommand | null,
    ) => {
      const normalizedTopic = topic.trim() || "the current lesson";
      const nextPracticeContext = !event ? { topic: normalizedTopic } : null;
      const requestGeneration = ++surfaceVersion.current;
      const turnId = nextTurnId();
      pendingRequests.current += 1;
      setBusy(true);
      setError(null);
      try {
        const slug = latest()?.slug;
        const command = await requestNextBlock({
          episodeId: EPISODE_ID,
          turnId,
          state: practiceState(normalizedTopic, context, event, visibleCommand),
          curriculum: {
            topic: normalizedTopic,
            currentSurface: visibleCommand
              ? { componentName: visibleCommand.componentName, props: visibleCommand.props }
              : null,
            learnerEvent: event
              ? { component: event.component, action: event.action, payload: event.payload }
              : null,
          },
          ...(slug ? { slug } : {}),
        });
        // A newer side-chat command owns the page. Do not let an older tutor
        // response arrive later and replace what the learner just requested.
        if (surfaceVersion.current !== requestGeneration) return;
        if (nextPracticeContext) practiceContext.current = nextPracticeContext;
        activateBlock(command);
      } catch (err) {
        if (surfaceVersion.current === requestGeneration) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        pendingRequests.current = Math.max(0, pendingRequests.current - 1);
        setBusy(pendingRequests.current > 0);
      }
    },
    [activateBlock, latest],
  );

  const runPlan = useCallback(
    (plan: Plan) => {
      appendPlan(plan);
      if (plan.startLesson) void startLesson(plan.startLesson);
      if (plan.gymState) {
        void requestPractice(plan.gymState, "The learner workflow requested a practice turn.");
      }
    },
    [appendPlan, startLesson, requestPractice],
  );

  useEffect(() => {
    if (!pageAction) return;
    if (pageAction.kind === "start_lesson") {
      void startLesson(pageAction.topic);
    } else if (pageAction.kind === "start_practice") {
      void requestPractice(pageAction.prompt, "The learner asked for practice in the side chat.");
    } else if (pageAction.kind === "render_block") {
      activateBlock(pageAction.command);
    } else {
      activateBlock(
        {
          componentId: crypto.randomUUID(),
          componentName: "AgentNote",
          props: { text: pageAction.summary },
          episodeId: EPISODE_ID,
          turnId: nextTurnId(),
        },
        pageAction.summary,
      );
    }
    consumePageAction();
  }, [activateBlock, append, consumePageAction, pageAction, requestPractice, startLesson]);

  const onSubmit = useCallback(
    (text: string) => {
      append({ id: crypto.randomUUID(), role: "user", text });
      // Require a delimiter: a bare startsWith turns "/gymnastics for beginners"
      // into a gym turn on the mangled state "nastics for beginners".
      if (text === GYM_PREFIX || text.startsWith(`${GYM_PREFIX} `)) {
        const prompt = text.slice(GYM_PREFIX.length).trim();
        void requestPractice(
          prompt || "creative decision-making",
          "The learner explicitly requested a standalone practice turn.",
        );
        return;
      }
      // A learner-authored topic deterministically starts a lesson. Curriculum
      // decisions happen later through the typed practice backend, not through
      // a second free-form turn service.
      void startLesson(text);
    },
    [append, requestPractice, startLesson],
  );

  const openFromLibrary = useCallback(
    (jobId: string) => {
      const entry = library.find((row) => row.jobId === jobId);
      if (!entry) return;
      topics.current.set(jobId, entry.topic);
      setCurrentJobId(jobId);
      const turnId = nextTurnId();
      activateBlock(
        {
          componentId: crypto.randomUUID(),
          componentName: "LessonVideo",
          props: { jobId, title: entry.title ?? entry.topic },
          episodeId: EPISODE_ID,
          turnId,
        },
        `Reopening "${entry.title ?? entry.topic}".`,
      );
    },
    [activateBlock, library],
  );

  const onEvent = useCallback(
    (event: CodexGymEvent) => {
      setEvents((prev) => [...prev, event]);

      if (event.action === "lesson.ready") {
        const jobId = String(event.payload.jobId ?? "");
        const topic = topics.current.get(jobId) ?? "this lesson";
        practiceContext.current = { jobId, topic };
        const entry = library.find((row) => row.jobId === jobId);
        if (entry && entry.status !== "completed") {
          upsertLibrary({
            ...entry,
            status: "completed",
            videoUrl: typeof event.payload.videoUrl === "string" ? event.payload.videoUrl : undefined,
          });
        }
        // A reopened lesson already had its practice and follow-ups the first time round.
        if (!entry || entry.status !== "completed") {
          void requestPractice(
            topic,
            `The video render is ready for playback (job ${JSON.stringify(jobId)}).`,
            event,
            activeBlock,
          );
        }
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

      if (ADAPTIVE_GYM_ACTIONS.has(event.action)) {
        const practice = practiceContext.current;
        if (!practice) {
          setError("That practice response is missing its lesson topic. Start the lesson again.");
          return;
        }
        if (event.action === "transfer.submitted") {
          setActiveBlock(null);
          practiceContext.current = null;
          if (practice.jobId) {
            appendPlan(afterLessonPlan(practice.jobId, practice.topic));
          } else {
            append({
              id: crypto.randomUUID(),
              role: "assistant",
              text: "Practice complete. Choose another topic when you are ready.",
            });
          }
          return;
        }
        void requestPractice(
          practice.topic,
          `Continue practice for job ${JSON.stringify(practice.jobId ?? "standalone")} using the learner's latest choice.`,
          event,
          activeBlock,
        );
        return;
      }

      const plan = planFor(event, latest());
      if (plan.messages.length || plan.startLesson || plan.gymState) {
        runPlan(plan);
        return;
      }

      // Unknown legacy surface events are never promoted into learning evidence.
      setError(`Unsupported learning event: ${event.action}`);
    },
    [activeBlock, append, appendPlan, requestPractice, startLesson, runPlan, library, upsertLibrary, latest],
  );

  const renderBlock = useCallback(
    (block: CodexComponentCommand) => (
      <GymBlock key={block.componentId} command={block} onEvent={onEvent} pending={<p>Preparing…</p>} />
    ),
    [onEvent],
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
                    surfaceVersion.current += 1;
                    signOut();
                    setMessages([]);
                    setCurrentJobId(undefined);
                    setActiveBlock(null);
                    practiceContext.current = null;
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

        {activeBlock ? (
          <section
            ref={activeSurface}
            className="snap active-page-surface"
            data-testid="active-page-surface"
            aria-label="Active learning surface"
            aria-live="polite"
            style={{ marginBottom: "1rem", scrollMarginTop: "1rem" }}
          >
            {activeBlock.pioneerReceipt ? (
              <p className="receipt" data-testid="pioneer-curriculum-receipt">
                {activeBlock.pioneerReceipt.mode === "live" ? "Pioneer live" : "Curriculum preview"} ·{" "}
                {activeBlock.pioneerReceipt.phase} · {activeBlock.pioneerReceipt.focus}
                {activeBlock.pioneerReceipt.usage
                  ? ` · ${activeBlock.pioneerReceipt.usage.totalTokens} tokens`
                  : ""}
              </p>
            ) : null}
            {renderBlock(activeBlock)}
          </section>
        ) : null}

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
